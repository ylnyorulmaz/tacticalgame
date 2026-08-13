// Per-frame drawing of everything that moves: units, their weapon, corpses with
// the black X, tracers, doors, selection rings, HP bars and pending move orders.
//
// Depth order matters: corpses and doors sit *under* the fog so they stay hidden
// in rooms nobody has entered, while live units and order lines sit above it.

import { COLORS, SUPPRESSION, DOWNED } from '../config.js';
import { GUN, drawWeapon, drawMuzzleFlash, gunAnchor, muzzleReach, fillRotatedRect } from './weapons.js';

export { GUN, fillRotatedRect };

export class EntityRenderer {
    constructor(scene) {
        this.doorLayer = scene.add.graphics().setDepth(8);
        this.groundLayer = scene.add.graphics().setDepth(6);
        // Spent brass and drifting smoke sit under the units; flashes, tracers
        // and sparks sit over them.
        this.debrisLayer = scene.add.graphics().setDepth(29);
        this.unitLayer = scene.add.graphics().setDepth(30);
        this.effectLayer = scene.add.graphics().setDepth(31);
        this.overlayLayer = scene.add.graphics().setDepth(32);
    }

    drawDoors(level) {
        const g = this.doorLayer;
        g.clear();
        for (const door of level.doors) {
            const cx = door.x + door.w / 2;
            const cy = door.y + door.h / 2;
            if (door.open) {
                // Swung leaf: a bar hinged out of the frame, as in the reference art.
                const length = door.axis === 'h' ? door.w : door.h;
                const angle = door.axis === 'h' ? -Math.PI / 3 : Math.PI / 6;
                g.fillStyle(COLORS.wall, 1);
                fillRotatedRect(
                    g,
                    cx + Math.cos(angle) * length * 0.5,
                    cy + Math.sin(angle) * length * 0.5,
                    length,
                    8,
                    angle,
                );
            } else {
                g.fillStyle(COLORS.wall, 1);
                g.fillRect(door.x, door.y, door.w, door.h);
                g.fillStyle(COLORS.floor, 0.85);
                if (door.axis === 'h') g.fillRect(door.x + 4, door.y + 5, door.w - 8, 6);
                else g.fillRect(door.x + 5, door.y + 4, 6, door.h - 8);
            }
        }
    }

    draw(state) {
        const { units, projectiles, explosions, effects, vision, friendlies, selected, clouds } = state;
        const ground = this.groundLayer;
        const top = this.unitLayer;
        const overlay = this.overlayLayer;
        const debris = this.debrisLayer;
        const fx = this.effectLayer;
        ground.clear();
        top.clear();
        overlay.clear();
        debris.clear();
        fx.clear();

        const visible = (x, y) => vision.canAnySee(friendlies, x, y);
        if (effects) effects.draw(debris, fx, visible);

        // Objective markers go on the ground, under the fog: an extraction zone
        // you have not scouted stays hidden like everything else.
        if (state.objectives) drawObjectives(ground, state.objectives, state.time);

        for (const unit of units) {
            if (unit.alive) continue;
            drawCorpse(ground, unit);
            // A casualty is still savable, so it gets a live marker above the fog.
            if (unit.downed) drawDownedMarker(overlay, unit, state.time);
        }

        for (const unit of units) {
            if (!unit.alive) continue;
            const onScreen = unit.isFriendly || visible(unit.x, unit.y);
            if (!onScreen) {
                if (unit.lastKnownToPlayer) drawGhost(overlay, unit.lastKnownToPlayer);
                continue;
            }
            unit.lastKnownToPlayer = { x: unit.x, y: unit.y };
            if (unit.stats.noncombatant) drawHostage(top, unit, state.time);
            else drawUnit(top, fx, unit);
            if (unit.selected) drawSelection(overlay, unit);
            if (unit.hp < unit.maxHp) drawHealthBar(overlay, unit);
            if (unit.breaching) drawBreachRing(overlay, unit);
            if (unit.reviving) drawReviveLink(overlay, unit, unit.reviving);
            if (unit.pinned) drawPinned(overlay, unit);
            if (unit.inCover > 0.35) drawCoverMark(overlay, unit);
            if (unit.isFriendly && unit.order.stance === 'hold') drawHoldMark(overlay, unit);
            if (unit.blinded > 0) drawBlinded(overlay, unit, state.time);
            if (unit.lastHitAt && state.time - unit.lastHitAt < 700) {
                drawHitDirection(overlay, unit, (state.time - unit.lastHitAt) / 700);
            }
        }

        for (const bullet of projectiles) {
            if (!visible(bullet.x, bullet.y)) continue;
            if (bullet.kind === 'grenade') {
                drawGrenade(top, bullet);
                continue;
            }
            drawTracer(fx, bullet);
        }

        for (const blast of explosions) {
            if (!visible(blast.x, blast.y)) continue;
            if (blast.flash) drawFlash(fx, blast);
            else drawExplosion(fx, blast);
        }

        // Smoke sits above the units it is hiding — it is the reason they cannot
        // be seen, so it must not be drawn underneath them.
        for (const cloud of clouds || []) drawSmoke(overlay, cloud, state.time);

        // Standing orders for the selection, so the player can read back what
        // was asked for without waiting to see whether it happens.
        for (const unit of selected) {
            if (!unit.alive) continue;
            if (unit.path) drawOrder(overlay, unit);
            if (unit.order.suppressAt) drawSuppressOrder(overlay, unit);
            if (unit.order.stackAt) drawStackOrder(overlay, unit);
            if (unit.order.facing !== null) {
                const at = unit.path && unit.orderPoint ? unit.orderPoint : unit;
                drawFacingCone(overlay, at, unit.order.facing);
            }
        }
    }
}

