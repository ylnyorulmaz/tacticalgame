// Mission scene: owns the world state and drives every system once per frame.
// Simulation only advances while unpaused; selection, orders, camera and drawing
// always run, which is what makes the pausable real-time loop work.

import { WORLD, UNIT_CLASSES } from '../config.js';
import { buildMap, DEFAULT_MAP } from '../maps/index.js';
import { NavGrid, CELL } from '../systems/nav.js';
import { VisionSystem, FogRenderer } from '../systems/vision.js';
import { CombatSystem } from '../systems/combat.js';
import { Unit, doorAtPoint } from '../systems/units.js';
import { updateHostile } from '../systems/ai.js';
import { isVehicle, updateVehicle } from '../systems/vehicles.js';
import { updateSupport } from '../systems/support.js';
import { updateCover } from '../systems/cover.js';
import * as orders from '../systems/orders.js';
import { AlarmSystem, ALARMED } from '../systems/alarm.js';
import { ObjectiveSystem, rateMission } from '../systems/objectives.js';
import { getAudio } from '../systems/audio.js';
import { EffectSystem } from '../systems/effects.js';
import { InputController } from '../systems/input.js';
import { buildGround, PropLayer, DecalLayer } from '../render/terrain.js';
import { EntityRenderer } from '../render/entities.js';

// Wide enough that no doorway on any map will take one.
const VEHICLE_RADIUS = 34;

export class GameScene extends Phaser.Scene {
    constructor() {
        super('game');
    }

    init(data) {
        // Which map to run; kept so `R` restarts this one rather than the first.
        this.mapId = (data && data.mapId) || this.mapId || DEFAULT_MAP;
    }

    create() {
        this.paused = false;
        this.outcome = null;
        this.outcomeAnnounced = false;
        this.failure = null;
        this.rating = null;
        this.feed = [];          // newest-first lines for the HUD event feed
        this.pendingOrder = null; // aimed verb waiting for a click, shown by the HUD
        // A fresh level every mission: doors carry open/shut state.
        this.level = buildMap(this.mapId);
        const level = this.level;

        buildGround(this, level, 0);
        // Cover and the marks a fight leaves are their own layers: one gets
        // re-baked when something is blown apart, the other only accumulates.
        this.decals = new DecalLayer(this, 4);
        this.props = new PropLayer(this, level, 5);
        this.vision = new VisionSystem(level);
        this.nav = new NavGrid(level);
        // A second grid for anything too wide to fit through a door. Cheap to
        // keep — one byte array — and it is what stops a tank pathing into a
        // building it could never physically enter.
        this.vehicleNav = new NavGrid(level, { radius: VEHICLE_RADIUS, doorsPassable: false });
        this.combat = new CombatSystem(level, this.vision);
        this.fog = new FogRenderer(this, 20);
        this.entities = new EntityRenderer(this);
        this.entities.drawDoors(level);
        // Shared with the menu scene: one sound bank, one mute state.
        this.audio = getAudio(this);
        this.effects = new EffectSystem();
        this.alarm = new AlarmSystem();

        this.squad = level.squad.map((spec) => new Unit(spec));
        this.hostiles = level.hostiles.map((spec) => {
            const unit = new Unit({ cls: spec.cls || 'hostile', x: spec.x, y: spec.y, facing: spec.facing });
            unit.route = spec.route;
            unit.ai.state = spec.route ? 'patrol' : 'idle';
            return unit;
        });
        this.units = [...this.squad, ...this.hostiles];
        this.selected = [];

        this.objectives = new ObjectiveSystem(level);
        // A rescue needs somebody to rescue. They start where the map says and
        // do not move until an operator reaches them.
        const rescue = this.objectives.list.find((o) => o.kind === 'rescue');
        if (rescue) {
            const hostage = new Unit({ cls: 'hostage', x: rescue.x, y: rescue.y, facing: Math.PI / 2 });
            this.objectives.hostage = hostage;
            this.units.push(hostage);
        }
        // For the end-of-mission grade.
        this.startedAt = null;
        this.shotsFired = 0;

        this.ctx = {
            vision: this.vision,
            nav: this.nav,
            level,
            friendlies: this.squad,
            hostiles: this.hostiles,
            noises: this.combat.noises,
            spawnHostile: (cls, x, y) => this.spawnHostile(cls, x, y),
            // A shut door is pathable (you can plan through it) but not walkable
            // until it is actually breached open.
            navFor: (unit) => (unit && isVehicle(unit) ? this.vehicleNav : this.nav),
            blocked: (x, y, unit) => {
                const grid = unit && isVehicle(unit) ? this.vehicleNav : this.nav;
                return grid.isBlockedWorld(x, y) || !!doorAtPoint(this.level.doors, x, y, 2);
            },
            closedDoorAt: (x, y) => doorAtPoint(this.level.doors, x, y, 10),
            openDoor: (door, chargedBy) => this.openDoor(door, chargedBy),
            onBreachStart: (unit, door, charge) => {
                this.audio.play('breachStart', unit.x, unit.y);
                if (charge) this.pushFeed(`Charge set on ${door.id}`, '#ff8a3a');
            },
            repath: (unit, point) => {
                const grid = isVehicle(unit) ? this.vehicleNav : this.nav;
                unit.setPath(grid.findPath(unit.x, unit.y, point.x, point.y));
            },
        };

        const cam = this.cameras.main;
        cam.setBounds(0, 0, WORLD.width, WORLD.height);
        cam.setZoom(0.78);
        cam.centerOn(level.cameraStart.x, level.cameraStart.y);

        this.inputCtl = new InputController(this);
        this.selectUnits([this.squad[0]]);

        // Only the first scene in the config array boots on its own.
        if (!this.scene.isActive('hud')) this.scene.launch('hud');
    }

