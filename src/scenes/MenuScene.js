// Map selection. Three cards, each with a thumbnail drawn from the map's own
// data, and enough of a briefing to choose between them. Click a card, or use
// the arrow keys and Enter.

import { COLORS } from '../config.js';
import { MAPS, buildMap } from '../maps/index.js';
import { getAudio } from '../systems/audio.js';
import { drawMapPreview } from '../render/preview.js';
import { settings, loadSettings, toggleSetting } from '../systems/settings.js';

const CARD = { width: 340, height: 300, gap: 32 };
const SWITCH = { width: 300, height: 34 };

export class MenuScene extends Phaser.Scene {
    constructor() {
        super('menu');
    }

    create() {
        this.audio = getAudio(this);
        this.selection = 0;
        loadSettings();
        // Build every map once so the thumbnails are the real thing.
        this.levels = MAPS.map((meta) => buildMap(meta.id));

        this.backdrop = this.add.graphics().setDepth(0);
        this.cardGfx = this.add.graphics().setDepth(1);
        this.labels = [];

        const text = (x, y, size, color, style = 'bold') =>
            this.add.text(x, y, '', {
                fontFamily: '"Trebuchet MS", "Segoe UI", Arial, sans-serif',
                fontSize: `${size}px`,
                color,
                fontStyle: style,
            }).setOrigin(0.5, 0).setDepth(2).setShadow(0, 2, '#00000099', 5);

        this.title = text(0, 0, 62, '#ffffff');
        this.title.setText('TACTICAL CQB');
        this.subtitle = text(0, 0, 19, '#cfe9ff', 'normal');
        this.subtitle.setText('Pick a map. Six operators, one entry, no respawns.');
        this.hint = text(0, 0, 16, '#e8f0e8', 'normal');
        this.hint.setText('Click a card, or ←/→ and Enter  ·  1-3 direct  ·  M mute');

        // The one rule the player gets to choose before deploying.
        // Left-aligned so the words never run into the pill on the right.
        this.switchLabel = text(0, 0, 16, '#ffffff').setOrigin(0, 0);
        this.switchNote = text(0, 0, 13, '#cfe9ff', 'normal');
        this.switchNote.setText('Magazines, reload downtime and a finite pouch. Off: weapons never run dry.');

        for (const meta of MAPS) {
            this.labels.push({
                name: text(0, 0, 30, '#ffffff'),
                blurb: text(0, 0, 15, '#cfe9ff', 'normal'),
                stats: text(0, 0, 15, '#ffd24a'),
            });
        }
        MAPS.forEach((meta, i) => {
            this.labels[i].name.setText(meta.name);
            this.labels[i].blurb.setText(meta.blurb);
            const hostiles = this.levels[i].hostiles.length;
            const squad = this.levels[i].squad.length;
            this.labels[i].stats.setText(`${squad} operators  vs  ${hostiles} hostiles`);
        });

        this.input.on('pointerdown', () => this.audio.resume());
        this.input.on('pointermove', (pointer) => this.onHover(pointer));
        this.input.on('pointerup', (pointer) => this.onClick(pointer));

        const keys = this.input.keyboard;
        keys.on('keydown', () => this.audio.resume());
        keys.on('keydown-LEFT', () => this.moveSelection(-1));
        keys.on('keydown-RIGHT', () => this.moveSelection(1));
        keys.on('keydown-ENTER', () => this.launch(this.selection));
        keys.on('keydown-SPACE', () => this.launch(this.selection));
        keys.on('keydown-M', () => this.audio.toggleMute());
        keys.on('keydown-T', () => this.toggleAmmo());
        ['ONE', 'TWO', 'THREE'].forEach((key, i) => {
            if (i < MAPS.length) keys.on(`keydown-${key}`, () => this.launch(i));
        });

        this.scale.on('resize', this.layout, this);
        this.layout();
    }

    layout() {
        const w = this.scale.gameSize.width;
        const h = this.scale.gameSize.height;
        const totalWidth = MAPS.length * CARD.width + (MAPS.length - 1) * CARD.gap;
        const left = (w - totalWidth) / 2;
        const top = Math.max(150, h / 2 - CARD.height / 2 + 20);

        this.cards = MAPS.map((meta, i) => ({
            x: left + i * (CARD.width + CARD.gap),
            y: top,
            width: CARD.width,
            height: CARD.height,
        }));

        this.title.setPosition(w / 2, Math.max(28, top - 128));
        this.subtitle.setPosition(w / 2, Math.max(96, top - 60));
        this.hint.setPosition(w / 2, Math.min(h - 34, top + CARD.height + 36));

        this.switchRect = {
            x: w / 2 - SWITCH.width / 2,
            y: Math.min(h - 92, top + CARD.height + 74),
            width: SWITCH.width,
            height: SWITCH.height,
        };
        this.switchLabel.setPosition(this.switchRect.x + 14, this.switchRect.y + 8);
        this.switchNote.setPosition(w / 2, this.switchRect.y + SWITCH.height + 6);

        this.cards.forEach((card, i) => {
            const label = this.labels[i];
            label.name.setPosition(card.x + card.width / 2, card.y + 168);
            label.blurb.setPosition(card.x + card.width / 2, card.y + 206);
            label.blurb.setWordWrapWidth(card.width - 28);
            label.stats.setPosition(card.x + card.width / 2, card.y + 246);
        });

        this.drawBackdrop(w, h);
        this.drawCards();
        this.drawSwitch();
    }

