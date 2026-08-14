// Static scenery, baked once into a render texture: grass with its survey grid,
// the tree line, the building slab and walls, and the cover props. Nothing here
// changes at runtime except doors, which are drawn separately in entities.js.

import { WORLD, COLORS } from '../config.js';
import { SANDBAG_HALF_SPREAD } from '../level.js';

// Terrain is stored as rectangles because that is what the nav grid wants to
// paint from. Drawing them as rectangles would look like a tile editor threw up
// on the field, so each patch is filled with overlapping blobs seeded from its
// own position — same patch, same shape, every time the map loads.
const SURFACE_STYLE = {
    mud: { base: 0x5c4326, blob: 0x6b4f2d, speck: 0x3f2d1a, density: 0.00028, speckle: 0.0004 },
    // Sandy rather than grey: a grey patch on this palette reads as a smoke
    // cloud, and smoke means something entirely different.
    gravel: { base: 0xa89a72, blob: 0xb5a67d, speck: 0x7a6e50, density: 0.00022, speckle: 0.0016 },
    rubble: { base: 0x8a7f70, blob: 0x978b7b, speck: 0x554d43, density: 0.00030, speckle: 0.0022 },
    grass: { base: 0x1a7d0e, blob: 0x1f8a12, speck: 0x3fc022, density: 0.00030, speckle: 0.0034 },
    high: { base: 0x57b93c, blob: 0x63c748, speck: 0x2b7d1c, density: 0.00024, speckle: 0.0006 },
};

const ROAD = { base: 0x7a6a4e, edge: 0x6a5c43, rut: 0x5d5039 };

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

// The ground: everything that cannot change during a mission. Baked once.
export function buildGround(scene, level, depth = 0) {
    const g = scene.make.graphics({ add: false });
    const rng = mulberry32(99117);

    drawGrass(g, rng);
    drawGrid(g);
    // Ground cover before roads: a track laid over a field, not under it.
    for (const patch of level.terrain || []) drawSurface(g, patch);
    for (const road of level.roads || []) drawRoad(g, road);
    for (const tree of level.trees) drawTree(g, tree);
    drawBuilding(g, level);

    const texture = scene.add.renderTexture(0, 0, WORLD.width, WORLD.height)
        .setOrigin(0, 0)
        .setDepth(depth);
    texture.draw(g);
    g.destroy();
    return texture;
}

// Cover, on its own texture because it can be blown apart. Re-baking ~15 props
// is cheap; leaving them in the ground bake would mean a destroyed crate that
// still shows on the map.
export class PropLayer {
    constructor(scene, level, depth = 5) {
        this.scene = scene;
        this.texture = scene.add.renderTexture(0, 0, WORLD.width, WORLD.height)
            .setOrigin(0, 0)
            .setDepth(depth);
        this.rebuild(level);
    }

    rebuild(level) {
        const g = this.scene.make.graphics({ add: false });
        for (const prop of level.props) drawProp(g, prop);
        this.texture.clear();
        this.texture.draw(g);
        g.destroy();
    }

    destroy() {
        this.texture.destroy();
    }
}

// Everything the fight leaves behind: scorch rings, craters, blood and the
// debris of whatever used to be cover. Drawn once and kept — the map ends up
// telling the story of what happened on it.
export class DecalLayer {
    constructor(scene, depth = 4) {
        this.scene = scene;
        this.texture = scene.add.renderTexture(0, 0, WORLD.width, WORLD.height)
            .setOrigin(0, 0)
            .setDepth(depth);
    }

    stamp(draw) {
        const g = this.scene.make.graphics({ add: false });
        draw(g);
        this.texture.draw(g);
        g.destroy();
    }

    // A detonation: scorched ground, a darker crater, and thrown dirt.
    scorch(x, y, radius) {
        const rng = mulberry32(Math.floor(x * 31 + y * 17));
        this.stamp((g) => {
            g.fillStyle(0x24211c, 0.34);
            g.fillEllipse(x, y, radius * 1.5, radius * 1.25);
            g.fillStyle(0x14120f, 0.5);
            g.fillEllipse(x, y, radius * 0.66, radius * 0.55);
            for (let i = 0; i < 14; i++) {
                const angle = rng() * Math.PI * 2;
                const reach = radius * (0.5 + rng() * 0.9);
                g.fillStyle(0x2e2a23, 0.35 + rng() * 0.3);
                g.fillCircle(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach, 3 + rng() * 7);
            }
        });
    }

    // Where somebody fell. Sprayed along the direction the round was going.
    blood(x, y, angle, hostile) {
        const rng = mulberry32(Math.floor(x * 13 + y * 7));
        const color = hostile ? 0x7a1010 : 0x8c1414;
        this.stamp((g) => {
            g.fillStyle(color, 0.55);
            g.fillEllipse(x, y, 26, 20);
            for (let i = 0; i < 9; i++) {
                const spray = angle + (rng() - 0.5) * 1.1;
                const reach = 10 + rng() * 46;
                g.fillStyle(color, 0.3 + rng() * 0.3);
                g.fillCircle(x + Math.cos(spray) * reach, y + Math.sin(spray) * reach, 2 + rng() * 5);
            }
        });
    }

