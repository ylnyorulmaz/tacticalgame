// Weapon silhouettes and muzzle flashes.
//
// A weapon is a small parts list in gun-local space: +x points down the barrel,
// +y is the unit's right. Each part is a rectangle (or a circle for a drum
// magazine), so a rifle reads as barrel + receiver + stock + furniture rather
// than as one black bar. Parts are drawn in the flat black of the reference art,
// with a lighter tone for the details that would otherwise disappear into it.

import { COLORS } from '../config.js';

const DARK = COLORS.gun;
const MID = 0x39414b;

export const GUN = {
    operator: {
        kick: 2.4,
        flash: { length: 16, width: 10 },
        casing: { color: 0xd8a44a, size: 3 },
        parts: [
            { x: 14, y: 0, l: 24, w: 4 },                     // barrel
            { x: -3, y: 0, l: 20, w: 7.5 },                   // receiver
            { x: -15, y: 0, l: 10, w: 6 },                    // stock
            { x: -1, y: 4.5, l: 8, w: 3, tone: MID },         // charging handle
            { x: 9, y: -4, l: 7, w: 3, tone: MID },           // rail
        ],
    },
    breacher: {
        kick: 4.5,
        flash: { length: 20, width: 24 },
        casing: { color: 0xc0392b, size: 3.5 },
        parts: [
            { x: 10, y: 0, l: 20, w: 6 },
            { x: 10, y: 3.6, l: 16, w: 3, tone: MID },        // tube magazine
            { x: -4, y: 0, l: 16, w: 9 },
            { x: -15, y: 0, l: 9, w: 7 },
            { x: 4, y: -4.6, l: 8, w: 3.5, tone: MID },       // pump grip
        ],
    },
    grenadier: {
        kick: 4,
        flash: { length: 14, width: 20 },
        casing: { color: 0x9aa0a6, size: 4 },
        parts: [
            { x: 10, y: 0, l: 20, w: 12 },                    // fat launcher tube
            { x: -6, y: 0, l: 14, w: 9 },
            { x: -14, y: 0, l: 8, w: 6 },
            { shape: 'circle', x: -4, y: 5.5, r: 5, tone: MID },   // drum
        ],
    },
    medic: {
        kick: 1.8,
        flash: { length: 12, width: 8 },
        casing: { color: 0xd8a44a, size: 2.5 },
        icon: 'cross',
        parts: [
            { x: 9, y: 0, l: 16, w: 4 },
            { x: -2, y: 0, l: 14, w: 7 },
            { x: -11, y: 0, l: 7, w: 5 },
            { x: -2, y: 4, l: 6, w: 3, tone: MID },
        ],
    },
    marksman: {
        kick: 5,
        flash: { length: 30, width: 9 },
        casing: { color: 0xd8a44a, size: 3.5 },
        parts: [
            { x: 21, y: 0, l: 34, w: 3.5 },                   // long barrel
            { x: -2, y: 0, l: 20, w: 6.5 },
            { x: -16, y: 0, l: 12, w: 6 },
            { x: 2, y: 0, l: 13, w: 4.5, tone: MID },         // scope tube
            { x: 2, y: -3.6, l: 3.5, w: 3, tone: MID },       // turret
        ],
    },
    machinegunner: {
        kick: 1.6,
        flash: { length: 18, width: 14 },
        casing: { color: 0xd8a44a, size: 3.5 },
        parts: [
            { x: 18, y: 0, l: 30, w: 5 },
            { x: -3, y: 0, l: 22, w: 9 },
            { x: -17, y: 0, l: 10, w: 7 },
            { x: -3, y: 6.5, l: 10, w: 7, tone: MID },        // box magazine
            { x: 13, y: -7, l: 13, w: 2.5, rot: -0.55 },      // bipod legs
            { x: 13, y: 7, l: 13, w: 2.5, rot: 0.55 },
        ],
    },
    hostile: {
        kick: 2.4,
        flash: { length: 15, width: 10 },
        casing: { color: 0xd8a44a, size: 3 },
        parts: [
            { x: 12, y: 0, l: 20, w: 4 },
            { x: -3, y: 0, l: 18, w: 7 },
            { x: -14, y: 0, l: 9, w: 5.5 },
            { x: -2, y: 4.2, l: 7, w: 3, tone: MID },
        ],
    },
    hostileShotgun: {
        kick: 4.2,
        flash: { length: 18, width: 22 },
        casing: { color: 0xc0392b, size: 3.5 },
        parts: [
            { x: 9, y: 0, l: 18, w: 6 },
            { x: 9, y: 3.4, l: 14, w: 2.8, tone: MID },
            { x: -4, y: 0, l: 15, w: 8.5 },
            { x: -14, y: 0, l: 8, w: 6.5 },
        ],
    },
    hostileHeavy: {
        kick: 3,
        flash: { length: 20, width: 12 },
        casing: { color: 0xd8a44a, size: 3.5 },
        parts: [
            { x: 16, y: 0, l: 26, w: 4.5 },
            { x: -3, y: 0, l: 20, w: 8 },
            { x: -16, y: 0, l: 11, w: 6.5 },
            { x: -3, y: 5.4, l: 9, w: 4, tone: MID },
        ],
    },
};

