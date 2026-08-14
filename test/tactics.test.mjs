// Behaviour tests for the tactical layer: orders, and (as they land) tools,
// alarm state and objectives. Plain Node — the simulation systems deliberately
// touch no browser APIs, so the rules can be asserted without a renderer.
//
// Each case builds a tiny world, places units by hand rather than using map
// spawns, and fast-forwards in fixed 16 ms steps.

import { buildMap } from '../src/maps/index.js';
import { NavGrid } from '../src/systems/nav.js';
import { VisionSystem } from '../src/systems/vision.js';
import { CombatSystem } from '../src/systems/combat.js';
import { Unit, doorAtPoint } from '../src/systems/units.js';
import { updateHostile } from '../src/systems/ai.js';
import * as orders from '../src/systems/orders.js';
import { setSetting } from '../src/systems/settings.js';
import { AlarmSystem, CALM, ALARMED } from '../src/systems/alarm.js';
import { ObjectiveSystem, rateMission } from '../src/systems/objectives.js';
import { SUPPRESSION, UNIT_CLASSES, TOOLS, ALARM } from '../src/config.js';

export const name = 'tactics';

const STEP = 16;

// A headless stand-in for GameScene: the same systems, the same update order,
// none of the rendering.
function world(mapId = 'compound') {
    const level = buildMap(mapId);
    const vision = new VisionSystem(level);
    const nav = new NavGrid(level);
    const combat = new CombatSystem(level, vision);
    const alarm = new AlarmSystem();
    const objectives = new ObjectiveSystem(level);
    const units = [];
    const w = {
        level, vision, nav, combat, alarm, objectives, units,
        now: 0,
        friendlies: [],
        hostiles: [],
    };

    w.ctx = {
        vision, nav, level,
        friendlies: w.friendlies,
        hostiles: w.hostiles,
        noises: combat.noises,
        spawnHostile: (cls, x, y) => w.add(cls, x, y),
        blocked: (x, y) => nav.isBlockedWorld(x, y) || !!doorAtPoint(level.doors, x, y, 2),
        closedDoorAt: (x, y) => doorAtPoint(level.doors, x, y, 10),
        openDoor: (door, chargedBy) => {
            if (door.open) return;
            door.open = true;
            if (chargedBy) combat.blastDoor(door, units);
            nav.rebuild();
            vision.refreshSegments();
            combat.refreshBlockers();
        },
        repath: (unit, point) => unit.setPath(nav.findPath(unit.x, unit.y, point.x, point.y)),
    };

    // Classified by team, not by "not friendly": a civilian belongs to neither
    // side, exactly as GameScene keeps them out of both lists.
    w.add = (cls, x, y, facing = 0) => {
        const unit = new Unit({ cls, x, y, facing });
        units.push(unit);
        if (unit.team === 'friendly') w.friendlies.push(unit);
        else if (unit.team === 'hostile') w.hostiles.push(unit);
        return unit;
    };

    // Same order as GameScene.update, minus rendering and outcome checks.
    w.run = (ms) => {
        for (let elapsed = 0; elapsed < ms; elapsed += STEP) {
            w.now += STEP;
            for (const hostile of w.hostiles) updateHostile(hostile, STEP, w.ctx);
            for (const unit of units) unit.update(STEP, w.ctx);
            combat.update(STEP, units, w.now);
            vision.setClouds(combat.clouds);
            alarm.update(STEP, w.ctx);
            alarm.drain();
            objectives.update(STEP, w.ctx);
            objectives.drain();
            combat.events.length = 0;
        }
    };

    // Rounds fired by one unit, counted off the event stream as it drains. Only
    // that unit's rounds count — return fire from the other side is not the
    // thing under test.
    w.countShots = (ms, who) => {
        let shots = 0;
        for (let elapsed = 0; elapsed < ms; elapsed += STEP) {
            w.now += STEP;
            for (const hostile of w.hostiles) updateHostile(hostile, STEP, w.ctx);
            for (const unit of units) unit.update(STEP, w.ctx);
            combat.update(STEP, units, w.now);
            vision.setClouds(combat.clouds);
            alarm.update(STEP, w.ctx);
            alarm.drain();
            objectives.update(STEP, w.ctx);
            objectives.drain();
            shots += combat.events.filter(
                (e) => e.kind === 'shot' && (!who || e.unit === who.id),
            ).length;
            combat.events.length = 0;
        }
        return shots;
    };

    return w;
}

// Somewhere in the open on the compound map, well clear of the building.
const OPEN = { x: 300, y: 1200 };

