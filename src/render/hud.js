// Screen-space HUD, kept in its own scene so camera zoom never scales the text:
// the selected unit's card with its four stat bars, mission status, the pause
// banner and the end-of-mission overlay.

import { VIEW, COLORS, UNIT_CLASSES } from '../config.js';
import { fillRotatedRect } from './entities.js';

const BAR_ORDER = ['Speed', 'Firepower', 'Survivability', 'Range'];
const BLOCKS = 10;
const BLOCK_W = 17;
const BLOCK_H = 10;
const BLOCK_GAP = 4;

export class HudScene extends Phaser.Scene {
    constructor() {
        super('hud');
    }

    create() {
        this.game_ = this.scene.get('game');
        this.gfx = this.add.graphics();

        const label = (x, y, size, origin = 0, color = '#ffffff') =>
            this.add.text(x, y, '', {
                fontFamily: '"Trebuchet MS", "Segoe UI", Arial, sans-serif',
                fontSize: `${size}px`,
                color,
                fontStyle: 'bold',
            }).setOrigin(origin, 0).setShadow(0, 2, '#00000088', 4);

        this.statusText = label(20, 16, 21);
        this.hintText = label(20, VIEW.height - 34, 15, 0, '#e8f0e8');
        this.hintText.setAlpha(0.85);

        this.cardName = label(VIEW.width - 24, VIEW.height - 178, 26, 1);
        this.cardWeapon = label(VIEW.width - 24, VIEW.height - 148, 15, 1, '#cfe9ff');
        this.barLabels = BAR_ORDER.map((name, i) =>
            label(VIEW.width - 24 - BLOCKS * (BLOCK_W + BLOCK_GAP) - 12, VIEW.height - 120 + i * 26, 15, 1),
        );
        this.barLabels.forEach((text, i) => text.setText(BAR_ORDER[i]));

        this.pauseText = label(VIEW.width / 2, 22, 22, 0.5, '#ffe066');
        this.pauseText.setOrigin(0.5, 0);

        this.outcomeText = label(VIEW.width / 2, VIEW.height / 2 - 40, 54, 0.5);
        this.outcomeText.setOrigin(0.5, 0.5);
        this.outcomeHint = label(VIEW.width / 2, VIEW.height / 2 + 20, 20, 0.5);
        this.outcomeHint.setOrigin(0.5, 0.5);

        this.hintText.setText('LMB select · drag box · RMB move (Shift queues) · SPACE pause · Tab cycle · WASD/wheel camera · R restart');

        this.scale.on('resize', this.layout, this);
        this.layout();
    }

    layout() {
        const w = this.scale.gameSize.width;
        const h = this.scale.gameSize.height;
        this.hintText.setPosition(20, h - 34);
        this.cardName.setPosition(w - 24, h - 182);
        this.cardWeapon.setPosition(w - 24, h - 152);
        this.barLabels.forEach((text, i) =>
            text.setPosition(w - 24 - BLOCKS * (BLOCK_W + BLOCK_GAP) - 12, h - 122 + i * 26),
        );
        this.pauseText.setPosition(w / 2, 22);
        this.outcomeText.setPosition(w / 2, h / 2 - 40);
        this.outcomeHint.setPosition(w / 2, h / 2 + 20);
    }

    update() {
        const state = this.game_ && this.game_.getHudState ? this.game_.getHudState() : null;
        if (!state) return;

        const w = this.scale.gameSize.width;
        const h = this.scale.gameSize.height;
        this.gfx.clear();

        this.statusText.setText(
            `HOSTILES ${state.hostilesDown}/${state.hostilesTotal} DOWN    SQUAD ${state.squadAlive}/${state.squadTotal}`,
        );
        this.pauseText.setText(state.paused ? '❚❚  PAUSED — issue orders, then press SPACE' : '');

        this.drawCard(state.cls, w, h);

        if (state.outcome) {
            this.gfx.fillStyle(0x000000, 0.55);
            this.gfx.fillRect(0, 0, w, h);
            const win = state.outcome === 'win';
            this.outcomeText.setText(win ? 'AREA CLEAR' : 'SQUAD ELIMINATED');
            this.outcomeText.setColor(win ? '#7df07d' : '#ff6b6b');
            this.outcomeHint.setText('Press R to run it again');
        } else {
            this.outcomeText.setText('');
            this.outcomeHint.setText('');
        }
    }

    drawCard(clsId, w, h) {
        if (!clsId) {
            this.cardName.setText('NO UNIT SELECTED');
            this.cardWeapon.setText('');
            this.barLabels.forEach((t) => t.setAlpha(0.25));
            return;
        }
        const cls = UNIT_CLASSES[clsId];
        this.barLabels.forEach((t) => t.setAlpha(1));
        this.cardName.setText(cls.name);
        this.cardWeapon.setText(cls.weapon.name);

        const barsRight = w - 24;
        const barsLeft = barsRight - BLOCKS * (BLOCK_W + BLOCK_GAP);

        // Unit glyph: the same circle-and-rifle the unit is drawn with on the map.
        const glyphX = barsLeft - 74;
        const glyphY = h - 168;
        const angle = -0.42;
        const r = 17;
        this.gfx.fillStyle(COLORS.friendly, 1);
        this.gfx.fillCircle(glyphX, glyphY, r);
        this.gfx.fillStyle(COLORS.gun, 1);
        fillRotatedRect(
            this.gfx,
            glyphX + Math.cos(angle) * r * 0.55 - Math.sin(angle) * r * 0.3,
            glyphY + Math.sin(angle) * r * 0.55 + Math.cos(angle) * r * 0.3,
            cls.id === 'breacher' ? 30 : 42,
            cls.id === 'breacher' ? 11 : 8,
            angle,
        );

        BAR_ORDER.forEach((name, row) => {
            const filled = cls.bars[name];
            const y = h - 122 + row * 26;
            for (let i = 0; i < BLOCKS; i++) {
                const x = barsLeft + i * (BLOCK_W + BLOCK_GAP);
                this.gfx.fillStyle(i < filled ? COLORS.friendly : COLORS.hud, i < filled ? 1 : 0.92);
                this.gfx.fillRect(x, y, BLOCK_W, BLOCK_H);
            }
        });
    }
}
