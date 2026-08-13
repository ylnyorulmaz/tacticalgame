// Map thumbnails drawn straight from map data — grass, foliage, floors, walls
// and props scaled into a card. Because it reads the same arrays the mission
// does, a map edit updates its thumbnail for free.

import { WORLD, COLORS } from '../config.js';

export function drawMapPreview(g, level, x, y, width, height) {
    const scale = Math.min(width / WORLD.width, height / WORLD.height);
    const offsetX = x + (width - WORLD.width * scale) / 2;
    const offsetY = y + (height - WORLD.height * scale) / 2;
    const sx = (wx) => offsetX + wx * scale;
    const sy = (wy) => offsetY + wy * scale;

    g.fillStyle(COLORS.grassBase, 1);
    g.fillRect(offsetX, offsetY, WORLD.width * scale, WORLD.height * scale);

    // Foliage as single blobs — at this size the layered version is mush.
    g.fillStyle(COLORS.treeBase, 0.9);
    for (const tree of level.trees) {
        g.fillCircle(sx(tree.x), sy(tree.y), Math.max(1.6, 30 * tree.scale * scale));
    }

    g.fillStyle(COLORS.floor, 1);
    for (const floor of level.floors) {
        g.fillRect(sx(floor.x), sy(floor.y), floor.w * scale, floor.h * scale);
    }

    for (const prop of level.props) {
        if (prop.type === 'wreck') g.fillStyle(COLORS.hostile, 0.9);
        else if (prop.type === 'crate') g.fillStyle(COLORS.crate, 1);
        else g.fillStyle(COLORS.sandbag, 1);

        if (prop.type === 'sandbags') {
            g.fillCircle(sx(prop.x), sy(prop.y), Math.max(1.5, prop.radius * scale * 0.5));
        } else {
            g.fillRect(sx(prop.x - prop.w / 2), sy(prop.y - prop.h / 2), prop.w * scale, prop.h * scale);
        }
    }

    // Walls last and at a minimum thickness, or the layout disappears.
    g.fillStyle(COLORS.wall, 1);
    for (const wall of level.walls) {
        g.fillRect(sx(wall.x), sy(wall.y), Math.max(1.5, wall.w * scale), Math.max(1.5, wall.h * scale));
    }
    g.fillStyle(0xffd24a, 1);
    for (const door of level.doors) {
        g.fillRect(sx(door.x), sy(door.y), Math.max(1.5, door.w * scale), Math.max(1.5, door.h * scale));
    }

    // Where the two sides start, so the approach is readable at a glance.
    g.fillStyle(COLORS.hostile, 1);
    for (const hostile of level.hostiles) g.fillCircle(sx(hostile.x), sy(hostile.y), 2.6);
    g.fillStyle(COLORS.friendly, 1);
    for (const unit of level.squad) g.fillCircle(sx(unit.x), sy(unit.y), 2.6);
}