// Where the mission is. An extraction zone is a hatched box, a pickup is a
// pulsing ring, and both stop being drawn once they are done with.
function drawObjectives(g, objectives, time) {
    const pulse = 0.55 + 0.45 * Math.sin(time / 320);

    for (const objective of objectives.list) {
        if (objective.kind === 'exfil') {
            const ready = objectives.required.every((o) => o === objective || o.done);
            const color = objective.done ? 0x7df07d : ready ? 0x7df07d : 0xcfe9ff;
            g.lineStyle(3, color, ready ? 0.4 + 0.4 * pulse : 0.4);
            g.strokeRect(objective.x, objective.y, objective.w, objective.h);
            g.lineStyle(2, color, 0.22);
            for (let x = objective.x; x < objective.x + objective.w; x += 26) {
                g.lineBetween(
                    x, objective.y + objective.h,
                    Math.min(x + objective.h, objective.x + objective.w), objective.y,
                );
            }
            continue;
        }

        if (objective.kind === 'intel' && !objective.done) {
            g.lineStyle(3, 0xffd24a, 0.5 + 0.5 * pulse);
            g.strokeCircle(objective.x, objective.y, 26);
            if (objective.progress > 0) {
                g.lineStyle(4, 0x7df07d, 0.95);
                g.beginPath();
                g.arc(objective.x, objective.y, 32, -Math.PI / 2, -Math.PI / 2 + objective.progress * Math.PI * 2);
                g.strokePath();
            }
        }
    }
}

// A civilian: no weapon, and a ring so they are never mistaken for a shooter.
function drawHostage(g, unit, time) {
    const pulse = 0.6 + 0.4 * Math.sin(time / 260);
    g.fillStyle(0xf2e6c8, 1);
    g.fillCircle(unit.x, unit.y, unit.radius);
    g.lineStyle(3, unit.freed ? 0x7df07d : 0xffd24a, 0.5 + 0.4 * pulse);
    g.strokeCircle(unit.x, unit.y, unit.radius + 6);
    // Hands up: two short strokes rather than a gun.
    g.lineStyle(3, COLORS.gun, 0.9);
    for (const side of [-0.7, 0.7]) {
        g.lineBetween(
            unit.x + Math.cos(unit.facing + side) * 6,
            unit.y + Math.sin(unit.facing + side) * 6,
            unit.x + Math.cos(unit.facing + side) * 15,
            unit.y + Math.sin(unit.facing + side) * 15,
        );
    }
}

// Blinded: a stuttering white halo, so a flashbanged unit reads as "out of it"
// rather than as one that has simply stopped.
function drawBlinded(g, unit, time) {
    const flicker = 0.5 + 0.5 * Math.sin(time / 40);
    g.lineStyle(2, 0xfff2a8, 0.35 + 0.5 * flicker);
    g.strokeCircle(unit.x, unit.y, unit.radius + 8 + flicker * 3);
    for (let i = 0; i < 3; i++) {
        const angle = time / 90 + (i / 3) * Math.PI * 2;
        g.fillStyle(0xffffff, 0.5 * flicker);
        g.fillCircle(
            unit.x + Math.cos(angle) * (unit.radius + 12),
            unit.y + Math.sin(angle) * (unit.radius + 12),
            2.5,
        );
    }
}