export function run(t) {
    holdFire(t);
    suppressGround(t);
    pace(t);
    stackAndBreach(t);
    arrivalFacing(t);
    aimedThrow(t);
    ammo(t);
    smoke(t);
    flashbang(t);
    breachingCharge(t);
    alarm(t);
    objectives(t);
    rating(t);
}

// What the mission is for. Two of the three maps end on something other than
// "everyone is dead", so this is the part that has to be right.
function objectives(t) {
    // Warehouse: intel then exfil, with clearing the place only a bonus.
    const w = world('warehouse');
    const squad = w.level.squad.map((spec) => w.add(spec.cls, spec.x, spec.y));
    const intel = w.objectives.list.find((o) => o.kind === 'intel');
    const zone = w.objectives.exfil;
    t.ok(!!intel && !!zone, 'the warehouse is an intel run with an extraction zone');

    // In the zone but empty-handed: not a win.
    for (const unit of squad) {
        unit.x = zone.x + zone.w / 2;
        unit.y = zone.y + zone.h / 2;
    }
    w.run(1200);
    t.ok(!w.objectives.complete, 'exfil alone does not finish an intel mission');

    // Pick it up, then walk out.
    for (const unit of squad) {
        unit.x = intel.x;
        unit.y = intel.y;
    }
    w.run(1500);
    t.ok(intel.done, 'standing on the intel picks it up');
    t.ok(!w.objectives.complete, 'and having it is not the same as being out');

    for (const unit of squad) {
        unit.x = zone.x + zone.w / 2;
        unit.y = zone.y + zone.h / 2;
    }
    w.run(600);
    t.ok(w.objectives.complete, 'intel plus everyone in the zone finishes it');

    // Outpost: a hostage who follows you out, and dies if you are careless.
    const o = world('outpost');
    const rescue = o.objectives.list.find((r) => r.kind === 'rescue');
    const hostage = o.add('hostage', rescue.x, rescue.y);
    o.objectives.hostage = hostage;
    const rescuer = o.add('operator', rescue.x + 400, rescue.y);
    t.ok(!hostage.freed, 'the hostage starts where the map put them');

    rescuer.x = rescue.x + 30;
    rescuer.y = rescue.y;
    o.run(200);
    t.ok(hostage.freed, 'reaching them frees them');

    // They follow: put the rescuer somewhere reachable and watch the gap close.
    rescuer.x = rescue.x - 60;
    rescuer.y = rescue.y - 100;
    const gapBefore = Math.hypot(hostage.x - rescuer.x, hostage.y - rescuer.y);
    o.run(4000);
    const gapAfter = Math.hypot(hostage.x - rescuer.x, hostage.y - rescuer.y);
    t.ok(gapAfter < gapBefore, `a freed hostage follows (${Math.round(gapBefore)} → ${Math.round(gapAfter)})`);

    hostage.takeDamage(9999);
    o.run(100);
    t.ok(o.objectives.failed, 'and a dead hostage is a failed mission');
}

function rating(t) {
    const clean = rateMission({ timeMs: 120000, casualties: 0, alarmRaised: false, bonusDone: false });
    const loud = rateMission({ timeMs: 120000, casualties: 0, alarmRaised: true, bonusDone: false });
    const costly = rateMission({ timeMs: 120000, casualties: 3, alarmRaised: true, bonusDone: false });

    t.equal(clean.grade, 'S', `a quiet run with everyone alive grades top (${clean.score})`);
    t.ok(loud.score < clean.score, 'raising the alarm costs you');
    t.ok(costly.score < loud.score, 'and losing people costs more');

    // Monotonic in casualties, which is the property that keeps the grade honest.
    let last = Infinity;
    for (let dead = 0; dead <= 6; dead++) {
        const score = rateMission({ timeMs: 60000, casualties: dead, alarmRaised: false }).score;
        if (score > last) last = -1;
        else last = score;
    }
    t.ok(last >= 0, 'the score never improves when more of the squad dies');
}

