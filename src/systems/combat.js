// Weapons, tracers and damage. Friendlies engage anything they can see without
// being told to; hostiles only shoot once their brain has flipped to ENGAGE.

import { rectContains, solidRects, sandbagArcs, pointInSandbag } from '../level.js';
import { SUPPRESSION, COVER, ORDERS, TOOLS, AI, ALARM } from '../config.js';
import { isSprinting } from './orders.js';

const AIM_TOLERANCE = 0.2;      // rad of error allowed before the trigger is pulled
const SUBSTEP = 8;              // px per collision substep, keeps tracers from tunnelling
const BLAST_FRIENDLY_SCALE = 0.5;
const EXPLOSION_TTL = 320;      // ms the detonation flash stays on screen
const NOISE_MEMORY = 900;       // ms a gunshot stays audible to the AI

export class CombatSystem {
    constructor(level, vision) {
        this.level = level;
        this.vision = vision;
        this.projectiles = [];
        this.explosions = [];
        this.clouds = [];       // smoke: blocks sight, not bullets
        this.charges = [];      // set on a door, counting down
        this.noises = [];
        // Sound events for the frame, drained by the scene. Combat stays unaware
        // of the audio engine; it just reports what happened and where.
        this.events = [];
        this.blockers = solidRects(level);
        this.arcs = sandbagArcs(level);
    }

    // Doors change the bullet-blocking geometry too.
    refreshBlockers() {
        this.blockers = solidRects(this.level);
    }

    update(dt, units, now) {
        const friendlies = units.filter((u) => u.alive && u.team === 'friendly');
        const hostiles = units.filter((u) => u.alive && u.team === 'hostile');

        for (const unit of units) {
            if (!unit.alive) continue;
            if (unit.stats.noncombatant) continue;   // hostages do not fight

            // An aimed throw outranks everything: the player asked for it by
            // hand and knows better than the acquisition rules what it is for.
            if (unit.order.throwAt) {
                this.aimedThrow(unit, now);
                continue;
            }
            // Rounds on a patch of ground need no target, only reach.
            if (unit.order.suppressAt) {
                this.suppressGround(unit, now);
                continue;
            }

            this.acquire(unit, unit.isFriendly ? hostiles : friendlies);
            if (!unit.target) continue;

            unit.aimAngle = Math.atan2(unit.target.y - unit.y, unit.target.x - unit.x);
            // A tank's main gun runs on its own timer, the way the grenadier's
            // arm does, and takes the shot when the coax is not the right answer.
            if (this.mayFireMain(unit)) {
                this.fireMain(unit, now);
                continue;
            }
            if (!this.mayFire(unit)) continue;
            // A grenade is worth more than a burst when the target is far
            // enough away and the squad is clear of the blast.
            if (this.mayThrow(unit, friendlies)) this.throwGrenade(unit, now, unit.target);
            else this.fire(unit, now);
        }

        this.stepProjectiles(dt, units);
        this.stepClouds(dt);
        for (const blast of this.explosions) blast.ttl -= dt;
        this.explosions = this.explosions.filter((blast) => blast.ttl > 0);
        // Pruned in place, not reassigned: the hostile brain and the alarm each
        // hold a reference to this array, and swapping it for a new one leaves
        // them reading a list that never changes again.
        for (let i = this.noises.length - 1; i >= 0; i--) {
            if (now - this.noises[i].time >= NOISE_MEMORY) this.noises.splice(i, 1);
        }
    }

    // Smoke blooms, hangs, then thins out. The radius is a function of age, and
    // the vision system reads it every frame it changes.
    stepClouds(dt) {
        for (const cloud of this.clouds) {
            cloud.age += dt;
            const grow = Math.min(1, cloud.age / TOOLS.smoke.growTime);
            const left = cloud.life - cloud.age;
            const fade = left >= TOOLS.smoke.fadeTime ? 1 : Math.max(0, left / TOOLS.smoke.fadeTime);
            cloud.radius = cloud.full * grow * fade;
            cloud.alpha = fade;
        }
        this.clouds = this.clouds.filter((c) => c.age < c.life);
    }