    // A reinforcement walking onto the map mid-mission. The arrays the systems
    // hold are the same ones, so pushing is enough — nothing needs rebuilding.
    spawnHostile(cls, x, y) {
        // Armour needs a spot wide enough for armour, or the wave arrives with a
        // tank wedged in a gap it can never drive out of.
        const grid = UNIT_CLASSES[cls] && UNIT_CLASSES[cls].vehicle ? this.vehicleNav : this.nav;
        const cell = grid.cellAtWorld(x, y);
        const open = grid.nearestOpen(cell.cx, cell.cy);
        const at = open ? { x: open.cx * CELL + CELL / 2, y: open.cy * CELL + CELL / 2 } : { x, y };
        const unit = new Unit({ cls, x: at.x, y: at.y, facing: Math.PI / 2 });
        this.hostiles.push(unit);
        this.units.push(unit);
        return unit;
    }

    // A crate or a sandbag line has come apart. Everything that reads the world
    // has to be told, which is the same refresh a door needs — plus a re-bake of
    // the prop layer and some debris on the ground where it used to be.
    coverDestroyed(event) {
        this.decals.debris(event.rect);
        this.props.rebuild(this.level);
        this.rebuildWorld();
        this.pushFeed('Cover destroyed', '#b0a99c');
    }

    // Everything that caches a view of the world, refreshed together. Both nav
    // grids, because infantry and armour see different maps.
    rebuildWorld() {
        this.nav.rebuild();
        this.vehicleNav.rebuild();
        this.vision.refreshSegments();
        this.combat.refreshBlockers();
    }

    // A knocked-out tank does not vanish: it becomes terrain, blocking movement,
    // sight and bullets for the rest of the mission. The footprint goes in as a
    // hidden prop — the burnt-out hull is drawn from the unit itself, which
    // keeps it pointing the way it died.
    wreckVehicle(unit) {
        const size = unit.radius * 2.1;
        this.level.props.push({
            type: 'wreck',
            hidden: true,
            x: unit.x,
            y: unit.y,
            w: size,
            h: size,
            blocksSight: true,
            blocksMove: true,
            hp: Infinity,
        });
        this.rebuildWorld();
        this.decals.scorch(unit.x, unit.y, unit.radius * 2);
        this.audio.play('shellImpact', unit.x, unit.y);
        this.pushFeed(`${unit.stats.name} knocked out`, '#ffd24a');
    }

    openDoor(door, chargedBy = null) {
        if (door.open) return;
        door.open = true;
        if (chargedBy) {
            // The charge takes the door and whatever was standing behind it.
            this.combat.blastDoor(door, this.units);
            this.pushFeed(`${door.id} blown`, '#ff8a3a');
        } else {
            this.audio.play('breach', door.x + door.w / 2, door.y + door.h / 2);
            this.pushFeed(`Door breached: ${door.id}`, '#ffd24a');
        }
        this.rebuildWorld();
        this.entities.drawDoors(this.level);
    }

