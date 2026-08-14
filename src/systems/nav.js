// Grid navigation: a coarse walkability grid rebuilt whenever a door changes,
// A* over it, then a string-pull pass so units walk clean diagonals instead of
// staircases. Closed doors stay traversable at a high cost — that is how a unit
// is able to path "through" a shut door and then breach it on arrival.

import { WORLD, UNIT_RADIUS, SURFACES, SURFACE_BY_ID } from '../config.js';
import { staticSolidRects, sandbagArcs, pointInSandbag, rectContains } from '../level.js';

export const CELL = 20;
export const COLS = Math.ceil(WORLD.width / CELL);
export const ROWS = Math.ceil(WORLD.height / CELL);

export const FREE = 0;
export const BLOCKED = 1;
export const DOOR = 2;

const DOOR_COST = 6;
const SQRT2 = Math.SQRT2;

export class NavGrid {
    // `radius` is the body being routed. Infantry use the default; vehicles get
    // their own wider grid, which is what keeps a tank out of a doorway it would
    // otherwise happily path through.
    constructor(level, options = {}) {
        this.level = level;
        this.radius = options.radius ?? UNIT_RADIUS;
        // Doors are a passable-but-expensive cell for infantry (walk up, breach,
        // walk through) and simply a wall for anything too wide to fit.
        this.doorsPassable = options.doorsPassable ?? true;
        this.cells = new Uint8Array(COLS * ROWS);
        // What each cell is made of, parallel to `cells`: passability and
        // surface are different questions and keeping them apart means A* costs
        // and unit speed can read one without decoding the other.
        this.surface = new Uint8Array(COLS * ROWS);
        this.g = new Float32Array(COLS * ROWS);
        this.came = new Int32Array(COLS * ROWS);
        this.state = new Uint8Array(COLS * ROWS);
        this.stamp = new Int32Array(COLS * ROWS);
        this.searchId = 0;
        this.rebuild();
    }

    index(cx, cy) {
        return cy * COLS + cx;
    }

    inBounds(cx, cy) {
        return cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS;
    }

    rebuild() {
        this.cells.fill(FREE);
        this.markSurfaces();

        const mark = (rect, pad, value) => {
            const minX = Math.max(0, Math.floor((rect.x - pad) / CELL));
            const maxX = Math.min(COLS - 1, Math.floor((rect.x + rect.w + pad) / CELL));
            const minY = Math.max(0, Math.floor((rect.y - pad) / CELL));
            const maxY = Math.min(ROWS - 1, Math.floor((rect.y + rect.h + pad) / CELL));
            for (let cy = minY; cy <= maxY; cy++) {
                for (let cx = minX; cx <= maxX; cx++) this.cells[this.index(cx, cy)] = value;
            }
        };

        // Walls and wrecks, inflated by the unit radius so a body never ends up
        // clipping a corner it "legally" pathed around. Doors are handled below:
        // inflating them here would seal off their own approach.
        for (const rect of staticSolidRects(this.level)) mark(rect, this.radius, BLOCKED);

        for (const arc of sandbagArcs(this.level)) {
            const minX = Math.max(0, Math.floor((arc.x - arc.radius - 30) / CELL));
            const maxX = Math.min(COLS - 1, Math.floor((arc.x + arc.radius + 30) / CELL));
            const minY = Math.max(0, Math.floor((arc.y - arc.radius - 30) / CELL));
            const maxY = Math.min(ROWS - 1, Math.floor((arc.y + arc.radius + 30) / CELL));
            for (let cy = minY; cy <= maxY; cy++) {
                for (let cx = minX; cx <= maxX; cx++) {
                    const wx = cx * CELL + CELL / 2;
                    const wy = cy * CELL + CELL / 2;
                    if (pointInSandbag(arc, wx, wy, this.radius)) {
                        this.cells[this.index(cx, cy)] = BLOCKED;
                    }
                }
            }
        }

        // Doorways last: their own footprint is passable-but-expensive when shut
        // and plain floor when open, overriding the wall inflation in the gap.
        // A body too wide for the gap gets no such exception.
        for (const door of this.level.doors) {
            if (!this.doorsPassable) continue;
            mark(door, 0, door.open ? FREE : DOOR);
        }

        // The map border is solid.
        for (let cx = 0; cx < COLS; cx++) {
            this.cells[this.index(cx, 0)] = BLOCKED;
            this.cells[this.index(cx, ROWS - 1)] = BLOCKED;
        }
        for (let cy = 0; cy < ROWS; cy++) {
            this.cells[this.index(0, cy)] = BLOCKED;
            this.cells[this.index(COLS - 1, cy)] = BLOCKED;
        }
    }