    addCloud(x, y) {
        this.clouds.push({
            x, y,
            age: 0,
            life: TOOLS.smoke.duration,
            full: TOOLS.smoke.radius,
            radius: 1,
            alpha: 1,
        });
        this.events.push({ type: 'smokePop', kind: 'smoke', x, y });
    }

    acquire(unit, enemies) {
        // You cannot shoot what you cannot see, and a blind man sees nothing.
        if (unit.blinded > 0) {
            unit.target = null;
            return;
        }
        // Standing on raised ground buys reach as well as a view over cover.
        const reach = Math.min(this.vision.sightRadius(unit), unit.stats.weapon.range);
        const current = unit.target;
        if (current && current.alive && this.inReach(unit, current, reach)) return;

        let best = null;
        let bestDist = Infinity;
        for (const enemy of enemies) {
            const dist = Math.hypot(enemy.x - unit.x, enemy.y - unit.y);
            if (dist > reach || dist > bestDist) continue;
            if (!this.vision.canSeeUnit(unit.x, unit.y, enemy)) continue;
            best = enemy;
            bestDist = dist;
        }
        unit.target = best;
    }

    inReach(unit, target, reach) {
        const dist = Math.hypot(target.x - unit.x, target.y - unit.y);
        if (dist > reach) return false;
        return this.vision.canSeeUnit(unit.x, unit.y, target);
    }

    // Everything that stops a trigger being pulled regardless of what is being
    // shot at. Both aimed fire and ordered suppressive fire go through this.
    canShoot(unit) {
        if (unit.breaching) return false;
        if (unit.pinned) return false;                  // head down under fire
        if (unit.fireTimer > 0 || unit.burstGapTimer > 0) return false;
        if (unit.blinded > 0) return false;                        // flashbanged
        if (unit.reloadTimer > 0 || unit.mag <= 0) return false;   // empty or reloading
        if (unit.order.stance === 'hold') return false; // told to hold fire
        if (isSprinting(unit)) return false;            // weapon is down while running
        // The marksman has to plant before it can take the shot.
        if (unit.stats.steadyTime && unit.stationaryFor < unit.stats.steadyTime) return false;
        return true;
    }

    mayFire(unit) {
        if (!this.canShoot(unit)) return false;
        // Hostiles wait for their reaction time; the AI raises this flag.
        if (!unit.isFriendly && unit.ai.state !== 'engage') return false;
        let error = unit.aimAngle - unit.facing;
        error = Math.atan2(Math.sin(error), Math.cos(error));
        return Math.abs(error) <= AIM_TOLERANCE;
    }

    // Suppressive fire: rounds onto a patch of ground whether or not anybody is
    // standing there. Wider cone than aimed fire, and every round carries real
    // pressure even from weapons that normally suppress nobody — that pressure
    // is the entire reason the order exists.
    suppressGround(unit, now) {
        const point = unit.order.suppressAt;
        unit.target = null;
        unit.aimAngle = Math.atan2(point.y - unit.y, point.x - unit.x);

        if (Math.hypot(point.x - unit.x, point.y - unit.y) > unit.stats.weapon.range) return;
        if (!this.canShoot(unit)) return;
        let error = unit.aimAngle - unit.facing;
        error = Math.atan2(Math.sin(error), Math.cos(error));
        if (Math.abs(error) > AIM_TOLERANCE) return;

        this.fire(unit, now, {
            extraSpread: ORDERS.suppressSpread,
            suppression: Math.max(unit.stats.suppressionPerHit || 0, ORDERS.suppressSuppression),
        });
    }

    // The main gun is for armour and for anything a burst of coax will not fix.
    // It aims with the turret, so a tank can shoot one way while driving another.
    mayFireMain(unit) {
        const gun = unit.stats.mainGun;
        if (!gun || !unit.target) return false;
        if (unit.mainGunTimer > 0 || unit.breaching) return false;
        if (unit.order.stance === 'hold') return false;
        if (!unit.isFriendly && unit.ai.state !== 'engage') return false;

        const dist = Math.hypot(unit.target.x - unit.x, unit.target.y - unit.y);
        if (dist < gun.minRange) return false;
        // Armour is always worth a shell; infantry only at a range the coax
        // cannot reach anyway.
        if (!unit.target.stats.vehicle && dist < unit.stats.weapon.range * 0.75) return false;

        let error = unit.aimAngle - unit.turretAngle;
        error = Math.atan2(Math.sin(error), Math.cos(error));
        return Math.abs(error) <= AIM_TOLERANCE;
    }