    drawSwitch() {
        const rect = this.switchRect;
        if (!rect) return;
        const on = settings.ammo;
        const g = this.switchGfx || (this.switchGfx = this.add.graphics().setDepth(1));
        g.clear();
        g.fillStyle(0x121a15, 1);
        g.fillRoundedRect(rect.x, rect.y, rect.width, rect.height, 8);
        g.lineStyle(2, on ? COLORS.friendly : 0x4a5a50, 1);
        g.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 8);

        // A pill on the right that slides and changes colour, so the state is
        // readable without reading the words.
        const pill = { w: 46, h: 20 };
        const px = rect.x + rect.width - pill.w - 10;
        const py = rect.y + (rect.height - pill.h) / 2;
        g.fillStyle(on ? COLORS.friendly : 0x39463d, 1);
        g.fillRoundedRect(px, py, pill.w, pill.h, 10);
        g.fillStyle(0xffffff, 1);
        g.fillCircle(on ? px + pill.w - 10 : px + 10, py + pill.h / 2, 7);

        this.switchLabel.setText(`T   AMMO & RELOADS: ${on ? 'ON' : 'OFF'}`);
        this.switchLabel.setColor(on ? '#ffffff' : '#9fb0a5');
    }

    toggleAmmo() {
        toggleSetting('ammo');
        this.audio.play('select');
        this.drawSwitch();
    }

    drawBackdrop(w, h) {
        const g = this.backdrop;
        g.clear();
        g.fillStyle(0x0c1a12, 1);
        g.fillRect(0, 0, w, h);
        // A hint of the game's own terrain, dimmed right down.
        g.fillStyle(COLORS.grassDark, 0.25);
        for (let i = 0; i < 26; i++) {
            const x = (i * 197) % w;
            const y = ((i * 313) % h);
            g.fillEllipse(x, y, 260, 150);
        }
    }

    drawCards() {
        const g = this.cardGfx;
        g.clear();
        this.cards.forEach((card, i) => {
            const active = i === this.selection;
            g.fillStyle(0x000000, active ? 0.5 : 0.35);
            g.fillRoundedRect(card.x - 4, card.y - 4, card.width + 8, card.height + 8, 14);
            g.fillStyle(active ? 0x16281d : 0x121a15, 1);
            g.fillRoundedRect(card.x, card.y, card.width, card.height, 12);

            drawMapPreview(g, this.levels[i], card.x + 12, card.y + 12, card.width - 24, 132);

            g.lineStyle(active ? 3 : 1.5, active ? COLORS.friendly : 0x4a5a50, active ? 1 : 0.8);
            g.strokeRoundedRect(card.x, card.y, card.width, card.height, 12);

            // Difficulty pips.
            const pips = 3;
            for (let p = 0; p < pips; p++) {
                const filled = p < MAPS[i].difficulty;
                g.fillStyle(filled ? 0xffd24a : 0xffffff, filled ? 1 : 0.22);
                g.fillRect(card.x + card.width / 2 - 26 + p * 18, card.y + card.height - 26, 12, 7);
            }
        });
    }

    cardAt(pointer) {
        return this.cards.findIndex(
            (card) => pointer.x >= card.x && pointer.x <= card.x + card.width
                && pointer.y >= card.y && pointer.y <= card.y + card.height,
        );
    }

    onHover(pointer) {
        const index = this.cardAt(pointer);
        if (index === -1 || index === this.selection) return;
        this.selection = index;
        this.audio.play('select');
        this.drawCards();
    }

    onClick(pointer) {
        const rect = this.switchRect;
        if (rect && pointer.x >= rect.x && pointer.x <= rect.x + rect.width
            && pointer.y >= rect.y && pointer.y <= rect.y + rect.height) {
            this.toggleAmmo();
            return;
        }
        const index = this.cardAt(pointer);
        if (index !== -1) this.launch(index);
    }

    moveSelection(step) {
        this.selection = (this.selection + step + MAPS.length) % MAPS.length;
        this.audio.play('select');
        this.drawCards();
    }

    launch(index) {
        const meta = MAPS[index];
        if (!meta) return;
        this.audio.play('order');
        this.scene.start('game', { mapId: meta.id });
    }
}