    // Terrain patches are stored as rectangles but painted per cell, so every
    // later question — how fast, how loud, can I see over it — is a single
    // array read rather than a walk over the patch list.
    markSurfaces() {
        this.surface.fill(SURFACES.plain.id);
        for (const patch of this.level.terrain || []) {
            const kind = SURFACES[patch.kind];
            if (!kind || kind === SURFACES.plain) continue;
            const minX = Math.max(0, Math.floor(patch.x / CELL));
            const maxX = Math.min(COLS - 1, Math.floor((patch.x + patch.w) / CELL));
            const minY = Math.max(0, Math.floor(patch.y / CELL));
            const maxY = Math.min(ROWS - 1, Math.floor((patch.y + patch.h) / CELL));
            for (let cy = minY; cy <= maxY; cy++) {
                for (let cx = minX; cx <= maxX; cx++) this.surface[this.index(cx, cy)] = kind.id;
            }
        }
    }

    surfaceAt(cx, cy) {
        return SURFACE_BY_ID[this.surface[this.index(cx, cy)]] || SURFACES.plain;
    }

    surfaceAtWorld(x, y) {
        const { cx, cy } = this.cellAtWorld(x, y);
        return this.surfaceAt(cx, cy);
    }

    cellAtWorld(x, y) {
        const cx = Math.min(COLS - 1, Math.max(0, Math.floor(x / CELL)));
        const cy = Math.min(ROWS - 1, Math.max(0, Math.floor(y / CELL)));
        return { cx, cy };
    }

    valueAtWorld(x, y) {
        const { cx, cy } = this.cellAtWorld(x, y);
        return this.cells[this.index(cx, cy)];
    }

    isBlockedWorld(x, y) {
        return this.valueAtWorld(x, y) === BLOCKED;
    }

    // Nearest cell a unit could actually stand in, spiralling out from the click.
    nearestOpen(cx, cy, maxRing = 14) {
        if (this.cells[this.index(cx, cy)] !== BLOCKED) return { cx, cy };
        for (let ring = 1; ring <= maxRing; ring++) {
            for (let dy = -ring; dy <= ring; dy++) {
                for (let dx = -ring; dx <= ring; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
                    const nx = cx + dx;
                    const ny = cy + dy;
                    if (!this.inBounds(nx, ny)) continue;
                    if (this.cells[this.index(nx, ny)] !== BLOCKED) return { cx: nx, cy: ny };
                }
            }
        }
        return null;
    }