    fireMain(unit, now) {
        const gun = unit.stats.mainGun;
        const angle = unit.turretAngle + (Math.random() - 0.5) * 2 * gun.spread;
        const muzzleX = unit.x + Math.cos(unit.turretAngle) * (unit.radius + 26);
        const muzzleY = unit.y + Math.sin(unit.turretAngle) * (unit.radius + 26);

        this.projectiles.push({
            kind: 'shell',
            x: muzzleX,
            y: muzzleY,
            px: muzzleX,
            py: muzzleY,
            vx: Math.cos(angle) * gun.speed,
            vy: Math.sin(angle) * gun.speed,
            radius: gun.radius,
            damage: gun.damage,
            penetration: gun.penetration,
            team: unit.team,
            owner: unit,
            travelled: 0,
            maxDist: 1400,
        });

        this.events.push({
            type: gun.sound || 'mainGun',
            kind: 'mainGun',
            x: muzzleX,
            y: muzzleY,
            angle: unit.turretAngle,
            cls: unit.cls,
            unit: unit.id,
        });
        unit.mainGunTimer = gun.cooldown;
        unit.muzzleFlash = 140;
        unit.recoil = 1;
        this.noise(unit, now, true);
    }

    // A throw the player placed by hand. It waits for the arm to be free rather
    // than being dropped, so ordering one during a reload still works.
    aimedThrow(unit, now) {
        const order = unit.order.throwAt;
        unit.target = null;
        unit.aimAngle = Math.atan2(order.y - unit.y, order.x - unit.x);

        if (unit.breaching || unit.grenadeTimer > 0 || unit.fireTimer > 0) return;
        if (unit.kit[order.kind] <= 0) {
            unit.order.throwAt = null;
            return;
        }
        let error = unit.aimAngle - unit.facing;
        error = Math.atan2(Math.sin(error), Math.cos(error));
        if (Math.abs(error) > AIM_TOLERANCE) return;

        this.throwGrenade(unit, now, order, order.kind);
        unit.order.throwAt = null;
    }

    // Frags are held back at knife range, when the arm is on cooldown, or
    // whenever a squadmate is standing in the blast.
    mayThrow(unit, friendlies) {
        const grenade = unit.stats.grenade;
        if (!grenade || unit.kit.frag <= 0 || unit.grenadeTimer > 0) return false;

        const target = unit.target;
        const dist = Math.hypot(target.x - unit.x, target.y - unit.y);
        if (dist < grenade.minRange) return false;

        for (const mate of friendlies) {
            if (mate === unit) continue;
            if (Math.hypot(mate.x - target.x, mate.y - target.y) < grenade.radius * 0.9) return false;
        }
        return true;
    }

    // Flight parameters for a throwable. The grenadier's frag keeps its own
    // tuned block; everything else comes from the shared TOOLS table.
    throwSpec(unit, kind) {
        if (kind === 'frag' && unit.stats.grenade) return unit.stats.grenade;
        return TOOLS[kind];
    }

    // `target` is any {x, y}: the unit's current contact for an automatic throw,
    // or the spot the player picked for an aimed one.
    throwGrenade(unit, now, target, kind = 'frag') {
        const spec = this.throwSpec(unit, kind);
        const angle = Math.atan2(target.y - unit.y, target.x - unit.x);
        const muzzleX = unit.x + Math.cos(angle) * (unit.radius + 10);
        const muzzleY = unit.y + Math.sin(angle) * (unit.radius + 10);

        this.projectiles.push({
            kind: 'grenade',
            throwable: kind,
            x: muzzleX,
            y: muzzleY,
            vx: Math.cos(angle) * spec.speed,
            vy: Math.sin(angle) * spec.speed,
            aim: { x: target.x, y: target.y },
            radius: spec.radius,
            damage: spec.damage || 0,
            penetration: spec.penetration,
            team: unit.team,
            owner: unit,
            travelled: 0,
            maxDist: Math.hypot(target.x - muzzleX, target.y - muzzleY),
        });

        this.events.push({
            type: 'grenadeThrow',
            kind: 'grenade',
            x: muzzleX,
            y: muzzleY,
            angle,
            cls: unit.cls,
            unit: unit.id,
        });
        unit.recoil = 1;
        unit.muzzleFlash = 60;
        unit.kit[kind] -= 1;
        unit.grenadeTimer = spec.cooldown;
        unit.fireTimer = Math.max(unit.fireTimer, 700);
        // A canister landing is loud whatever is inside it.
        this.noise(unit, now, true);
    }