    // What is left of a crate or a sandbag line once it has been blown apart.
    debris(rect) {
        const rng = mulberry32(Math.floor(rect.x * 7 + rect.y * 3));
        this.stamp((g) => {
            for (let i = 0; i < 26; i++) {
                const x = rect.x + rng() * rect.w;
                const y = rect.y + rng() * rect.h;
                g.fillStyle(rng() > 0.5 ? 0x6b6156 : 0x4c453c, 0.55 + rng() * 0.35);
                g.fillRect(x, y, 3 + rng() * 9, 3 + rng() * 7);
            }
        });
    }

    destroy() {
        this.texture.destroy();
    }
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

// A patch of ground that plays differently: mud, gravel, rubble, tall grass or
// raised earth. Seeded from the patch's own corner so it looks identical on
// every load without anything being stored.
function drawSurface(g, patch) {
    const style = SURFACE_STYLE[patch.kind];
    if (!style) return;
    const rng = mulberry32(Math.floor(patch.x * 7349 + patch.y * 911 + patch.w));
    const area = patch.w * patch.h;

    // Body: overlapping ellipses inset from the edge so the rectangle never
    // shows, plus a soft rim that fades the patch into the field.
    const blobs = Math.max(6, Math.floor(area * style.density));
    for (let i = 0; i < blobs; i++) {
        const x = patch.x + rng() * patch.w;
        const y = patch.y + rng() * patch.h;
        const w = 60 + rng() * Math.min(220, patch.w * 0.55);
        const h = 45 + rng() * Math.min(170, patch.h * 0.55);
        g.fillStyle(rng() > 0.5 ? style.base : style.blob, 0.86);
        g.fillEllipse(x, y, w, h);
    }

    // Texture: grit on gravel, strands on grass, clods in mud.
    const specks = Math.floor(area * style.speckle);
    for (let i = 0; i < specks; i++) {
        const x = patch.x + rng() * patch.w;
        const y = patch.y + rng() * patch.h;
        if (patch.kind === 'grass') {
            g.lineStyle(2, style.speck, 0.5 + rng() * 0.3);
            const lean = (rng() - 0.5) * 6;
            g.lineBetween(x, y, x + lean, y - 8 - rng() * 9);
            continue;
        }
        g.fillStyle(style.speck, 0.35 + rng() * 0.4);
        g.fillCircle(x, y, 1.4 + rng() * 2.4);
    }

    // Raised ground has to read as raised at a glance, because standing on it
    // changes what you can see: a hard shadow along the lower edge, a lit crest
    // along the upper one, and a contour ring round the whole thing.
    if (patch.kind === 'high') {
        const cx = patch.x + patch.w / 2;
        const cy = patch.y + patch.h / 2;
        g.fillStyle(0x15490d, 0.55);
        g.fillEllipse(cx, patch.y + patch.h - 6, patch.w * 0.98, 34);
        g.fillStyle(0x7ad85c, 0.4);
        g.fillEllipse(cx, patch.y + 10, patch.w * 0.9, 22);
        g.lineStyle(4, 0x8ce069, 0.6);
        g.strokeEllipse(cx, cy, patch.w * 0.92, patch.h * 0.88);
        g.lineStyle(2, 0x8ce069, 0.35);
        g.strokeEllipse(cx, cy, patch.w * 0.62, patch.h * 0.58);
    }
}

// A dirt track: a wide band down the polyline, a darker shoulder, and two ruts
// where the wheels go. Tracks run from the map's entry roads to the objective,
// so they double as a hint about where reinforcements will come from.
function drawRoad(g, road) {
    const points = road.points;
    const width = road.width || 64;

    const band = (w, color, alpha) => {
        g.lineStyle(w, color, alpha);
        for (let i = 0; i < points.length - 1; i++) {
            g.lineBetween(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
        }
        // Round the corners so the joints do not show as notches.
        for (const point of points) {
            g.fillStyle(color, alpha);
            g.fillCircle(point.x, point.y, w / 2);
        }
    };

    band(width + 10, ROAD.edge, 0.75);
    band(width, ROAD.base, 1);

    // Ruts, offset either side of the centre line.
    for (const side of [-1, 1]) {
        g.lineStyle(5, ROAD.rut, 0.5);
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i];
            const b = points[i + 1];
            const angle = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
            const off = side * width * 0.22;
            g.lineBetween(
                a.x + Math.cos(angle) * off, a.y + Math.sin(angle) * off,
                b.x + Math.cos(angle) * off, b.y + Math.sin(angle) * off,
            );
        }
    }
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
    // Hidden props are pure collision — a knocked-out tank's footprint, drawn
    // from the unit itself so the hull keeps the angle it died at.
    if (prop.hidden) return;
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

    if (prop.type === 'crate') {
        const x = prop.x - prop.w / 2;
        const y = prop.y - prop.h / 2;
        g.fillStyle(COLORS.wall, 1);
        g.fillRect(x - 4, y - 4, prop.w + 8, prop.h + 8);
        g.fillStyle(COLORS.crate, 1);
        g.fillRect(x, y, prop.w, prop.h);
        // Two planks across the lid so a crate does not read as a hole.
        g.fillStyle(COLORS.crateDark, 1);
        g.fillRect(x, y + prop.h * 0.28, prop.w, prop.h * 0.1);
        g.fillRect(x, y + prop.h * 0.62, prop.w, prop.h * 0.1);
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