    togglePause() {
        if (this.outcome) return;
        this.paused = !this.paused;
        this.audio.play(this.paused ? 'pause' : 'unpause');
    }

    restartMission() {
        this.scene.restart({ mapId: this.mapId });
    }

    // Back to map selection: the HUD belongs to the mission, so it goes too.
    returnToMenu() {
        this.scene.stop('hud');
        this.scene.start('menu');
    }

    selectUnits(units) {
        const unique = [...new Set(units.filter((u) => u && u.alive))];
        for (const unit of this.squad) unit.selected = false;
        for (const unit of unique) unit.selected = true;
        this.selected = unique;
    }

    cycleSelection() {
        const alive = this.squad.filter((u) => u.alive);
        if (alive.length === 0) return;
        const current = this.selected.length === 1 ? alive.indexOf(this.selected[0]) : -1;
        this.selectUnits([alive[(current + 1) % alive.length]]);
        this.audio.play('select');
    }

    issueMoveOrder(x, y, queue, facing = null) {
        if (this.outcome || this.selected.length === 0) return;
        const targets = formationTargets(x, y, this.selected.length);
        let ordered = 0;

        this.selected.forEach((unit, i) => {
            if (!unit.alive) return;
            // Walking somewhere supersedes standing and suppressing, or waiting
            // beside a door.
            orders.clearOnMove(unit);
            unit.order.facing = facing;
            const wanted = targets[i];
            const cell = this.nav.cellAtWorld(wanted.x, wanted.y);
            const open = this.nav.nearestOpen(cell.cx, cell.cy);
            if (!open) return;
            const goal = this.nav.isBlockedWorld(wanted.x, wanted.y)
                ? { x: open.cx * CELL + CELL / 2, y: open.cy * CELL + CELL / 2 }
                : wanted;

            const queueing = queue && unit.path && unit.pathIndex < unit.path.length;
            const from = queueing ? unit.path[unit.path.length - 1] : unit;
            const path = this.nav.findPath(from.x, from.y, goal.x, goal.y);
            if (!path) return;

            if (queueing) {
                unit.path = [...unit.path.slice(unit.pathIndex), ...path];
                unit.pathIndex = 0;
                unit.orderPoint = { x: goal.x, y: goal.y };
            } else {
                unit.breaching = null;
                unit.setPath(path);
            }
            ordered++;
        });

        if (ordered > 0) this.audio.play('order');
    }

    // --- Order verbs -------------------------------------------------------
    // Each one applies to the current selection and reports itself in the feed,
    // because an order you cannot see the result of is an order you stop using.

    orderHold() {
        if (this.outcome || this.selected.length === 0) return;
        const stance = orders.toggleHold(this.selected);
        this.audio.play('order');
        this.pushFeed(stance === 'hold' ? 'Holding fire' : 'Weapons free', '#ffd24a');
    }

    orderPace() {
        if (this.outcome || this.selected.length === 0) return;
        const pace = orders.cyclePace(this.selected);
        this.audio.play('order');
        this.pushFeed(`Pace: ${pace}`, '#cfe9ff');
    }

    orderGo() {
        if (this.outcome) return;
        const waiting = this.squad.filter((u) => u.alive && u.order.stackAt);
        if (waiting.length === 0) return;
        orders.goBreach(waiting, this.ctx);
        this.audio.play('order');
        this.pushFeed(`GO — ${waiting.length} through the door`, '#ffd24a');
    }

    // The three verbs that need a point on the map: armed by a key, resolved by
    // the next click.
    resolveAimedOrder(verb, x, y) {
        if (this.outcome || this.selected.length === 0) return;

        if (verb === 'suppress') {
            const ordered = orders.setSuppress(this.selected, x, y);
            if (ordered === 0) {
                this.pushFeed('Too far to suppress', '#ff6b6b');
                return;
            }
            this.audio.play('order');
            this.pushFeed(`Suppressing — ${ordered} on the gun`, '#ffd24a');
            return;
        }

        if (verb === 'frag' || verb === 'smoke' || verb === 'flash') {
            const thrower = orders.setThrow(this.selected, x, y, verb);
            if (!thrower) {
                this.pushFeed(`No ${verb} in range`, '#ff6b6b');
                return;
            }
            this.audio.play('order');
            this.pushFeed(`${thrower.stats.name}: ${verb} out`, '#ffd24a');
            return;
        }

        if (verb === 'stack') {
            const door = this.nearestClosedDoor(x, y);
            if (!door) {
                this.pushFeed('No door there', '#ff6b6b');
                return;
            }
            const ordered = orders.stackOn(this.selected, door, this.ctx);
            if (ordered === 0) return;
            this.audio.play('order');
            this.pushFeed(`Stacking on ${door.id} — Enter to go`, '#7fd8ff');
        }
    }