    // A* with an octile heuristic and no cutting across blocked diagonals.
    findPath(startX, startY, goalX, goalY) {
        const startCell = this.cellAtWorld(startX, startY);
        const goalCell = this.cellAtWorld(goalX, goalY);
        const start = this.nearestOpen(startCell.cx, startCell.cy);
        const goal = this.nearestOpen(goalCell.cx, goalCell.cy);
        if (!start || !goal) return null;

        const startIdx = this.index(start.cx, start.cy);
        const goalIdx = this.index(goal.cx, goal.cy);
        if (startIdx === goalIdx) {
            return this.isBlockedWorld(goalX, goalY)
                ? [{ x: goal.cx * CELL + CELL / 2, y: goal.cy * CELL + CELL / 2 }]
                : [{ x: goalX, y: goalY }];
        }

        const id = ++this.searchId;
        const heap = new MinHeap();
        this.g[startIdx] = 0;
        this.came[startIdx] = -1;
        this.state[startIdx] = 1;
        this.stamp[startIdx] = id;
        heap.push(startIdx, this.heuristic(start.cx, start.cy, goal.cx, goal.cy));

        while (heap.size > 0) {
            const current = heap.pop();
            if (current === goalIdx) return this.buildPath(current, goalX, goalY);
            if (this.stamp[current] !== id) continue;
            this.state[current] = 2;

            const cx = current % COLS;
            const cy = (current - cx) / COLS;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = cx + dx;
                    const ny = cy + dy;
                    if (!this.inBounds(nx, ny)) continue;
                    const nIdx = this.index(nx, ny);
                    const value = this.cells[nIdx];
                    if (value === BLOCKED) continue;
                    if (dx !== 0 && dy !== 0) {
                        // No squeezing between two diagonal corners.
                        if (this.cells[this.index(cx + dx, cy)] === BLOCKED) continue;
                        if (this.cells[this.index(cx, cy + dy)] === BLOCKED) continue;
                    }
                    // Distance × what it costs to cross this cell. A route over
                    // the road beats the same length through mud, which is what
                    // makes surfaces show up in the paths units actually take.
                    const terrain = value === DOOR ? DOOR_COST : SURFACE_BY_ID[this.surface[nIdx]].cost;
                    const step = (dx !== 0 && dy !== 0 ? SQRT2 : 1) * terrain;
                    const tentative = this.g[current] + step;
                    const seen = this.stamp[nIdx] === id;
                    if (seen && this.state[nIdx] === 2) continue;
                    if (!seen || tentative < this.g[nIdx]) {
                        this.stamp[nIdx] = id;
                        this.state[nIdx] = 1;
                        this.g[nIdx] = tentative;
                        this.came[nIdx] = current;
                        heap.push(nIdx, tentative + this.heuristic(nx, ny, goal.cx, goal.cy));
                    }
                }
            }
        }
        return null;
    }

    heuristic(ax, ay, bx, by) {
        const dx = Math.abs(ax - bx);
        const dy = Math.abs(ay - by);
        return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
    }

    buildPath(goalIdx, goalX, goalY) {
        const cells = [];
        let node = goalIdx;
        while (node !== -1) {
            cells.push(node);
            node = this.came[node];
        }
        cells.reverse();

        const points = cells.map((idx) => {
            const cx = idx % COLS;
            const cy = (idx - cx) / COLS;
            return { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2, door: this.cells[idx] === DOOR };
        });
        // Snap the tail to the exact click when that spot is actually standable.
        const last = points[points.length - 1];
        if (!this.isBlockedWorld(goalX, goalY) && !last.door) {
            last.x = goalX;
            last.y = goalY;
        }
        return this.smooth(points);
    }

    // String pull: drop a waypoint when we can walk straight past it. Door cells
    // are never dropped, so the unit always arrives square-on to the doorway.
    smooth(points) {
        if (points.length <= 2) return points;
        const out = [points[0]];
        let anchor = 0;
        for (let i = 1; i < points.length - 1; i++) {
            const next = points[i + 1];
            if (points[i].door || next.door || !this.clearLine(points[anchor], next)) {
                out.push(points[i]);
                anchor = i;
            }
        }
        out.push(points[points.length - 1]);
        return out;
    }

    // Sampled walk test. Door cells count as obstacles here on purpose; surfaced
    // ground does not — mud is slow, not impassable, and refusing to smooth over
    // it would leave units walking staircases across every soft patch.
    clearLine(a, b) {
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.ceil(dist / (CELL * 0.5));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = a.x + (b.x - a.x) * t;
            const y = a.y + (b.y - a.y) * t;
            if (this.valueAtWorld(x, y) !== FREE) return false;
        }
        return true;
    }
}

class MinHeap {
    constructor() {
        this.items = [];
        this.priorities = [];
    }

    get size() {
        return this.items.length;
    }

    push(item, priority) {
        this.items.push(item);
        this.priorities.push(priority);
        let i = this.items.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.priorities[parent] <= this.priorities[i]) break;
            this.swap(i, parent);
            i = parent;
        }
    }

    pop() {
        const top = this.items[0];
        const lastItem = this.items.pop();
        const lastPriority = this.priorities.pop();
        if (this.items.length > 0) {
            this.items[0] = lastItem;
            this.priorities[0] = lastPriority;
            let i = 0;
            for (;;) {
                const left = i * 2 + 1;
                const right = left + 1;
                let smallest = i;
                if (left < this.items.length && this.priorities[left] < this.priorities[smallest]) smallest = left;
                if (right < this.items.length && this.priorities[right] < this.priorities[smallest]) smallest = right;
                if (smallest === i) break;
                this.swap(i, smallest);
                i = smallest;
            }
        }
        return top;
    }

    swap(a, b) {
        [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
        [this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]];
    }
}
