// Line of sight and fog of war.
//
// Sight blockers are reduced to a soup of line segments; a visibility polygon is
// built per friendly unit by casting rays at every corner (plus a ring of rays to
// round off the sight radius) and sorting the hits by angle. Two fog layers sit
// on top of the terrain: a persistent "explored" texture that is permanently
// erased where the squad has been, and a per-frame "currently visible" texture.

import { WORLD, FOG } from '../config.js';
import { sightBlockingRects } from '../level.js';

function rectToSegments(rect, out) {
    const { x, y, w, h } = rect;
    out.push({ ax: x, ay: y, bx: x + w, by: y });
    out.push({ ax: x + w, ay: y, bx: x + w, by: y + h });
    out.push({ ax: x + w, ay: y + h, bx: x, by: y + h });
    out.push({ ax: x, ay: y + h, bx: x, by: y });
}

// A cloud is approximated by a polygon rather than a circle: the whole
// visibility solver is segment-based, and a dozen edges is close enough to round
// at these radii.
const CLOUD_SIDES = 12;

export class VisionSystem {
    constructor(level) {
        this.level = level;
        this.segments = [];
        // Occluders that come and go — smoke, so far. Kept apart from the static
        // soup because bullets ignore them and eyes do not.
        this.dynamic = [];
        this.refreshSegments();
    }

    // Smoke blocks sight without blocking anything else, so it lives in its own
    // segment list that only the seeing tests consult.
    setClouds(clouds) {
        const segments = [];
        for (const cloud of clouds) {
            if (cloud.radius <= 1) continue;
            let px = cloud.x + cloud.radius;
            let py = cloud.y;
            for (let i = 1; i <= CLOUD_SIDES; i++) {
                const angle = (i / CLOUD_SIDES) * Math.PI * 2;
                const x = cloud.x + Math.cos(angle) * cloud.radius;
                const y = cloud.y + Math.sin(angle) * cloud.radius;
                segments.push(measured({ ax: px, ay: py, bx: x, by: y }));
                px = x;
                py = y;
            }
        }
        this.dynamic = segments;
    }

    // Called whenever a door opens: the blocker set changes, nothing else does.
    refreshSegments() {
        const segments = [];
        for (const rect of sightBlockingRects(this.level)) rectToSegments(rect, segments);
        rectToSegments({ x: 0, y: 0, w: WORLD.width, h: WORLD.height }, segments);
        for (const seg of segments) measured(seg);
        this.segments = segments;
    }

    segmentsNear(x, y, radius) {
        const near = [];
        for (const seg of this.allSegments()) {
            if (seg.maxX < x - radius || seg.minX > x + radius) continue;
            if (seg.maxY < y - radius || seg.minY > y + radius) continue;
            near.push(seg);
        }
        return near;
    }

    allSegments() {
        return this.dynamic.length === 0 ? this.segments : [...this.segments, ...this.dynamic];
    }

    // True when nothing *solid* stands between the two points. This is the
    // bullet's question: rounds and blast go through smoke.
    hasLineOfSight(ax, ay, bx, by) {
        return this.clear(this.segments, ax, ay, bx, by);
    }

    // True when nothing blocks the *view* — walls, shut doors, crates, and any
    // smoke hanging in between. This is the eye's question, and it is what
    // acquisition, the hostile brain and the fog all ask.
    canObserve(ax, ay, bx, by) {
        if (!this.clear(this.segments, ax, ay, bx, by)) return false;
        return this.dynamic.length === 0 || this.clear(this.dynamic, ax, ay, bx, by);
    }

    clear(segments, ax, ay, bx, by) {
        const minX = Math.min(ax, bx);
        const maxX = Math.max(ax, bx);
        const minY = Math.min(ay, by);
        const maxY = Math.max(ay, by);
        for (const seg of segments) {
            if (seg.maxX < minX || seg.minX > maxX || seg.maxY < minY || seg.minY > maxY) continue;
            if (segmentsIntersect(ax, ay, bx, by, seg.ax, seg.ay, seg.bx, seg.by)) return false;
        }
        return true;
    }