// Distance from the gun's anchor to the end of its longest part — where the
// flash, the smoke and the tracer all start.
export function muzzleReach(gun) {
    if (gun.reach === undefined) {
        gun.reach = gun.parts.reduce(
            (max, part) => Math.max(max, part.shape === 'circle' ? part.x + part.r : part.x + part.l / 2),
            0,
        );
    }
    return gun.reach;
}

// Where a unit holds its weapon: forward and off the shoulder, as in the
// reference art. Recoil slides the whole gun back along its own axis.
export function gunAnchor(unit, gun) {
    const cos = Math.cos(unit.facing);
    const sin = Math.sin(unit.facing);
    const back = (gun.kick || 2.5) * (unit.recoil || 0);
    return {
        x: unit.x + cos * (unit.radius * 0.55 - back) - sin * (unit.radius * 0.3),
        y: unit.y + sin * (unit.radius * 0.55 - back) + cos * (unit.radius * 0.3),
        cos,
        sin,
    };
}

export function drawWeapon(g, x, y, angle, gun, scale = 1) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const part of gun.parts) {
        const px = x + (part.x * cos - part.y * sin) * scale;
        const py = y + (part.x * sin + part.y * cos) * scale;
        g.fillStyle(part.tone || DARK, 1);
        if (part.shape === 'circle') {
            g.fillCircle(px, py, part.r * scale);
        } else {
            fillRotatedRect(g, px, py, part.l * scale, part.w * scale, angle + (part.rot || 0));
        }
    }
}

// Muzzle flash: a bright core, a forward cone and two side petals, all shrinking
// over the life of the flash. Shotguns get a wide short bloom, the marksman a
// long lance — the shape says as much about the weapon as the sound does.
export function drawMuzzleFlash(g, x, y, angle, gun, t) {
    const spec = gun.flash;
    const grow = 0.55 + 0.45 * t;
    const length = spec.length * grow;
    const width = spec.width * grow;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const tip = { x: x + cos * length, y: y + sin * length };

    g.fillStyle(0xffb020, 0.55 * t);
    fillTriangle(g, x, y, angle, length * 1.15, width * 1.35);
    g.fillStyle(0xffd24a, 0.85 * t);
    fillTriangle(g, x, y, angle, length, width);

    // Side petals, angled off the barrel.
    g.fillStyle(0xffe9a0, 0.7 * t);
    fillTriangle(g, x, y, angle - 1.15, length * 0.42, width * 0.6);
    fillTriangle(g, x, y, angle + 1.15, length * 0.42, width * 0.6);

    g.fillStyle(0xfff6d0, 0.95 * t);
    g.fillCircle(x, y, width * 0.22);
    g.fillStyle(0xfff6d0, 0.5 * t);
    g.fillCircle(tip.x, tip.y, width * 0.12);
}

function fillTriangle(g, x, y, angle, length, width) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const half = width / 2;
    g.fillPoints([
        { x: x + cos * length, y: y + sin * length },
        { x: x - sin * half, y: y + cos * half },
        { x: x + sin * half, y: y - cos * half },
    ], true);
}

export function fillRotatedRect(g, cx, cy, w, h, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hw = w / 2;
    const hh = h / 2;
    g.fillPoints([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([px, py]) => ({
        x: cx + px * cos - py * sin,
        y: cy + px * sin + py * cos,
    })), true);
}