// A bank of smoke: several offset blobs that drift slowly, so the edge reads as
// smoke rather than as a circle someone drew.
function drawSmoke(g, cloud, time) {
    const puffs = 7;
    for (let i = 0; i < puffs; i++) {
        const spin = time / 3600 + (i / puffs) * Math.PI * 2;
        const drift = cloud.radius * 0.42;
        const x = cloud.x + Math.cos(spin) * drift;
        const y = cloud.y + Math.sin(spin * 1.3) * drift * 0.8;
        g.fillStyle(0xd8ddd9, 0.2 * cloud.alpha);
        g.fillCircle(x, y, cloud.radius * 0.62);
    }
    g.fillStyle(0xe6eae7, 0.3 * cloud.alpha);
    g.fillCircle(cloud.x, cloud.y, cloud.radius * 0.7);
}

// A flashbang is light, not fire: a white bloom and an expanding ring.
function drawFlash(g, blast) {
    const life = Math.max(0, Math.min(1, blast.ttl / 320));
    g.fillStyle(0xffffff, 0.75 * life);
    g.fillCircle(blast.x, blast.y, blast.radius * (1.05 - life * 0.35));
    g.lineStyle(4, 0xfff2a8, life);
    g.strokeCircle(blast.x, blast.y, blast.radius * (1.25 - life));
}

// The arc a unit will be watching when it gets where it is going.
function drawFacingCone(g, at, angle) {
    const reach = 62;
    const spread = 0.45;
    g.lineStyle(2, COLORS.friendlySel, 0.55);
    for (const side of [-1, 1]) {
        g.lineBetween(
            at.x, at.y,
            at.x + Math.cos(angle + side * spread) * reach,
            at.y + Math.sin(angle + side * spread) * reach,
        );
    }
    g.beginPath();
    g.arc(at.x, at.y, reach, angle - spread, angle + spread);
    g.strokePath();
}

// A beaten zone: where the rounds are going and roughly how wide the cone is.
function drawSuppressOrder(g, unit) {
    const point = unit.order.suppressAt;
    g.lineStyle(2, 0xffd24a, 0.5);
    g.lineBetween(unit.x, unit.y, point.x, point.y);
    g.lineStyle(2, 0xffd24a, 0.9);
    g.strokeCircle(point.x, point.y, 26);
    g.lineBetween(point.x - 34, point.y, point.x - 16, point.y);
    g.lineBetween(point.x + 16, point.y, point.x + 34, point.y);
    g.lineBetween(point.x, point.y - 34, point.x, point.y - 16);
    g.lineBetween(point.x, point.y + 16, point.x, point.y + 34);
}

// Waiting beside a door for the word.
function drawStackOrder(g, unit) {
    const door = unit.order.stackAt;
    const cx = door.x + door.w / 2;
    const cy = door.y + door.h / 2;
    g.lineStyle(2, 0x7fd8ff, 0.75);
    g.lineBetween(unit.x, unit.y, cx, cy);
    g.strokeCircle(cx, cy, 16);
    g.strokeCircle(unit.x, unit.y, unit.radius + 7);
}

// Weapons tight: an amber ring so a squad on hold is obvious at a glance.
function drawHoldMark(g, unit) {
    g.lineStyle(2, 0xffd24a, 0.85);
    const gap = 0.5;
    for (let i = 0; i < 4; i++) {
        const from = i * (Math.PI / 2) + gap / 2;
        g.beginPath();
        g.arc(unit.x, unit.y, unit.radius + 6, from, from + Math.PI / 2 - gap);
        g.strokePath();
    }
}

function drawUnit(g, flashLayer, unit) {
    const color = unit.isFriendly ? COLORS.friendly : COLORS.hostile;
    g.fillStyle(color, 1);
    g.fillCircle(unit.x, unit.y, unit.radius);

    const gun = GUN[unit.cls] || GUN.operator;
    const anchor = gunAnchor(unit, gun);
    drawWeapon(g, anchor.x, anchor.y, unit.facing, gun);
    if (gun.icon === 'cross') drawCrossIcon(g, unit);

    if (unit.muzzleFlash > 0) {
        const reach = muzzleReach(gun);
        drawMuzzleFlash(
            flashLayer,
            anchor.x + anchor.cos * reach,
            anchor.y + anchor.sin * reach,
            unit.facing,
            gun,
            Math.min(1, unit.muzzleFlash / 95),
        );
    }
}