    // Can `observer` (a unit) see the point? Radius first, then the expensive test.
    canSee(observer, x, y) {
        const dist = Math.hypot(x - observer.x, y - observer.y);
        if (dist > observer.stats.sight) return false;
        return this.canObserve(observer.x, observer.y, x, y);
    }

    canAnySee(observers, x, y) {
        for (const observer of observers) {
            if (!observer.alive) continue;
            if (this.canSee(observer, x, y)) return true;
        }
        return false;
    }

    // Visibility polygon as a flat [x0, y0, x1, y1, ...] list, ready for Graphics.
    visibilityPolygon(x, y, radius) {
        const segments = this.segmentsNear(x, y, radius);
        const angles = [];

        for (const seg of segments) {
            for (const [px, py] of [[seg.ax, seg.ay], [seg.bx, seg.by]]) {
                const dx = px - x;
                const dy = py - y;
                if (dx * dx + dy * dy > radius * radius) continue;
                const base = Math.atan2(dy, dx);
                angles.push(base - FOG.epsilon, base, base + FOG.epsilon);
            }
        }
        for (let i = 0; i < FOG.rayCount; i++) {
            angles.push((i / FOG.rayCount) * Math.PI * 2 - Math.PI);
        }
        angles.sort((a, b) => a - b);

        const points = [];
        for (const angle of angles) {
            const dx = Math.cos(angle);
            const dy = Math.sin(angle);
            let best = radius;
            for (const seg of segments) {
                const t = rayHit(x, y, dx, dy, seg);
                if (t !== null && t < best) best = t;
            }
            points.push(x + dx * best, y + dy * best);
        }
        return points;
    }
}

// Cache each segment's bounding box: the broad-phase rejection in `clear` runs
// over every segment on every sight test, so this is the hot path.
function measured(seg) {
    seg.minX = Math.min(seg.ax, seg.bx);
    seg.maxX = Math.max(seg.ax, seg.bx);
    seg.minY = Math.min(seg.ay, seg.by);
    seg.maxY = Math.max(seg.ay, seg.by);
    return seg;
}

// Ray (origin + unit direction) against a segment. Returns distance along the
// ray, or null when they miss.
function rayHit(ox, oy, dx, dy, seg) {
    const sx = seg.bx - seg.ax;
    const sy = seg.by - seg.ay;
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-9) return null;
    const qx = seg.ax - ox;
    const qy = seg.ay - oy;
    const t = (qx * sy - qy * sx) / denom;
    const u = (qx * dy - qy * dx) / denom;
    if (t < 0 || u < 0 || u > 1) return null;
    return t;
}

export function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const r1 = cross(bx - ax, by - ay, cx - ax, cy - ay);
    const r2 = cross(bx - ax, by - ay, dx - ax, dy - ay);
    const r3 = cross(dx - cx, dy - cy, ax - cx, ay - cy);
    const r4 = cross(dx - cx, dy - cy, bx - cx, by - cy);
    return ((r1 > 0) !== (r2 > 0)) && ((r3 > 0) !== (r4 > 0));
}

function cross(ax, ay, bx, by) {
    return ax * by - ay * bx;
}

// The two stacked fog textures, both carved by the same visibility polygons:
// "explored" is a persistent map-wide memory that is only ever erased, "current"
// covers just the camera viewport and is repainted every frame.
//
// Both are kept deliberately small. A full-resolution 2400x1600 clear+fill+erase
// per frame costs a quarter of a second on a software GL stack; at these scales
// the same fog costs a couple of milliseconds and looks identical.
const EXPLORED_SCALE = 0.5;
const CURRENT_SCALE = 0.6;
const FOG_COLOR = 0x07160e;

