// Static scenery, baked once into a render texture: grass with its survey grid,
// the tree line, the building slab and walls, and the cover props. Nothing here
// changes at runtime except doors, which are drawn separately in entities.js.

import { WORLD, COLORS } from '../config.js';
import { LEVEL, SANDBAG_HALF_SPREAD } from '../level.js';

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function buildTerrain(scene, level = LEVEL, depth = 0) {
    const g = scene.make.graphics({ add: false });
    const rng = mulberry32(99117);

    drawGrass(g, rng);
    drawGrid(g);
    for (const tree of level.trees) drawTree(g, tree);
    drawBuilding(g, level);
    for (const prop of level.props) drawProp(g, prop);

    const texture = scene.add.renderTexture(0, 0, WORLD.width, WORLD.height)
        .setOrigin(0, 0)
        .setDepth(depth);
    texture.draw(g);
    g.destroy();
    return texture;
}

function drawGrass(g, rng) {
    g.fillStyle(COLORS.grassBase, 1);
    g.fillRect(0, 0, WORLD.width, WORLD.height);

    // Soft patches so the field is not a flat slab of one green.
    for (let i = 0; i < 90; i++) {
        const x = rng() * WORLD.width;
        const y = rng() * WORLD.height;
        const w = 180 + rng() * 420;
        const h = 120 + rng() * 260;
        g.fillStyle(rng() > 0.5 ? COLORS.grassLight : COLORS.grassDark, 0.22);
        g.fillEllipse(x, y, w, h);
    }
}

function drawGrid(g) {
    const step = 64;
    g.lineStyle(1.5, COLORS.grid, 0.16);
    for (let x = 0; x <= WORLD.width; x += step) g.lineBetween(x, 0, x, WORLD.height);
    for (let y = 0; y <= WORLD.height; y += step) g.lineBetween(0, y, WORLD.width, y);
}

// Leafy blob: a dark underside, a mid body and a bright top, each scalloped with
// satellite circles so the silhouette reads as foliage rather than as discs.
function drawTree(g, tree) {
    const layers = [
        { color: COLORS.treeShadow, offset: 10, scale: 1.06, alpha: 1 },
        { color: COLORS.treeBase, offset: 2, scale: 1.0, alpha: 1 },
        { color: COLORS.treeMid, offset: -6, scale: 0.82, alpha: 1 },
        { color: COLORS.treeLight, offset: -14, scale: 0.5, alpha: 1 },
    ];

    for (const layer of layers) {
        g.fillStyle(layer.color, layer.alpha);
        for (const blob of tree.blobs) {
            const bx = tree.x + blob.dx;
            const by = tree.y + blob.dy + layer.offset;
            const r = blob.r * layer.scale;
            g.fillCircle(bx, by, r);
            const petals = 5;
            for (let i = 0; i < petals; i++) {
                const a = (i / petals) * Math.PI * 2 + blob.tone * 3;
                g.fillCircle(bx + Math.cos(a) * r * 0.7, by + Math.sin(a) * r * 0.7, r * 0.45);
            }
        }
    }
}

function drawBuilding(g, level) {
    for (const floor of level.floors) {
        g.fillStyle(COLORS.floor, 1);
        g.fillRect(floor.x, floor.y, floor.w, floor.h);
    }
    // A whisper of shading so the interior is not a pure white void.
    const main = level.floors[0];
    g.fillStyle(COLORS.floorShade, 0.55);
    g.fillEllipse(main.x + main.w * 0.62, main.y + main.h * 0.35, main.w * 0.7, main.h * 0.5);

    g.fillStyle(COLORS.wall, 1);
    for (const wall of level.walls) g.fillRect(wall.x, wall.y, wall.w, wall.h);
}

function drawProp(g, prop) {
    if (prop.type === 'wreck') {
        const x = prop.x - prop.w / 2;
        const y = prop.y - prop.h / 2;
        g.fillStyle(COLORS.wall, 1);
        g.fillRoundedRect(x - 5, y - 5, prop.w + 10, prop.h + 10, 10);
        g.fillStyle(COLORS.hostile, 1);
        g.fillRoundedRect(x, y, prop.w, prop.h, 8);
        // Knocked-out marker: the same black cross used for dead units.
        g.lineStyle(14, COLORS.wall, 1);
        g.lineBetween(x + 10, y + prop.h * 0.28, x + prop.w - 10, y + prop.h * 0.78);
        g.lineBetween(x + prop.w - 10, y + prop.h * 0.28, x + 10, y + prop.h * 0.78);
        g.lineStyle(8, COLORS.wall, 1);
        g.strokeRoundedRect(x + prop.w * 0.2, y + prop.h * 0.05, prop.w * 0.6, prop.h * 0.4, 6);
        return;
    }

    if (prop.type === 'sandbags') {
        // Same arc the cover collision test uses, so the drawing cannot drift
        // away from what actually stops a bullet.
        const start = prop.angle - SANDBAG_HALF_SPREAD;
        const end = prop.angle + SANDBAG_HALF_SPREAD;
        g.lineStyle(34, COLORS.sandbagDark, 1);
        g.beginPath();
        g.arc(prop.x, prop.y, prop.radius, start, end);
        g.strokePath();
        g.lineStyle(26, COLORS.sandbag, 1);
        g.beginPath();
        g.arc(prop.x, prop.y, prop.radius, start, end);
        g.strokePath();
    }
}
