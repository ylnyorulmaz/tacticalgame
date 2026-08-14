// The squad bar: one slot per operator, so the state of all six is readable
// without clicking through them. Health, what they are busy doing, and whether
// they are still breathing. Slots are click targets too.

import { COLORS, DOWNED } from '../config.js';
import { isVehicle } from '../systems/vehicles.js';
import { GUN, drawWeapon } from './weapons.js';

// Slots size themselves to the squad: six operators on most maps, eight when
// there is an AT gunner and a tank along.
const SLOT = { width: 140, minWidth: 104, height: 56, gap: 8 };

export class Roster {
    constructor(scene) {
        this.scene = scene;
        this.gfx = scene.add.graphics().setDepth(40);
        this.labels = [];
        this.slots = [];
    }

    // One label pair per squad member, created lazily so the roster does not
    // care how big the squad is.
    ensureLabels(count) {
        while (this.labels.length < count) {
            const make = (size, color) => this.scene.add.text(0, 0, '', {
                fontFamily: '"Trebuchet MS", "Segoe UI", Arial, sans-serif',
                fontSize: `${size}px`,
                color,
                fontStyle: 'bold',
            }).setDepth(41).setShadow(0, 1, '#000000aa', 3);
            this.labels.push({ name: make(12, '#ffffff'), state: make(11, '#ffd24a') });
        }
    }

    layout(squad) {
        const size = this.scene.scale.gameSize;
        const left = 20;
        const top = size.height - SLOT.height - 52;
        // Leave the unit card its corner, then share what is left.
        const available = Math.max(300, size.width - left - 300);
        const width = Math.max(
            SLOT.minWidth,
            Math.min(SLOT.width, (available - (squad.length - 1) * SLOT.gap) / Math.max(1, squad.length)),
        );

        this.slots = squad.map((unit, i) => ({
            unit,
            x: left + i * (width + SLOT.gap),
            y: top,
            width,
            height: SLOT.height,
        }));

        this.ensureLabels(squad.length);
        this.slots.forEach((slot, i) => {
            this.labels[i].name.setPosition(slot.x + 40, slot.y + 8);
            this.labels[i].state.setPosition(slot.x + 40, slot.y + 38);
        });
        for (let i = squad.length; i < this.labels.length; i++) {
            this.labels[i].name.setText('');
            this.labels[i].state.setText('');
        }
    }

    unitAt(x, y) {
        const slot = this.slots.find(
            (s) => x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height,
        );
        return slot ? slot.unit : null;
    }

    contains(x, y) {
        return this.slots.some(
            (s) => x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height,
        );
    }