// The garrison's state of mind. The whole reason to carry a suppressed weapon is
// that it does not move this needle, so that is what gets checked.
function alarm(t) {
    // An unsuppressed shot inside somebody's earshot is the alarm.
    const loud = world();
    const rifleman = loud.add('operator', OPEN.x, OPEN.y);
    const listener = loud.add('hostile', OPEN.x + 400, OPEN.y + 400);
    listener.maxHp = 1e6;
    listener.hp = 1e6;
    t.equal(loud.alarm.state, CALM, 'a mission starts undetected');

    // Let the mission run first. The brain and the alarm hold a reference to the
    // noise list, so a shot fired minutes in has to be as audible as the first
    // one — pruning it by reassignment used to leave them both deaf.
    loud.run(3000);
    const heard = loud.ctx.noises;
    loud.combat.fire(rifleman, loud.now);
    t.ok(heard.length > 0, 'a shot lands in the list the AI is actually reading');
    loud.run(100);
    t.equal(loud.alarm.state, ALARMED, 'an unsuppressed shot in earshot raises the alarm');

    // The same shot from the suppressed weapon does not.
    const quiet = world();
    const marksman = quiet.add('marksman', OPEN.x, OPEN.y);
    const other = quiet.add('hostile', OPEN.x + 400, OPEN.y + 400);
    other.maxHp = 1e6;
    other.hp = 1e6;
    t.ok(marksman.stats.weapon.suppressed, 'the marksman carries the quiet weapon');
    quiet.combat.fire(marksman, quiet.now);
    quiet.run(100);
    t.ok(quiet.alarm.state !== ALARMED, `a suppressed shot does not (${quiet.alarm.state})`);

    // Exactly one wave arrives, and it comes from the map's entry points.
    const before = loud.hostiles.length;
    loud.run(ALARM.reinforceDelay + 500);
    const arrived = loud.hostiles.length - before;
    t.equal(arrived, ALARM.wave.length, `one wave of reinforcements arrives (${arrived})`);
    t.ok(loud.alarm.waveSent, 'and the wave is marked as sent');

    loud.run(ALARM.reinforceDelay * 2);
    t.equal(loud.hostiles.length - before, ALARM.wave.length, 'and no more come after it');
    t.ok(loud.alarm.everAlarmed, 'the mission remembers that it went loud');
}

// Smoke is the one occluder that stops eyes without stopping bullets. That split
// is the whole reason it is worth carrying, so it is worth pinning down.
function smoke(t) {
    const w = world();
    const spotter = w.add('operator', OPEN.x, OPEN.y);
    const target = w.add('hostile', OPEN.x + 300, OPEN.y);
    target.maxHp = 1e6;
    target.hp = 1e6;

    w.combat.addCloud(OPEN.x + 150, OPEN.y);
    w.run(TOOLS.smoke.growTime + 200);

    const a = [spotter.x, spotter.y, target.x, target.y];
    t.ok(!w.vision.canObserve(...a), 'a cloud in the way blocks the view');
    t.ok(w.vision.hasLineOfSight(...a), 'but not the path a bullet would take');
    t.equal(spotter.target, null, 'so nothing can be acquired through it');

    // A round fired into the cloud carries on through and connects.
    const before = target.hp;
    spotter.facing = 0;
    spotter.aimAngle = 0;
    w.combat.fire(spotter, w.now);
    w.run(600);
    t.ok(target.hp < before, 'and a round fired blind still goes through');

    // And it clears on its own.
    w.run(TOOLS.smoke.duration);
    t.equal(w.combat.clouds.length, 0, 'the cloud burns out');
    t.ok(w.vision.canObserve(spotter.x, spotter.y, target.x, target.y), 'and the view comes back');
}

function flashbang(t) {
    const w = world();
    const exposed = w.add('hostile', OPEN.x + 60, OPEN.y);
    w.combat.flash(OPEN.x, OPEN.y, w.units);
    t.ok(exposed.blinded > 0, 'a flashbang blinds whoever was looking at it');
    t.equal(exposed.hp, exposed.maxHp, 'and hurts nobody');
    t.ok(!w.combat.canShoot(exposed), 'a blinded unit cannot shoot');

    // Behind a wall is behind a wall. The compound's building wall runs along
    // x = 900; one unit each side of it, both within the radius.
    const s = world();
    const inside = s.add('hostile', 880, 400);
    const outside = s.add('hostile', 940, 400);
    s.combat.flash(870, 400, s.units);
    t.ok(inside.blinded > 0, 'the one with a view of the burst is blinded');
    t.equal(outside.blinded, 0, 'the one behind the wall is not');

    // It wears off.
    w.run(4000);
    t.equal(exposed.blinded, 0, 'blindness wears off');
}

function breachingCharge(t) {
    const w = world();
    const door = w.level.doors[0];
    const spec = w.level.squad[0];
    const breacher = w.add('breacher', spec.x, spec.y);
    const charges = breacher.kit.charge;
    t.ok(charges > 0, 'the breacher deploys with charges');

    // Standing right behind the door, on the inside.
    const inside = w.add('hostile', door.x + door.w / 2, door.y - 60);
    const hp = inside.hp;

    orders.stackOn([breacher], door, w.ctx);
    w.run(14000);
    orders.goBreach([breacher], w.ctx);
    t.ok(breacher.order.useCharge, 'an ordered breach reaches for a charge');
    w.run(10000);

    t.ok(door.open, 'the charge takes the door');
    t.equal(breacher.kit.charge, charges - 1, 'and costs one charge');
    t.ok(inside.hp < hp, 'whoever was standing behind it catches the blast');
}

