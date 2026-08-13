// Per-frame drawing of everything that moves: units, their weapon, corpses with
// the black X, tracers, doors, selection rings, HP bars and pending move orders.
//
// Depth order matters: corpses and doors sit *under* the fog so they stay hidden
// in rooms nobody has entered, while live units and order lines sit above it.

import { COLORS } from '../config.js';

const GUN = {
    operator: { length: 38, width: 7 },
    breacher: { length: 27, width: 10 },
    hostile: { length: 34, width: 7 },
};

export class EntityRenderer {
    constructor(scene) {
        this.doorLayer = scene.add.graphics().setDepth(8);
        this.groundLayer = scene.add.graphics().setDepth(6);
        this.unitLayer = scene.add.graphics().setDepth(30);
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
        const { units, projectiles, vision, friendlies, selected } = state;
        const ground = this.groundLayer;
        const top = this.unitLayer;
        const overlay = this.overlayLayer;
        ground.clear();
        top.clear();
        overlay.clear();

        for (const unit of units) {
            if (unit.alive) continue;
            drawCorpse(ground, unit);
        }

        for (const unit of units) {
            if (!unit.alive) continue;
            const visible = unit.isFriendly || vision.canAnySee(friendlies, unit.x, unit.y);
            if (!visible) {
                if (unit.lastKnownToPlayer) drawGhost(overlay, unit.lastKnownToPlayer);
                continue;
            }
            unit.lastKnownToPlayer = { x: unit.x, y: unit.y };
            drawUnit(top, unit);
            if (unit.selected) drawSelection(overlay, unit);
            if (unit.hp < unit.maxHp) drawHealthBar(overlay, unit);
            if (unit.breaching) drawBreachRing(overlay, unit);
        }

        for (const bullet of projectiles) {
            if (!vision.canAnySee(friendlies, bullet.x, bullet.y)) continue;
            top.lineStyle(3.5, COLORS.gun, 0.95);
            top.lineBetween(bullet.x, bullet.y, bullet.x - bullet.vx * 0.012, bullet.y - bullet.vy * 0.012);
        }

        for (const unit of selected) {
            if (!unit.alive || !unit.path) continue;
            drawOrder(overlay, unit);
        }
    }
}

function drawUnit(g, unit) {
    const color = unit.isFriendly ? COLORS.friendly : COLORS.hostile;
    g.fillStyle(color, 1);
    g.fillCircle(unit.x, unit.y, unit.radius);

    const gun = GUN[unit.cls] || GUN.operator;
    const cos = Math.cos(unit.facing);
    const sin = Math.sin(unit.facing);
    // Offset forward and slightly to the shoulder, the way the reference art sits.
    const cx = unit.x + cos * (unit.radius * 0.55) - sin * (unit.radius * 0.3);
    const cy = unit.y + sin * (unit.radius * 0.55) + cos * (unit.radius * 0.3);
    g.fillStyle(COLORS.gun, 1);
    fillRotatedRect(g, cx, cy, gun.length, gun.width, unit.facing);

    if (unit.muzzleFlash > 0) {
        const mx = unit.x + cos * (unit.radius + gun.length * 0.7);
        const my = unit.y + sin * (unit.radius + gun.length * 0.7);
        g.fillStyle(0xffe066, 0.9);
        g.fillCircle(mx, my, 7);
    }
}

function drawCorpse(g, unit) {
    const color = unit.isFriendly ? COLORS.friendly : COLORS.hostile;
    g.fillStyle(color, 1);
    g.fillCircle(unit.x, unit.y, unit.radius);

    if (unit.dropOffset) {
        g.fillStyle(COLORS.gun, 1);
        fillRotatedRect(
            g,
            unit.x + unit.dropOffset.x,
            unit.y + unit.dropOffset.y,
            34,
            7,
            unit.dropAngle + Math.PI / 2,
        );
    }

    const r = unit.radius * 0.95;
    g.lineStyle(7, COLORS.gun, 1);
    g.lineBetween(unit.x - r, unit.y - r, unit.x + r, unit.y + r);
    g.lineBetween(unit.x + r, unit.y - r, unit.x - r, unit.y + r);
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

export function fillRotatedRect(g, cx, cy, w, h, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hw = w / 2;
    const hh = h / 2;
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([px, py]) => ({
        x: cx + px * cos - py * sin,
        y: cy + px * sin + py * cos,
    }));
    g.fillPoints(corners, true);
}