    nearestClosedDoor(x, y, reach = 90) {
        let best = null;
        let bestDist = reach;
        for (const door of this.level.doors) {
            if (door.open) continue;
            const dist = Math.hypot(door.x + door.w / 2 - x, door.y + door.h / 2 - y);
            if (dist > bestDist) continue;
            best = door;
            bestDist = dist;
        }
        return best;
    }

    update(time, delta) {
        const dt = Math.min(delta, 50);
        this.inputCtl.update(dt);
        // Systems that report noises stamp them with this, and combat prunes
        // against the same clock.
        this.ctx.now = time;

        if (!this.paused && !this.outcome) {
            for (const hostile of this.hostiles) {
                if (isVehicle(hostile)) updateVehicle(hostile, dt, this.ctx);
                else updateHostile(hostile, dt, this.ctx);
            }
            for (const unit of this.units) unit.update(dt, this.ctx);
            for (const unit of this.units) unit.separate(this.units, this.ctx);
            updateCover(this.units, this.level);
            // What the ground is doing for each unit, so the roster can say so:
            // a rule the player cannot see is a rule they will never use.
            for (const unit of this.units) {
                unit.concealed = this.vision.concealedAt(unit.x, unit.y);
                unit.elevated = this.vision.elevatedAt(unit.x, unit.y);
            }
            this.combat.update(dt, this.units, time);
            // Smoke is an occluder like any other, it just moves: hand the
            // current clouds to the vision system before anything asks what it
            // can see this frame.
            this.vision.setClouds(this.combat.clouds);
            updateSupport(this.units, dt, this.combat.events);
            this.effects.update(dt, this.combat.projectiles);
            for (const unit of this.units) {
                if (isVehicle(unit) && !unit.alive && !unit.hulked) {
                    unit.hulked = true;
                    this.wreckVehicle(unit);
                }
            }
            this.alarm.update(dt, this.ctx);
            this.announceAlarm();
            this.objectives.update(dt, this.ctx);
            this.announceObjectives();
            if (this.startedAt === null) this.startedAt = time;
            this.checkOutcome(time);
        }

        // One event stream, two consumers: the audio engine reads `type`, the
        // particle system reads `kind` and the extras that come with it. Drained
        // even while paused, so the last shots before a pause are not swallowed.
        if (this.combat.events.length > 0) {
            for (const event of this.combat.events) {
                if (event.kind === 'shot') this.shotsFired++;
                if (event.kind === 'coverBreak') this.coverDestroyed(event);
                if (event.kind === 'explosion') this.decals.scorch(event.x, event.y, event.radius);
                if (event.type === 'down') this.decals.blood(event.x, event.y, event.angle || 0, event.team !== 'friendly');
                this.audio.play(event.type, event.x, event.y);
                this.effects.handle(event);
                this.recordEvent(event);
            }
            this.combat.events.length = 0;
        }

        // Selection can outlive its units.
        if (this.selected.some((u) => !u.alive)) {
            this.selectUnits(this.selected.filter((u) => u.alive));
        }

        const polygons = this.squad
            .filter((u) => u.alive)
            .map((u) => this.vision.visibilityPolygon(u.x, u.y, this.vision.sightRadius(u)));
        this.fog.update(polygons);

        this.entities.draw({
            units: this.units,
            projectiles: this.combat.projectiles,
            explosions: this.combat.explosions,
            clouds: this.combat.clouds,
            objectives: this.objectives,
            effects: this.effects,
            time,
            vision: this.vision,
            friendlies: this.squad,
            selected: this.selected,
        });
    }