    fire(unit, now, opts = {}) {
        const weapon = unit.stats.weapon;
        const muzzleX = unit.x + Math.cos(unit.facing) * (unit.radius + 12);
        const muzzleY = unit.y + Math.sin(unit.facing) * (unit.radius + 12);
        const pellets = weapon.pellets || 1;
        // A target tucked behind a barricade is harder to hit, on top of the
        // rounds the barricade itself eats.
        const covered = unit.target ? unit.target.inCover || 0 : 0;
        const spread = weapon.spread + covered * COVER.spreadPenalty + (opts.extraSpread || 0);
        const suppression = opts.suppression ?? (unit.stats.suppressionPerHit || 0);

        for (let i = 0; i < pellets; i++) {
            const angle = unit.facing + (Math.random() - 0.5) * 2 * spread;
            this.projectiles.push({
                x: muzzleX,
                y: muzzleY,
                px: muzzleX,
                py: muzzleY,
                vx: Math.cos(angle) * weapon.bulletSpeed,
                vy: Math.sin(angle) * weapon.bulletSpeed,
                damage: weapon.damage,
                penetration: weapon.penetration || 0,
                suppression,
                team: unit.team,
                owner: unit,
                travelled: 0,
                maxDist: weapon.range * 1.2,
            });
        }

        this.events.push({
            type: weapon.sound || 'carbine',
            kind: 'shot',
            x: muzzleX,
            y: muzzleY,
            angle: unit.facing,
            cls: unit.cls,
            unit: unit.id,
            suppressed: !!weapon.suppressed,
        });
        unit.fireTimer = weapon.cooldown;
        unit.muzzleFlash = 95;
        unit.recoil = 1;
        unit.burstLeft -= 1;
        // One round per trigger pull, buckshot included: a shotgun shell throws
        // several pellets but costs one shell.
        unit.mag -= 1;
        if (unit.mag <= 0 && unit.startReload()) {
            this.events.push({ type: 'reload', kind: 'reload', x: unit.x, y: unit.y, unit: unit.id });
        }
        if (unit.burstLeft <= 0) {
            unit.burstLeft = weapon.burst;
            unit.burstGapTimer = weapon.burstGap;
        }
        this.noise(unit, now, !weapon.suppressed);
    }

    // What the shot sounded like from a distance. A suppressed weapon carries a
    // fraction as far and never sets the alarm off by itself, which is the whole
    // reason to bring one.
    noise(unit, now, loud) {
        this.noises.push({
            x: unit.x,
            y: unit.y,
            team: unit.team,
            time: now,
            loud,
            radius: loud ? AI.hearingRange : AI.hearingRange * ALARM.suppressedHearingScale,
        });
    }

