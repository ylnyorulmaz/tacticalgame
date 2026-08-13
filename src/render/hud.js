// Screen-space HUD, kept in its own scene so camera zoom never scales the text:
// the selected unit's card with its four stat bars, mission status, the pause
// banner and the end-of-mission overlay.

import { VIEW, COLORS, UNIT_CLASSES } from '../config.js';
import { drawCrossIcon } from './entities.js';
import { GUN, drawWeapon } from './weapons.js';
import { Roster } from './roster.js';
import { Minimap } from './minimap.js';
import { Palette } from './palette.js';

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
        this.roster = new Roster(this);
        this.minimapLevel = this.game_.level;
        this.minimap = new Minimap(this, this.minimapLevel);
        this.palette = new Palette(this);
        this.feedLabels = [];

        // Clicks that land on HUD furniture must not also order the squad into a
        // wall; GameScene's input controller asks this before acting.
        this.input.on('pointerdown', (pointer) => {
            const chip = this.palette.chipAt(pointer.x, pointer.y);
            if (chip) {
                this.runVerb(chip.verb.id);
                return;
            }
            const unit = this.roster.unitAt(pointer.x, pointer.y);
            if (unit && unit.alive) {
                this.game_.selectUnits([unit]);
                this.game_.audio.play('select');
                return;
            }
            if (this.minimap.contains(pointer.x, pointer.y)) {
                const world = this.minimap.toWorld(pointer.x, pointer.y);
                this.game_.cameras.main.centerOn(world.x, world.y);
            }
        });

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
        this.cardAbility = label(VIEW.width - 24, VIEW.height - 130, 13, 1, '#ffd24a');
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

        this.hintText.setText('LMB select · RMB move, drag to set facing (Shift queues) · SPACE pause and plan · Tab / 1-6 select · WASD/wheel camera · M mute · R restart');

        // Event feed lines, newest at the top.
        for (let i = 0; i < 5; i++) {
            this.feedLabels.push(this.add.text(0, 0, '', {
                fontFamily: '"Trebuchet MS", "Segoe UI", Arial, sans-serif',
                fontSize: '14px',
                color: '#ffffff',
                fontStyle: 'bold',
            }).setOrigin(1, 0).setShadow(0, 1, '#000000aa', 3));
        }

        this.scale.on('resize', this.layout, this);
        this.layout();
    }

    layout() {
        const w = this.scale.gameSize.width;
        const h = this.scale.gameSize.height;
        this.hintText.setPosition(20, h - 34);
        this.cardName.setPosition(w - 24, h - 196);
        this.cardWeapon.setPosition(w - 24, h - 166);
        this.cardAbility.setPosition(w - 24, h - 146);
        this.barLabels.forEach((text, i) =>
            text.setPosition(w - 24 - BLOCKS * (BLOCK_W + BLOCK_GAP) - 12, h - 122 + i * 26),
        );
        this.pauseText.setPosition(w / 2, 22);
        this.outcomeText.setPosition(w / 2, h / 2 - 40);
        this.outcomeHint.setPosition(w / 2, h / 2 + 20);

        if (this.minimap) this.minimap.layout();
        if (this.palette) this.palette.layout();
        this.feedLabels.forEach((label, i) => label.setPosition(w - 20, 210 + i * 19));
        if (this.roster && this.game_.squad) this.roster.layout(this.game_.squad);
    }

    // Screen regions the mission must not receive clicks through.
    hitsUi(x, y) {
        return this.roster.contains(x, y) || this.minimap.contains(x, y) || this.palette.contains(x, y);
    }

    // A palette chip does exactly what its hotkey does: the aimed verbs arm the
    // next click, the rest fire immediately.
    runVerb(id) {
        const game = this.game_;
        if (id === 'hold') return game.orderHold();
        if (id === 'pace') return game.orderPace();
        if (id === 'go') return game.orderGo();
        return game.inputCtl.arm(game.pendingOrder === id ? null : id);
    }

    update() {
        const state = this.game_ && this.game_.getHudState ? this.game_.getHudState() : null;
        if (!state) return;

        const w = this.scale.gameSize.width;
        const h = this.scale.gameSize.height;
        this.gfx.clear();

        const casualties = state.squadDown > 0 ? `    ${state.squadDown} DOWN` : '';
        const audio = state.muted ? '    🔇 MUTED' : '';
        this.statusText.setText(
            `HOSTILES ${state.hostilesDown}/${state.hostilesTotal} DOWN    SQUAD ${state.squadAlive}/${state.squadTotal}${casualties}${audio}`,
        );
        this.pauseText.setText(state.paused ? '❚❚  PAUSED — issue orders, then press SPACE' : '');

        // The HUD outlives a mission restart, so it has to notice a new level.
        if (this.game_.level !== this.minimapLevel) {
            this.minimap.destroy();
            this.minimapLevel = this.game_.level;
            this.minimap = new Minimap(this, this.minimapLevel);
            this.minimap.layout();
        }

        this.drawCard(state, w, h);
        this.palette.draw(state);
        this.roster.draw(this.game_.squad);
        this.minimap.draw({
            squad: this.game_.squad,
            hostiles: this.game_.hostiles,
            vision: this.game_.vision,
            camera: this.game_.cameras.main,
        });
        this.drawFeed(state.feed || []);

        if (state.outcome) {
            this.gfx.fillStyle(0x000000, 0.55);
            this.gfx.fillRect(0, 0, w, h);
            const win = state.outcome === 'win';
            this.outcomeText.setText(win ? 'AREA CLEAR' : 'SQUAD ELIMINATED');
            this.outcomeText.setColor(win ? '#7df07d' : '#ff6b6b');
            this.outcomeHint.setText('R to run it again  ·  Esc for map select');
        } else {
            this.outcomeText.setText('');
            this.outcomeHint.setText('');
        }
    }

    // Newest first, fading out as each entry ages.
    drawFeed(feed) {
        const now = this.time.now;
        this.feedLabels.forEach((label, i) => {
            const entry = feed[i];
            if (!entry) {
                label.setText('');
                return;
            }
            const age = now - entry.at;
            label.setText(entry.text);
            label.setColor(entry.color || '#ffffff');
            label.setAlpha(Math.max(0, 1 - age / 4200));
        });
    }

    drawCard(state, w, h) {
        const clsId = state.cls;
        if (!clsId) {
            this.cardName.setText('NO UNIT SELECTED');
            this.cardWeapon.setText('');
            this.cardAbility.setText('');
            this.barLabels.forEach((t) => t.setAlpha(0.25));
            return;
        }
        const cls = UNIT_CLASSES[clsId];
        this.barLabels.forEach((t) => t.setAlpha(1));
        this.cardName.setText(cls.name);
        this.cardWeapon.setText(cls.weapon.name);
        this.cardAbility.setText(cls.ability || '');

        const barsRight = w - 24;
        const barsLeft = barsRight - BLOCKS * (BLOCK_W + BLOCK_GAP);

        // Unit glyph: the same circle-and-weapon the unit is drawn with on the
        // map, read from the shared silhouette table so the two cannot drift.
        // The card shows the unit exactly as it appears on the map, weapon parts
        // and all, so the silhouette is learnable from the card.
        const glyph = GUN[cls.id] || GUN.operator;
        const glyphX = barsLeft - 82;
        const glyphY = h - 168;
        const angle = -0.42;
        const r = 17;
        const scale = 1.15;
        const gunX = glyphX + Math.cos(angle) * r * 0.55 - Math.sin(angle) * r * 0.3;
        const gunY = glyphY + Math.sin(angle) * r * 0.55 + Math.cos(angle) * r * 0.3;

        this.gfx.fillStyle(COLORS.friendly, 1);
        this.gfx.fillCircle(glyphX, glyphY, r);
        drawWeapon(this.gfx, gunX, gunY, angle, glyph, scale);
        if (glyph.icon === 'cross') drawCrossIcon(this.gfx, { x: glyphX, y: glyphY }, 1.15);

        // Grenade charges, so you can see when the grenadier has run dry.
        if (cls.grenade) {
            for (let i = 0; i < cls.grenade.count; i++) {
                const x = glyphX - 22 + i * 15;
                const spent = i >= state.grenadesLeft;
                this.gfx.fillStyle(spent ? COLORS.hud : 0xffd24a, spent ? 0.3 : 1);
                this.gfx.fillCircle(x, glyphY + 30, 5);
            }
        }

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