    // Kills, casualties and breaches worth a line in the feed. Hits are far too
    // frequent to report, but they do mark the unit so the renderer can show
    // where the round came from.
    recordEvent(event) {
        if (event.kind === 'hit') {
            const victim = this.units.find((u) => u.id === event.victim);
            if (victim) {
                victim.lastHitAngle = event.angle;
                victim.lastHitAt = this.time.now;
            }
            if (event.type !== 'down') return;

            const name = victim ? victim.stats.name : 'Hostile';
            if (event.team === 'friendly') {
                this.pushFeed(`${name} is DOWN`, '#ff6b6b');
            } else {
                const by = event.by ? `${event.by} \u25b8 ` : '';
                this.pushFeed(`${by}${name}`, '#cfe9ff');
            }
        } else if (event.kind === 'explosion') {
            this.pushFeed('Grenade out', '#ffd24a');
        }
    }

    // The alarm reports itself: a line in the feed and, when it goes up, a sound
    // the player will learn to dread.
    announceAlarm() {
        for (const change of this.alarm.drain()) {
            if (change === ALARMED) {
                this.audio.play('alarm');
                this.pushFeed('ALARM RAISED — they know you are here', '#ff6b6b');
            } else if (change === 'reinforcements') {
                this.audio.play('alarm');
                this.pushFeed('Reinforcements inbound', '#ff8a3a');
            } else {
                this.pushFeed('Something got their attention', '#ffd24a');
            }
        }
    }

    announceObjectives() {
        for (const objective of this.objectives.drain()) {
            this.audio.play('objective');
            this.pushFeed(`✔ ${objective.label || objective.kind}`, '#7df07d');
        }
    }

    pushFeed(text, color) {
        this.feed.unshift({ text, color, at: this.time.now });
        this.feed.length = Math.min(this.feed.length, 5);
    }

    // The mission ends when its objectives say so, not when the last hostile
    // falls — on two of the three maps those are different moments.
    checkOutcome(time) {
        if (this.objectives.failed) {
            this.outcome = 'lose';
            this.failure = this.objectives.failure;
        } else if (this.objectives.complete) {
            this.outcome = 'win';
        } else if (this.squad.every((u) => !u.alive && !u.downed)) {
            // A downed squadmate is not a lost one until it bleeds out.
            this.outcome = 'lose';
            this.failure = 'Squad eliminated';
        }
        if (this.outcome && !this.outcomeAnnounced) {
            this.outcomeAnnounced = true;
            this.audio.play(this.outcome);
            this.rating = rateMission({
                timeMs: time - (this.startedAt ?? time),
                casualties: this.squad.filter((u) => !u.alive && !u.downed).length,
                alarmRaised: this.alarm.everAlarmed,
                bonusDone: this.objectives.list.some((o) => o.optional && o.done),
            });
        }
    }

    getHudState() {
        const lead = this.selected.length > 0 ? this.selected[0] : null;
        return {
            cls: lead ? lead.cls : null,
            kit: lead ? lead.kit : null,
            // What the order palette needs to show the state of the selection.
            hasSelection: this.selected.length > 0,
            stance: lead ? lead.order.stance : 'free',
            pace: lead ? lead.order.pace : 'normal',
            // Totals across the selection, since an aimed throw goes to whoever
            // in it is best placed rather than to the lead.
            kitTotals: this.selected.reduce((sum, u) => {
                for (const key of Object.keys(u.kit)) sum[key] = (sum[key] || 0) + u.kit[key];
                return sum;
            }, {}),
            suppressing: this.selected.some((u) => u.order.suppressAt),
            stacked: this.squad.filter((u) => u.alive && u.order.stackAt).length,
            pendingOrder: this.pendingOrder,
            hostilesTotal: this.hostiles.length,
            hostilesDown: this.hostiles.filter((u) => !u.alive).length,
            squadTotal: this.squad.length,
            squadAlive: this.squad.filter((u) => u.alive).length,
            squadDown: this.squad.filter((u) => u.downed).length,
            feed: this.feed,
            alarm: this.alarm.state,
            objectives: this.objectives.status(),
            shotsFired: this.shotsFired,
            paused: this.paused,
            outcome: this.outcome,
            failure: this.failure,
            rating: this.rating,
            muted: this.audio.muted || !this.audio.available,
        };
    }
}

// Spread a move order into a loose block so a four-man stack does not try to
// occupy one pixel.
function formationTargets(x, y, count) {
    if (count === 1) return [{ x, y }];
    const spacing = 46;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const targets = [];
    for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        targets.push({
            x: x + (col - (cols - 1) / 2) * spacing,
            y: y + (row - (rows - 1) / 2) * spacing,
        });
    }
    return targets;
}
