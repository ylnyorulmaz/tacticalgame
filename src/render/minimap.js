// Minimap: the briefing map you were handed, with live markers on top.
//
// The static geometry is baked once through the same `drawMapPreview` the menu
// cards use, so it can never disagree with the map. Deliberately not fogged —
// terrain is knowledge you would have had walking in. Hostiles still only appear
// while somebody can actually see them, which is the part that matters.

import { WORLD, COLORS } from '../config.js';
import { drawMapPreview } from './preview.js';

export class Minimap {
    constructor(scene, level, { width = 226, height = 150, margin = 16 } = {}) {
        this.scene = scene;
        this.width = width;
        this.height = height;
        this.margin = margin;
        this.scale = Math.min(width / WORLD.width, height / WORLD.height);

        // Bake the terrain once; only the markers are redrawn per frame.
        const baked = scene.make.graphics({ add: false });
        drawMapPreview(baked, level, 0, 0, width, height);
        this.texture = scene.add.renderTexture(0, 0, width, height).setOrigin(0, 0).setDepth(40);
        this.texture.draw(baked);
        baked.destroy();

        this.markers = scene.add.graphics().setDepth(41);
        this.frame = scene.add.graphics().setDepth(42);
        this.layout();
    }

    layout() {
        const size = this.scene.scale.gameSize;
        this.x = size.width - this.width - this.margin;
        this.y = this.margin + 40;
        this.texture.setPosition(this.x, this.y);
    }

    contains(x, y) {
        return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height;
    }

    // Minimap point -> world point, for click-to-look.
    toWorld(x, y) {
        const offsetX = this.x + (this.width - WORLD.width * this.scale) / 2;
        const offsetY = this.y + (this.height - WORLD.height * this.scale) / 2;
        return {
            x: (x - offsetX) / this.scale,
            y: (y - offsetY) / this.scale,
        };
    }

    draw(state) {
        const { squad, hostiles, vision, camera } = state;
        const offsetX = this.x + (this.width - WORLD.width * this.scale) / 2;
        const offsetY = this.y + (this.height - WORLD.height * this.scale) / 2;
        const sx = (wx) => offsetX + wx * this.scale;
        const sy = (wy) => offsetY + wy * this.scale;

        const g = this.markers;
        g.clear();

        // Only hostiles somebody can see, same rule as the battlefield itself.
        g.fillStyle(COLORS.hostile, 1);
        for (const hostile of hostiles) {
            if (!hostile.alive || !vision.canAnySee(squad, hostile.x, hostile.y)) continue;
            g.fillCircle(sx(hostile.x), sy(hostile.y), 3);
        }

        for (const unit of squad) {
            if (!unit.alive && !unit.downed) continue;
            g.fillStyle(unit.downed ? 0xffd24a : COLORS.friendly, 1);
            g.fillCircle(sx(unit.x), sy(unit.y), unit.selected ? 4 : 3);
            if (unit.selected) {
                g.lineStyle(1.5, 0xffffff, 0.95);
                g.strokeCircle(sx(unit.x), sy(unit.y), 6);
            }
        }

        // Where the camera is looking.
        const view = camera.worldView;
        this.frame.clear();
        this.frame.lineStyle(1.5, 0xffffff, 0.7);
        this.frame.strokeRect(sx(view.x), sy(view.y), view.width * this.scale, view.height * this.scale);
        this.frame.lineStyle(2, 0x000000, 0.55);
        this.frame.strokeRect(this.x - 1, this.y - 1, this.width + 2, this.height + 2);
    }

    destroy() {
        this.texture.destroy();
        this.markers.destroy();
        this.frame.destroy();
    }
}