// The magazine switch: on, a weapon runs dry and costs real time to reload; off,
// every ammo check is a no-op and nothing changes from how the game used to play.
function ammo(t) {
    const shotgun = UNIT_CLASSES.breacher.weapon;

    setSetting('ammo', true);
    const w = world();
    const shooter = w.add('breacher', OPEN.x, OPEN.y);
    const victim = w.add('hostile', OPEN.x + 150, OPEN.y);
    // Neither of them is allowed to die: this is a test about magazines, and a
    // casualty on either side would end the exchange before it proves anything.
    for (const u of [shooter, victim]) {
        u.maxHp = 1e6;
        u.hp = 1e6;
    }
    t.equal(shooter.mag, shotgun.magazine, 'a unit deploys with a full magazine');

    const fired = w.countShots(4200, shooter);
    t.equal(fired, shotgun.magazine, `it fires exactly one magazine and stops (${fired})`);
    t.ok(shooter.reloadTimer > 0, 'running dry starts a reload');
    t.equal(shooter.mag, 0, 'the magazine is empty until the reload finishes');

    // Nothing comes out during the reload itself, and a magazine leaves the
    // pouch when it finishes.
    const left = shooter.reloadTimer;
    t.equal(w.countShots(left - 100, shooter), 0, 'nothing fires during the reload');
    w.run(300);
    t.ok(shooter.mag > 0, 'the reload puts a fresh magazine in');
    t.equal(
        shooter.reserve,
        shotgun.magazine * (shotgun.spare - 1),
        'and takes it out of the pouch',
    );
    t.ok(w.countShots(1500, shooter) > 0, 'and the weapon works again');

    // With the switch off there is no magazine to empty.
    setSetting('ammo', false);
    const free = world();
    const endless = free.add('breacher', OPEN.x, OPEN.y);
    const other = free.add('hostile', OPEN.x + 150, OPEN.y);
    other.maxHp = 1e6;
    other.hp = 1e6;
    t.equal(endless.magSize, Infinity, 'ammo off means no magazine at all');
    const many = free.countShots(6000, endless);
    t.ok(many > shotgun.magazine, `it never stops to reload (${many} rounds)`);
    t.equal(endless.reloadTimer, 0, 'and never reloads');
    setSetting('ammo', true);
}

function holdFire(t) {
    const w = world();
    const shooter = w.add('operator', OPEN.x, OPEN.y);
    const target = w.add('hostile', OPEN.x + 200, OPEN.y);
    target.maxHp = 1e6;
    target.hp = 1e6;

    orders.toggleHold([shooter]);
    t.equal(shooter.order.stance, 'hold', 'hold fire sets the stance');
    t.equal(w.countShots(3000, shooter), 0, 'a unit on hold fires nothing at a target in the open');
    t.ok(!!shooter.target, 'it still tracks the target while holding');

    orders.toggleHold([shooter]);
    t.ok(w.countShots(3000, shooter) > 0, 'releasing the stance opens fire');
}

function suppressGround(t) {
    const w = world();
    const gunner = w.add('machinegunner', OPEN.x, OPEN.y);
    // A hostile standing on the beaten zone, tough enough to survive being shot
    // at for three seconds so the suppression number is what gets measured.
    const victim = w.add('hostile', OPEN.x + 300, OPEN.y);
    victim.maxHp = 1e6;
    victim.hp = 1e6;

    orders.setSuppress([gunner], OPEN.x + 300, OPEN.y);
    t.ok(!!gunner.order.suppressAt, 'the suppress order lands on the unit');

    // Suppression decays continuously, so what matters is whether the pressure
    // ever got high enough to put a head down, not where it happens to sit at
    // the end of the run.
    let shots = 0;
    let peak = 0;
    let pinned = false;
    for (let i = 0; i < 16; i++) {
        shots += w.countShots(250, gunner);
        peak = Math.max(peak, victim.suppression);
        pinned = pinned || victim.pinned;
    }
    t.ok(shots > 0, `ordered fire goes out without an acquired target (${shots} rounds)`);
    t.ok(
        pinned && peak >= SUPPRESSION.threshold,
        `rounds on the position pin whoever is standing there (peak ${Math.round(peak)})`,
    );

    // Out of reach is refused rather than silently accepted.
    const other = world();
    const far = other.add('operator', OPEN.x, OPEN.y);
    t.equal(orders.setSuppress([far], OPEN.x + 4000, OPEN.y), 0, 'a spot out of range is refused');
}