    stepProjectiles(dt, units) {
        const seconds = dt / 1000;
        const alive = [];

        for (const bullet of this.projectiles) {
            const totalX = bullet.vx * seconds;
            const totalY = bullet.vy * seconds;
            const distance = Math.hypot(totalX, totalY);
            const steps = Math.max(1, Math.ceil(distance / SUBSTEP));
            bullet.px = bullet.x;
            bullet.py = bullet.y;

            let dead = false;
            for (let i = 0; i < steps && !dead; i++) {
                bullet.x += totalX / steps;
                bullet.y += totalY / steps;
                bullet.travelled += distance / steps;

                if (bullet.kind === 'shell') {
                    // Unlike a thrown grenade, a shell goes off on the first
                    // thing it meets — geometry or a body.
                    const struck = units.find((u) => u.alive && u.team !== bullet.team
                        && Math.hypot(u.x - bullet.x, u.y - bullet.y) <= u.radius);
                    if (struck || bullet.travelled >= bullet.maxDist || this.hitsGeometry(bullet.x, bullet.y)) {
                        this.explode({
                            x: bullet.x,
                            y: bullet.y,
                            radius: bullet.radius,
                            damage: bullet.damage,
                            penetration: bullet.penetration,
                            team: bullet.team,
                            sound: 'shellImpact',
                        }, units);
                        dead = true;
                    }
                    continue;
                }

                if (bullet.kind === 'grenade') {
                    // Grenades sail over heads and detonate where they land, or
                    // against the first wall they meet.
                    if (bullet.travelled >= bullet.maxDist || this.hitsGeometry(bullet.x, bullet.y)) {
                        this.detonate(bullet, units);
                        dead = true;
                    }
                    continue;
                }

                if (bullet.travelled > bullet.maxDist) { dead = true; break; }
                if (this.hitsGeometry(bullet.x, bullet.y)) {
                    this.events.push({
                        type: 'impact',
                        kind: 'impact',
                        x: bullet.x,
                        y: bullet.y,
                        angle: Math.atan2(bullet.vy, bullet.vx),
                    });
                    dead = true;
                    break;
                }

                for (const unit of units) {
                    if (!unit.alive || unit.team === bullet.team) continue;
                    const dx = unit.x - bullet.x;
                    const dy = unit.y - bullet.y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq <= unit.radius * unit.radius) {
                        if (bullet.suppression) unit.addSuppression(bullet.suppression);
                        const angle = Math.atan2(bullet.vy, bullet.vx);
                        const standing = unit.alive;
                        const bit = unit.takeDamage(bullet.damage, {
                            penetration: bullet.penetration || 0,
                            angle,
                        });
                        // A round that does not get through is still a round
                        // that stops here, and it says so — a ricochet is how
                        // the player learns the front plate is not the way in.
                        this.events.push({
                            type: !bit ? 'ricochet' : (standing && !unit.alive ? 'down' : 'hit'),
                            kind: bit ? 'hit' : 'ricochet',
                            x: unit.x,
                            y: unit.y,
                            angle,
                            team: unit.team,
                            victim: unit.id,
                            by: bullet.owner ? bullet.owner.stats.name : null,
                        });
                        dead = true;
                        break;
                    }
                    // A round cracking past is nearly as good as a hit for
                    // keeping someone's head down — but count each round once,
                    // not once per collision substep.
                    if (bullet.suppression && distSq <= SUPPRESSION.nearMissRadius * SUPPRESSION.nearMissRadius) {
                        if (!bullet.grazed) bullet.grazed = new Set();
                        if (!bullet.grazed.has(unit.id)) {
                            bullet.grazed.add(unit.id);
                            unit.addSuppression(bullet.suppression * 0.5);
                        }
                    }
                }
            }
            if (!dead) alive.push(bullet);
        }