function drawCorpse(g, unit) {
    const color = unit.isFriendly ? COLORS.friendly : COLORS.hostile;
    g.fillStyle(color, 1);
    g.fillCircle(unit.x, unit.y, unit.radius);

    // The weapon it was carrying, lying where it fell.
    if (unit.dropOffset) {
        drawWeapon(
            g,
            unit.x + unit.dropOffset.x,
            unit.y + unit.dropOffset.y,
            unit.dropAngle + Math.PI / 2,
            GUN[unit.cls] || GUN.operator,
        );
    }

    const r = unit.radius * 0.95;
    g.lineStyle(7, COLORS.gun, 1);
    g.lineBetween(unit.x - r, unit.y - r, unit.x + r, unit.y + r);
    g.lineBetween(unit.x + r, unit.y - r, unit.x - r, unit.y + r);
}

// The medic's red cross, straight off the reference art.
export function drawCrossIcon(g, unit, scale = 1) {
    const arm = 9 * scale;
    const thick = 3.4 * scale;
    g.fillStyle(0xffffff, 0.95);
    g.fillCircle(unit.x, unit.y, arm * 0.95);
    g.fillStyle(0xe02020, 1);
    g.fillRect(unit.x - arm * 0.62, unit.y - thick / 2, arm * 1.24, thick);
    g.fillRect(unit.x - thick / 2, unit.y - arm * 0.62, thick, arm * 1.24);
}

// A round is a dark streak with a hot tip: the streak keeps the flat look of the
// reference art, the tip keeps it visible against dark floors and bright grass
// alike. Faster rounds draw longer, so the marksman's shot reads as a lance and
// buckshot as a spray of stubs.
function drawTracer(g, bullet) {
    const speed = Math.hypot(bullet.vx, bullet.vy);
    const length = Math.min(46, Math.max(9, speed * 0.014));
    const ux = bullet.vx / speed;
    const uy = bullet.vy / speed;
    const tailX = bullet.x - ux * length;
    const tailY = bullet.y - uy * length;

    g.lineStyle(4, COLORS.gun, 0.5);
    g.lineBetween(tailX, tailY, bullet.x, bullet.y);
    g.lineStyle(2.4, COLORS.gun, 1);
    g.lineBetween(tailX + ux * length * 0.35, tailY + uy * length * 0.35, bullet.x, bullet.y);
    g.fillStyle(0xffe9a0, 0.95);
    g.fillCircle(bullet.x, bullet.y, 2.1);
}

function drawGrenade(g, bullet) {
    g.fillStyle(0x000000, 0.25);
    g.fillCircle(bullet.x + 4, bullet.y + 6, 6);
    g.fillStyle(0x2f3a2a, 1);
    g.fillCircle(bullet.x, bullet.y, 6);
    g.lineStyle(2, 0xffe066, 0.9);
    g.strokeCircle(bullet.x, bullet.y, 8.5);
}

function drawExplosion(g, blast) {
    const t = Math.max(0, Math.min(1, blast.ttl / 320));
    const radius = blast.radius * (1.05 - t * 0.35);
    g.fillStyle(0xffd24a, 0.28 * t);
    g.fillCircle(blast.x, blast.y, radius);
    g.lineStyle(5 * t + 1, 0xff8a1f, 0.85 * t);
    g.strokeCircle(blast.x, blast.y, radius);
    g.fillStyle(0xfff2b0, 0.85 * t);
    g.fillCircle(blast.x, blast.y, radius * 0.32 * t);
}

