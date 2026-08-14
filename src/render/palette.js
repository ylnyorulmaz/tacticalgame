// The order palette: one chip per verb, showing its hotkey, whether it is armed
// and whether the selection is already doing it. Chips are click targets, so the
// verbs are discoverable without reading the hint line.

const CHIP = { height: 30, gap: 8, padding: 12 };
const THROWABLES = ['frag', 'smoke', 'flash'];

// Order matters — this is the row the player learns.
export const VERBS = [
    { id: 'hold', key: 'F', label: 'HOLD FIRE', color: '#ffd24a' },
    { id: 'suppress', key: 'Q', label: 'SUPPRESS', color: '#ffd24a' },
    { id: 'frag', key: 'G', label: 'FRAG', color: '#ff8a3a' },
    { id: 'smoke', key: 'C', label: 'SMOKE', color: '#dfe6e1' },
    { id: 'flash', key: 'V', label: 'FLASH', color: '#fff2a8' },
    { id: 'stack', key: 'E', label: 'STACK', color: '#7fd8ff' },
    { id: 'pace', key: 'Z', label: 'PACE', color: '#cfe9ff' },
    { id: 'go', key: '⏎', label: 'GO', color: '#7df07d' },
];

export class Palette {
    constructor(scene) {
        this.scene = scene;
        this.gfx = scene.add.graphics().setDepth(40);
        this.chips = [];
        this.labels = VERBS.map(() =>
            scene.add.text(0, 0, '', {
                fontFamily: '"Trebuchet MS", "Segoe UI", Arial, sans-serif',
                fontSize: '13px',
                color: '#ffffff',
                fontStyle: 'bold',
            }).setOrigin(0, 0.5).setDepth(41).setShadow(0, 1, '#000000aa', 3),
        );
    }

    layout() {
        const top = 48;
        let x = 20;
        this.chips = VERBS.map((verb, i) => {
            // Measured at its widest so the chip does not resize once counts and
            // the current pace are filled in.
            const text = verb.id === 'pace' ? 'Z  NORMAL'
                : verb.id === 'go' ? '⏎  GO (0)'
                    : THROWABLES.includes(verb.id) ? `${verb.key}  ${verb.label} 0`
                        : `${verb.key}  ${verb.label}`;
            this.labels[i].setText(text);
            const width = this.labels[i].width + CHIP.padding * 2;
            const chip = { verb, x, y: top, width, height: CHIP.height };
            this.labels[i].setPosition(x + CHIP.padding, top + CHIP.height / 2);
            x += width + CHIP.gap;
            return chip;
        });
    }

    contains(x, y) {
        return !!this.chipAt(x, y);
    }

    chipAt(x, y) {
        return this.chips.find(
            (c) => x >= c.x && x <= c.x + c.width && y >= c.y && y <= c.y + c.height,
        ) || null;
    }

    // `state` comes straight from GameScene.getHudState().
    draw(state) {
        if (this.chips.length === 0) this.layout();
        const g = this.gfx;
        g.clear();

        this.chips.forEach((chip, i) => {
            const active = this.isActive(chip.verb.id, state);
            const armed = state.pendingOrder === chip.verb.id;
            const usable = this.usable(chip.verb.id, state);

            g.fillStyle(armed ? 0x3a4f2a : 0x000000, armed ? 0.85 : 0.45);
            g.fillRoundedRect(chip.x, chip.y, chip.width, chip.height, 6);
            if (armed || active) {
                g.lineStyle(2, armed ? 0xffffff : 0xffd24a, 0.9);
                g.strokeRoundedRect(chip.x, chip.y, chip.width, chip.height, 6);
            }

            this.labels[i].setColor(active || armed ? chip.verb.color : '#ffffff');
            this.labels[i].setAlpha(usable ? 1 : 0.35);
        });

        // Chips carry their own state: the pace chip shows the current pace, GO
        // shows how many are waiting on it, and each throwable shows how many
        // the selection is still carrying.
        this.chips.forEach((chip, i) => {
            const id = chip.verb.id;
            if (id === 'pace') {
                this.labels[i].setText(`Z  ${state.pace.toUpperCase()}`);
            } else if (id === 'go') {
                this.labels[i].setText(state.stacked > 0 ? `⏎  GO (${state.stacked})` : '⏎  GO');
            } else if (THROWABLES.includes(id)) {
                const left = (state.kitTotals && state.kitTotals[id]) || 0;
                this.labels[i].setText(`${chip.verb.key}  ${chip.verb.label} ${left}`);
            }
        });
    }

    // A throwable chip is dead when the selection is not carrying any.
    usable(id, state) {
        if (id === 'go') return state.stacked > 0;
        if (!state.hasSelection) return false;
        if (THROWABLES.includes(id)) return ((state.kitTotals && state.kitTotals[id]) || 0) > 0;
        return true;
    }

    isActive(id, state) {
        if (id === 'hold') return state.stance === 'hold';
        if (id === 'suppress') return state.suppressing;
        if (id === 'stack') return state.stacked > 0;
        if (id === 'pace') return state.pace !== 'normal';
        if (id === 'go') return state.stacked > 0;
        return false;
    }

    destroy() {
        this.gfx.destroy();
        for (const label of this.labels) label.destroy();
    }
}