        this.projectiles = alive;
    }

    // What a throwable does when it lands. Smoke leaves a cloud, a flashbang
    // blinds whoever was looking at it, everything else goes off.
    detonate(grenade, units) {
        if (grenade.throwable === 'smoke') {
            this.addCloud(grenade.x, grenade.y);
            return;
        }
        if (grenade.throwable === 'flash') {
            this.flash(grenade.x, grenade.y, units);
            return;
        }
        this.explode({
            x: grenade.x,
            y: grenade.y,
            radius: grenade.radius,
            damage: grenade.damage,
            penetration: grenade.penetration,
            team: grenade.team,
        }, units);
    }

    // Blast damage falls off linearly to the edge of the radius, and only walls
    // between the burst and a body spare it — smoke does not.
    explode(blast, units) {
        for (const unit of units) {
            if (!unit.alive) continue;
            const dist = Math.hypot(unit.x - blast.x, unit.y - blast.y);
            if (dist > blast.radius) continue;
            if (!this.vision.hasLineOfSight(blast.x, blast.y, unit.x, unit.y)) continue;

            const falloff = 1 - dist / blast.radius;
            const scale = unit.team === blast.team ? BLAST_FRIENDLY_SCALE : 1;
            const standing = unit.alive;
            unit.takeDamage(blast.damage * falloff * scale, {
                penetration: blast.penetration,
                angle: Math.atan2(unit.y - blast.y, unit.x - blast.x),
            });
            if (standing && !unit.alive) this.events.push({ type: 'down', x: unit.x, y: unit.y });
            unit.addSuppression(SUPPRESSION.threshold * falloff);
        }
        this.damageCover(blast);
        this.explosions.push({ x: blast.x, y: blast.y, radius: blast.radius, ttl: EXPLOSION_TTL });
        this.events.push({
            type: blast.sound || 'explosion',
            kind: 'explosion',
            x: blast.x,
            y: blast.y,
            radius: blast.radius,
        });
    }

    // Cover is spent, not permanent. A blast chews through crates and sandbag
    // lines; what is left is rubble, which is still something to get behind but
    // slow and loud to cross.
    damageCover(blast) {
        const destroyed = [];
        for (const prop of this.level.props) {
            if (!Number.isFinite(prop.hp) || prop.hp <= 0) continue;
            const reach = prop.type === 'sandbags' ? prop.radius : Math.max(prop.w, prop.h) / 2;
            const dist = Math.hypot(prop.x - blast.x, prop.y - blast.y);
            if (dist > blast.radius + reach) continue;

            const falloff = 1 - Math.min(1, Math.max(0, dist - reach) / blast.radius);
            prop.hp -= blast.damage * falloff;
            if (prop.hp <= 0) destroyed.push(prop);
        }
        if (destroyed.length === 0) return;

        for (const prop of destroyed) {
            const index = this.level.props.indexOf(prop);
            if (index >= 0) this.level.props.splice(index, 1);
            const rect = propRect(prop);
            this.level.terrain = this.level.terrain || [];
            this.level.terrain.push({ kind: 'rubble', ...rect });
            // No sound of its own: it rides the wall-strike clip, which is
            // what splintering cover sounds like anyway.
            this.events.push({ type: 'impact', kind: 'coverBreak', x: prop.x, y: prop.y, rect });
        }
    }

    // A flashbang hurts nobody. It takes eyes and ears out of the fight for a
    // few seconds, which is the whole point: a room can be entered without
    // killing what is inside it.
    flash(x, y, units) {
        for (const unit of units) {
            if (!unit.alive) continue;
            const dist = Math.hypot(unit.x - x, unit.y - y);
            if (dist > TOOLS.flash.radius) continue;
            // Behind a wall is behind a wall — you have to have seen it.
            if (!this.vision.hasLineOfSight(x, y, unit.x, unit.y)) continue;
            const falloff = 1 - dist / TOOLS.flash.radius;
            unit.blind(TOOLS.flash.blindTime * falloff);
            unit.addSuppression(SUPPRESSION.max * falloff);
        }
        this.explosions.push({ x, y, radius: TOOLS.flash.radius, ttl: EXPLOSION_TTL, flash: true });
        this.events.push({ type: 'flashBang', kind: 'flash', x, y, radius: TOOLS.flash.radius });
    }

    // A breaching charge: the door goes in and whatever is behind it catches the
    // blast. Fired by the scene once the door has actually opened.
    blastDoor(door, units) {
        this.explode({
            x: door.x + door.w / 2,
            y: door.y + door.h / 2,
            radius: TOOLS.charge.radius,
            damage: TOOLS.charge.damage,
            penetration: TOOLS.charge.penetration,
            team: 'friendly',
            sound: 'charge',
        }, units);
    }

    hitsGeometry(x, y) {
        for (const rect of this.blockers) {
            if (rectContains(rect, x, y)) return true;
        }
        for (const arc of this.arcs) {
            if (pointInSandbag(arc, x, y)) return true;
        }
        return false;
    }
}

// The ground a prop stands on, as a rect. Sandbag arcs get their bounding box,
// which is what the rubble left behind should cover.
function propRect(prop) {
    if (prop.type === 'sandbags') {
        const r = prop.radius + 20;
        return { x: prop.x - r, y: prop.y - r, w: r * 2, h: r * 2 };
    }
    return { x: prop.x - prop.w / 2, y: prop.y - prop.h / 2, w: prop.w, h: prop.h };
}