// Casualty marker: a pulsing ring that shrinks as the unit bleeds out, plus the
// revive progress arc once a medic is working on them.
function drawDownedMarker(g, unit, time) {
    const pulse = 0.5 + 0.5 * Math.sin((time || 0) * 0.006);
    const life = Math.max(0, Math.min(1, unit.bleedOut / DOWNED.bleedOut));
    g.lineStyle(2.5, 0xffffff, 0.35 + pulse * 0.45);
    g.strokeCircle(unit.x, unit.y, unit.radius + 8 + pulse * 3);
    g.lineStyle(4, 0xffd24a, 0.9);
    g.beginPath();
    g.arc(unit.x, unit.y, unit.radius + 14, -Math.PI / 2, -Math.PI / 2 + life * Math.PI * 2);
    g.strokePath();

    if (unit.reviveProgress > 0) {
        const progress = Math.min(1, unit.reviveProgress / (unit.reviveTotal || 1));
        g.lineStyle(4, 0x7df07d, 0.95);
        g.beginPath();
        g.arc(unit.x, unit.y, unit.radius + 20, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
        g.strokePath();
    }
}

function drawReviveLink(g, medic, casualty) {
    g.lineStyle(2, 0x7df07d, 0.75);
    g.lineBetween(medic.x, medic.y, casualty.x, casualty.y);
}

// Pinned hostiles get a chevron cluster: they are there, they just cannot answer.
function drawPinned(g, unit) {
    const ratio = Math.min(1, unit.suppression / SUPPRESSION.max);
    g.lineStyle(3, 0xffd24a, 0.9);
    for (let i = 0; i < 3; i++) {
        const r = unit.radius + 7 + i * 4;
        const spread = 0.5 + ratio * 0.35;
        g.beginPath();
        g.arc(unit.x, unit.y, r, -Math.PI / 2 - spread, -Math.PI / 2 + spread);
        g.strokePath();
    }
}

// Where the last round came from, so a squad taking fire from an unseen angle
// still tells you which way to look.
function drawHitDirection(g, unit, t) {
    const from = (unit.lastHitAngle || 0) + Math.PI;   // back along the bullet
    g.lineStyle(4, 0xff4d4d, 0.9 * (1 - t));
    g.beginPath();
    g.arc(unit.x, unit.y, unit.radius + 13, from - 0.5, from + 0.5);
    g.strokePath();
}

// A quiet bracket under a unit that is actually using cover.
function drawCoverMark(g, unit) {
    g.lineStyle(3, 0x7df07d, 0.35 + unit.inCover * 0.5);
    g.beginPath();
    g.arc(unit.x, unit.y, unit.radius + 5, Math.PI * 0.15, Math.PI * 0.85);
    g.strokePath();
}

function drawGhost(g, point) {
    g.lineStyle(2, COLORS.hostile, 0.35);
    g.strokeCircle(point.x, point.y, 15);
    g.lineStyle(2, COLORS.hostile, 0.2);
    g.strokeCircle(point.x, point.y, 22);
}

function drawSelection(g, unit) {
    g.lineStyle(3, COLORS.friendlySel, 0.95);
    g.strokeCircle(unit.x, unit.y, unit.radius + 6);
    g.lineStyle(2, COLORS.friendlySel, 0.35);
    g.strokeCircle(unit.x, unit.y, unit.radius + 11);
}

function drawHealthBar(g, unit) {
    const width = 34;
    const height = 5;
    const x = unit.x - width / 2;
    const y = unit.y - unit.radius - 13;
    const ratio = Math.max(0, unit.hp / unit.maxHp);
    g.fillStyle(0x000000, 0.55);
    g.fillRect(x - 1, y - 1, width + 2, height + 2);
    const color = ratio > 0.6 ? COLORS.hp : ratio > 0.3 ? COLORS.hpLow : COLORS.hpCrit;
    g.fillStyle(color, 1);
    g.fillRect(x, y, width * ratio, height);
}

function drawBreachRing(g, unit) {
    const progress = 1 - unit.breaching.timer / unit.stats.breachTime;
    g.lineStyle(3, 0xffe066, 0.9);
    g.beginPath();
    g.arc(unit.x, unit.y, unit.radius + 9, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    g.strokePath();
}

function drawOrder(g, unit) {
    const points = [{ x: unit.x, y: unit.y }, ...unit.path.slice(unit.pathIndex)];
    for (let i = 0; i < points.length - 1; i++) {
        dashedLine(g, points[i], points[i + 1], COLORS.friendlySel, 0.6);
    }
    const end = points[points.length - 1];
    g.lineStyle(3, COLORS.friendlySel, 0.85);
    g.strokeCircle(end.x, end.y, 9);
    g.lineBetween(end.x - 5, end.y, end.x + 5, end.y);
    g.lineBetween(end.x, end.y - 5, end.x, end.y + 5);
}

function dashedLine(g, a, b, color, alpha, dash = 12, gap = 9) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) return;
    const ux = dx / length;
    const uy = dy / length;
    g.lineStyle(2.5, color, alpha);
    for (let travelled = 0; travelled < length; travelled += dash + gap) {
        const end = Math.min(length, travelled + dash);
        g.lineBetween(a.x + ux * travelled, a.y + uy * travelled, a.x + ux * end, a.y + uy * end);
    }
}