    draw(squad) {
        if (this.slots.length !== squad.length) this.layout(squad);
        const g = this.gfx;
        g.clear();

        this.slots.forEach((slot, i) => {
            const unit = slot.unit;
            const labels = this.labels[i];
            const dead = !unit.alive && !unit.downed;

            g.fillStyle(0x000000, unit.selected ? 0.62 : 0.42);
            g.fillRoundedRect(slot.x, slot.y, slot.width, slot.height, 8);
            if (unit.selected) {
                g.lineStyle(2, COLORS.friendlySel, 0.9);
                g.strokeRoundedRect(slot.x, slot.y, slot.width, slot.height, 8);
            }

            // Class glyph, the same silhouette used on the map and the card.
            const glyphX = slot.x + 22;
            const glyphY = slot.y + slot.height / 2;
            g.fillStyle(dead ? 0x6a7a72 : COLORS.friendly, 1);
            g.fillCircle(glyphX, glyphY, 12);
            if (!dead) {
                drawWeapon(g, glyphX + 4, glyphY + 5, -0.5, GUN[unit.cls] || GUN.operator, 0.62);
            } else {
                g.lineStyle(3, COLORS.gun, 1);
                g.lineBetween(glyphX - 8, glyphY - 8, glyphX + 8, glyphY + 8);
                g.lineBetween(glyphX + 8, glyphY - 8, glyphX - 8, glyphY + 8);
            }

            const label = slot.width < 124 ? unit.stats.name.split(' ')[0] : unit.stats.name;
            labels.name.setText(`${i + 1} ${label}`);
            labels.name.setColor(dead ? '#8b9a92' : '#ffffff');

            // Health, or the bleed-out clock for a casualty.
            const barX = slot.x + 40;
            const barY = slot.y + 24;
            const barW = slot.width - 52;
            g.fillStyle(0x000000, 0.6);
            g.fillRect(barX - 1, barY - 1, barW + 2, 7);
            if (unit.downed) {
                const left = Math.max(0, unit.bleedOut / DOWNED.bleedOut);
                g.fillStyle(0xffd24a, 1);
                g.fillRect(barX, barY, barW * left, 5);
            } else if (!dead) {
                const ratio = Math.max(0, unit.hp / unit.maxHp);
                g.fillStyle(ratio > 0.6 ? COLORS.hp : ratio > 0.3 ? COLORS.hpLow : COLORS.hpCrit, 1);
                g.fillRect(barX, barY, barW * ratio, 5);
            }

            labels.state.setText(stateLabel(unit));
            labels.state.setColor(stateColor(unit));

            // Ammunition, drawn rather than written: a bar for the rounds in the
            // magazine and a tick per spare. Text here would fight the name and
            // the state tag for the same few pixels, and this reads faster.
            if (!dead && isVehicle(unit)) {
                // Three plates, thickest first: what the player needs to know is
                // which side of this thing is the soft one.
                const armour = unit.stats.vehicle.armour;
                const facets = [armour.front, armour.side, armour.rear];
                const thickest = Math.max(...facets);
                facets.forEach((value, f) => {
                    const bw = (barW - 12) / 3;
                    const bx = barX + f * (bw + 6);
                    g.fillStyle(0x000000, 0.6);
                    g.fillRect(bx - 1, barY + 7, bw + 2, 5);
                    g.fillStyle(f === 2 ? COLORS.hpCrit : f === 1 ? COLORS.hpLow : COLORS.hp, 1);
                    g.fillRect(bx, barY + 8, bw * (value / thickest), 3);
                });
            } else if (!dead && Number.isFinite(unit.magSize)) {
                const magW = barW * 0.62;
                const ratio = Math.max(0, unit.mag / unit.magSize);
                g.fillStyle(0x000000, 0.6);
                g.fillRect(barX - 1, barY + 7, magW + 2, 5);
                g.fillStyle(unit.isDry ? COLORS.hpCrit : unit.mag === 0 ? 0xffd24a : 0xcfe9ff, 1);
                g.fillRect(barX, barY + 8, magW * ratio, 3);

                const spares = Math.min(6, Math.ceil(unit.reserve / unit.magSize));
                for (let s = 0; s < spares; s++) {
                    g.fillStyle(0xcfe9ff, 0.85);
                    g.fillRect(barX + magW + 6 + s * 6, barY + 8, 3, 3);
                }
            }
        });
    }

    destroy() {
        this.gfx.destroy();
        for (const label of this.labels) {
            label.name.destroy();
            label.state.destroy();
        }
    }
}

function stateLabel(unit) {
    if (!unit.alive && !unit.downed) return 'KIA';
    if (unit.downed) return unit.reviveProgress > 0 ? 'BEING REVIVED' : 'DOWN';
    if (unit.breaching) return 'BREACHING';
    if (unit.reviving) return 'REVIVING';
    if (unit.blinded > 0) return 'BLINDED';
    if (unit.pinned) return 'PINNED';
    if (unit.reloadTimer > 0) return 'RELOADING';
    if (unit.isDry) return 'DRY';
    if (unit.order.stackAt) return unit.path ? 'TO STACK' : 'STACKED';
    if (unit.order.suppressAt) return 'SUPPRESSING';
    if (unit.order.stance === 'hold') return 'WEAPONS TIGHT';
    if (unit.inCover > 0.35) return 'IN COVER';
    if (unit.concealed) return 'CONCEALED';
    if (unit.elevated) return 'HIGH GROUND';
    if (unit.target) return 'ENGAGING';
    if (unit.path) return unit.order.pace === 'sprint' ? 'SPRINTING' : 'MOVING';
    return 'HOLDING';
}

function stateColor(unit) {
    if (!unit.alive && !unit.downed) return '#8b9a92';
    if (unit.downed) return '#ff6b6b';
    if (unit.pinned || unit.isDry || unit.blinded > 0) return '#ff6b6b';
    if (unit.reloadTimer > 0) return '#ffd24a';
    if (unit.order.stackAt) return '#7fd8ff';
    if (unit.order.suppressAt || unit.order.stance === 'hold') return '#ffd24a';
    if (unit.inCover > 0.35 || unit.concealed) return '#7df07d';
    if (unit.elevated) return '#7fd8ff';
    if (unit.target || unit.breaching) return '#ffd24a';
    return '#cfe9ff';
}