export class FogRenderer {
    constructor(scene, depth) {
        this.scene = scene;
        this.brush = scene.make.graphics({ add: false });

        this.explored = scene.add.renderTexture(
            0, 0,
            Math.ceil(WORLD.width * EXPLORED_SCALE),
            Math.ceil(WORLD.height * EXPLORED_SCALE),
        )
            .setOrigin(0, 0)
            .setDepth(depth)
            .setAlpha(FOG.unexploredAlpha);
        this.explored.setDisplaySize(WORLD.width, WORLD.height);
        this.explored.fill(FOG_COLOR, 1);

        // Live visibility is a plain dark sheet with the visibility polygons
        // punched out of it by an inverted geometry mask. That is a stencil pass
        // rather than a render-target switch, which is an order of magnitude
        // cheaper. Inverted masks are WebGL-only, so the canvas renderer keeps
        // the render-texture route.
        this.useMask = scene.renderer.type === Phaser.WEBGL;

        if (this.useMask) {
            this.maskGfx = scene.make.graphics({ add: false });
            const mask = new Phaser.Display.Masks.GeometryMask(scene, this.maskGfx);
            mask.invertAlpha = true;
            this.current = scene.add.graphics().setDepth(depth + 1);
            this.current.fillStyle(FOG_COLOR, FOG.exploredAlpha);
            this.current.fillRect(0, 0, WORLD.width, WORLD.height);
            this.current.setMask(mask);
        } else {
            const size = scene.scale.gameSize;
            this.current = scene.add.renderTexture(
                0, 0,
                Math.ceil(size.width * CURRENT_SCALE),
                Math.ceil(size.height * CURRENT_SCALE),
            )
                .setOrigin(0, 0)
                .setDepth(depth + 1)
                .setAlpha(FOG.exploredAlpha);
            scene.scale.on('resize', this.handleResize, this);
            scene.events.once('shutdown', () => scene.scale.off('resize', this.handleResize, this));
        }
    }

    handleResize(size) {
        this.current.setSize(Math.ceil(size.width * CURRENT_SCALE), Math.ceil(size.height * CURRENT_SCALE));
    }

    // Rebuild a graphics object with the visibility polygons, optionally mapped
    // into a target texture's pixel space.
    strokePolygons(g, polygons, scale, offsetX, offsetY) {
        g.clear();
        g.fillStyle(0xffffff, 1);
        for (const points of polygons) {
            if (points.length < 6) continue;
            g.beginPath();
            g.moveTo((points[0] + offsetX) * scale, (points[1] + offsetY) * scale);
            for (let i = 2; i < points.length; i += 2) {
                g.lineTo((points[i] + offsetX) * scale, (points[i + 1] + offsetY) * scale);
            }
            g.closePath();
            g.fillPath();
        }
    }

    update(polygons) {
        // Memory only ever grows, so it can lag a few frames behind for free.
        this.memoryTick = (this.memoryTick || 0) + 1;
        if (this.memoryTick % 4 === 1) {
            this.strokePolygons(this.brush, polygons, EXPLORED_SCALE, 0, 0);
            this.explored.erase(this.brush);
        }

        if (this.useMask) {
            this.strokePolygons(this.maskGfx, polygons, 1, 0, 0);
            return;
        }

        // Canvas fallback: the viewport layer lives in screen pixels and is then
        // stretched back over the slice of the world the camera is looking at.
        // The opaque fill doubles as the clear, so this is two texture ops.
        const cam = this.scene.cameras.main;
        const size = this.scene.scale.gameSize;
        this.strokePolygons(this.brush, polygons, cam.zoom * CURRENT_SCALE, -cam.scrollX, -cam.scrollY);
        this.current.fill(FOG_COLOR, 1);
        this.current.erase(this.brush);
        this.current.setPosition(cam.scrollX, cam.scrollY);
        this.current.setDisplaySize(size.width / cam.zoom, size.height / cam.zoom);
    }
}