function pace(t) {
    const w = world();
    const walker = w.add('operator', OPEN.x, OPEN.y);
    const runner = w.add('operator', OPEN.x, OPEN.y + 60);
    const goal = { x: OPEN.x + 600, y: OPEN.y };
    w.ctx.repath(walker, goal);
    w.ctx.repath(runner, { x: goal.x, y: goal.y + 60 });
    orders.cyclePace([runner]);
    t.equal(runner.order.pace, 'sprint', 'the first pace step is sprint');

    const from = runner.x;
    const walkFrom = walker.x;
    w.run(1000);
    t.ok(runner.x - from > walker.x - walkFrom, 'a sprinting unit covers more ground');

    // Sprinting means the weapon is down.
    const s = world();
    const sprinter = s.add('operator', OPEN.x, OPEN.y);
    const enemy = s.add('hostile', OPEN.x + 250, OPEN.y);
    enemy.maxHp = 1e6;
    enemy.hp = 1e6;
    orders.cyclePace([sprinter]);
    s.ctx.repath(sprinter, { x: OPEN.x, y: OPEN.y + 600 });
    t.equal(s.countShots(1500, sprinter), 0, 'a sprinting unit does not shoot');

    // Creeping keeps a marksman set, which is the reason to order it.
    const c = world();
    const marksman = c.add('marksman', OPEN.x, OPEN.y);
    orders.cyclePace([marksman]);
    orders.cyclePace([marksman]);
    t.equal(marksman.order.pace, 'careful', 'the second pace step is careful');
    c.ctx.repath(marksman, { x: OPEN.x + 400, y: OPEN.y });
    c.run(1200);
    t.ok(
        marksman.isMoving && marksman.stationaryFor >= marksman.stats.steadyTime,
        'a careful marksman stays set while it moves',
    );
}

function stackAndBreach(t) {
    const w = world();
    const door = w.level.doors[0];
    // Start from the squad's own deployment area so the door is approachable.
    const spec = w.level.squad[0];
    const breacher = w.add('breacher', spec.x, spec.y);

    t.ok(orders.stackOn([breacher], door, w.ctx) === 1, 'stacking issues a route to the door');
    w.run(14000);
    t.ok(!door.open, 'a stacked unit waits rather than forcing the door');
    t.ok(
        Math.hypot(breacher.x - (door.x + door.w / 2), breacher.y - (door.y + door.h / 2)) < 120,
        'it waits within reach of the door',
    );

    orders.goBreach([breacher], w.ctx);
    t.equal(breacher.order.stackAt, null, 'GO releases the stack');
    w.run(8000);
    t.ok(door.open, 'GO puts the unit through the door');
}

function arrivalFacing(t) {
    const w = world();
    const unit = w.add('operator', OPEN.x, OPEN.y, 0);
    const facing = -Math.PI / 2;   // told to watch north on arrival
    unit.order.facing = facing;
    w.ctx.repath(unit, { x: OPEN.x + 300, y: OPEN.y });
    w.run(6000);
    t.ok(!unit.path, 'the unit reaches its move order');
    t.ok(
        Math.abs(Math.atan2(Math.sin(unit.facing - facing), Math.cos(unit.facing - facing))) < 0.05,
        'and holds the arrival facing it was given rather than its travel direction',
    );
}

function aimedThrow(t) {
    const w = world();
    const grenadier = w.add('grenadier', OPEN.x, OPEN.y);
    const victim = w.add('hostile', OPEN.x + 320, OPEN.y);
    victim.maxHp = 1e6;
    victim.hp = 1e6;

    const thrower = orders.setThrow([grenadier], OPEN.x + 320, OPEN.y, 'frag');
    t.equal(thrower, grenadier, 'the aimed throw goes to the unit that can make it');
    const before = grenadier.kit.frag;
    w.run(2500);
    t.equal(grenadier.kit.frag, before - 1, 'exactly one grenade leaves the pouch');
    t.equal(grenadier.order.throwAt, null, 'and the order clears once it is out');

    // Nobody in the selection can throw: the order is refused, not queued.
    const none = world();
    const rifleman = none.add('operator', OPEN.x, OPEN.y);
    t.equal(orders.setThrow([rifleman], OPEN.x + 200, OPEN.y, 'frag'), null, 'a unit with no grenades refuses');
}
