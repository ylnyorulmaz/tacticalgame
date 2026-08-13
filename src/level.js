// Geometry helpers shared by every map: which rectangles stop a body, which
// stop a bullet, which stop sight. Maps themselves live in src/maps/.

export function rectContains(rect, x, y) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

// Permanently solid geometry: walls and wrecks, never doors. The nav grid uses
// this one, because a closed door has to stay reachable — a unit walks up to it
// and breaches it.
export function staticSolidRects(level) {
    const rects = level.walls.slice();
    for (const prop of level.props) {
        if (!prop.blocksMove) continue;
        if (isBox(prop)) rects.push(boxRect(prop));
    }
    return rects;
}

// Rect-shaped props — wrecked vehicles and crates — share one footprint helper.
function isBox(prop) {
    return prop.type === 'wreck' || prop.type === 'crate';
}

function boxRect(prop) {
    return { x: prop.x - prop.w / 2, y: prop.y - prop.h / 2, w: prop.w, h: prop.h };
}

// Every rectangle that should stop a bullet or a body, doors included when shut.
export function solidRects(level) {
    const rects = level.walls.slice();
    for (const door of level.doors) {
        if (!door.open) rects.push(door);
    }
    for (const prop of level.props) {
        if (!prop.blocksMove) continue;
        if (isBox(prop)) rects.push(boxRect(prop));
    }
    return rects;
}

// Rectangles that block line of sight. Sandbags are low cover: you can see over
// them, you just cannot walk or shoot through them.
export function sightBlockingRects(level) {
    const rects = level.walls.slice();
    for (const door of level.doors) {
        if (!door.open) rects.push(door);
    }
    for (const prop of level.props) {
        if (prop.blocksSight && isBox(prop)) rects.push(boxRect(prop));
    }
    return rects;
}

// Sandbags are an arc of low cover: bullets and bodies stop, sight does not.
export const SANDBAG_HALF_SPREAD = Math.PI * 0.62;
export const SANDBAG_THICKNESS = 15;

export function sandbagArcs(level) {
    return level.props.filter((p) => p.type === 'sandbags');
}

export function pointInSandbag(arc, x, y, pad = 0) {
    const dx = x - arc.x;
    const dy = y - arc.y;
    const dist = Math.hypot(dx, dy);
    const band = SANDBAG_THICKNESS + pad;
    if (dist < arc.radius - band || dist > arc.radius + band) return false;
    let delta = Math.atan2(dy, dx) - arc.angle;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    return Math.abs(delta) <= SANDBAG_HALF_SPREAD;
}
