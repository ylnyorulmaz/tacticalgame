// Mouse and keyboard: selection (click, box, hotkeys), move orders with a small
// formation spread, the tactical order verbs, the pause toggle, and camera
// pan/zoom. Everything here keeps working while the game is paused — that is the
// whole point of the pause, and now that orders exist it is a planning phase
// rather than just a freeze frame.

import { COLORS } from '../config.js';

const CAMERA_PAN_SPEED = 850;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 1.6;
const CLICK_SLOP = 7;
const FACE_SLOP = 16;       // drag this far off a move order to set an arrival facing

// Verbs that are armed by a key and then resolved by clicking a point.
export const AIMED_VERBS = {
    suppress: { key: 'Q', label: 'SUPPRESS', color: 0xffd24a },
    frag: { key: 'G', label: 'FRAG', color: 0xff8a3a },
    stack: { key: 'E', label: 'STACK', color: 0x7fd8ff },
};

export class InputController {
    constructor(scene) {
        this.scene = scene;
        this.cam = scene.cameras.main;
        this.boxGfx = scene.add.graphics().setDepth(41);
        this.dragStart = null;
        this.dragging = false;
        this.panFrom = null;
        this.faceFrom = null;   // right-drag in progress: move point plus facing
        this.pending = null;    // armed aimed verb waiting for a click

        scene.input.mouse.disableContextMenu();

        // Browsers hold the audio context closed until the page is interacted
        // with, so the first click or key is also what turns the sound on.
        scene.input.on('pointerdown', () => scene.audio.resume());
        scene.input.keyboard.on('keydown', () => scene.audio.resume());

        scene.input.on('pointerdown', (pointer) => this.onPointerDown(pointer));
        scene.input.on('pointerup', (pointer) => this.onPointerUp(pointer));
        scene.input.on('pointermove', (pointer) => this.onPointerMove(pointer));
        scene.input.on('wheel', (pointer, over, dx, dy) => {
            const zoom = Phaser.Math.Clamp(this.cam.zoom * (dy > 0 ? 0.9 : 1.1), ZOOM_MIN, ZOOM_MAX);
            this.cam.setZoom(zoom);
        });

        const keys = scene.input.keyboard;
        keys.on('keydown-SPACE', () => scene.togglePause());
        keys.on('keydown-TAB', (event) => {
            event.preventDefault();
            scene.cycleSelection();
        });
        keys.on('keydown-ESC', () => {
            if (scene.outcome) scene.returnToMenu();
            else if (this.pending) this.arm(null);
            else scene.selectUnits([]);
        });

        // Order verbs. The three aimed ones arm a click; the rest apply to the
        // current selection immediately.
        for (const [verb, spec] of Object.entries(AIMED_VERBS)) {
            keys.on(`keydown-${spec.key}`, () => this.arm(this.pending === verb ? null : verb));
        }
        keys.on('keydown-F', () => scene.orderHold());
        keys.on('keydown-Z', () => scene.orderPace());
        keys.on('keydown-ENTER', () => scene.orderGo());
        keys.on('keydown-R', () => scene.restartMission());
        keys.on('keydown-M', () => scene.audio.toggleMute());
        const numberKeys = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
        for (let i = 1; i <= numberKeys.length; i++) {
            keys.on(`keydown-${numberKeys[i - 1]}`, (event) => {
                const unit = scene.squad[i - 1];
                if (!unit || !unit.alive) return;
                this.select(event.shiftKey ? [...scene.selected, unit] : [unit]);
            });
        }
        keys.on('keydown-A', (event) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            this.select(scene.squad.filter((u) => u.alive));
        });

        this.panKeys = keys.addKeys({
            up: Phaser.Input.Keyboard.KeyCodes.W,
            down: Phaser.Input.Keyboard.KeyCodes.S,
            left: Phaser.Input.Keyboard.KeyCodes.A,
            right: Phaser.Input.Keyboard.KeyCodes.D,
            up2: Phaser.Input.Keyboard.KeyCodes.UP,
            down2: Phaser.Input.Keyboard.KeyCodes.DOWN,
            left2: Phaser.Input.Keyboard.KeyCodes.LEFT,
            right2: Phaser.Input.Keyboard.KeyCodes.RIGHT,
        });
    }

    // Selection made by the player, as opposed to the housekeeping the scene does
    // when a selected unit goes down — only the former should click.
    select(units) {
        this.scene.selectUnits(units);
        if (this.scene.selected.length > 0) this.scene.audio.play('select');
    }

    // The HUD scene sits on top; a click on the roster or minimap belongs to it.
    overUi(pointer) {
        const hud = this.scene.scene.get('hud');
        return !!hud && hud.scene.isActive() && hud.hitsUi && hud.hitsUi(pointer.x, pointer.y);
    }

    // Arm or disarm an aimed verb. The scene publishes it so the HUD can show
    // which one is waiting and the cursor can change.
    arm(verb) {
        this.pending = verb && this.scene.selected.length > 0 ? verb : null;
        this.scene.pendingOrder = this.pending;
        this.scene.input.setDefaultCursor(this.pending ? 'crosshair' : 'default');
    }

    onPointerDown(pointer) {
        if (this.overUi(pointer)) return;
        if (pointer.middleButtonDown()) {
            this.panFrom = { x: pointer.x, y: pointer.y, scrollX: this.cam.scrollX, scrollY: this.cam.scrollY };
            return;
        }
        if (pointer.rightButtonDown()) {
            // Held, not issued: dragging out from here sets the arrival facing.
            this.faceFrom = { x: pointer.worldX, y: pointer.worldY, queue: !!pointer.event.shiftKey };
            return;
        }
        if (this.pending) return;   // the click belongs to the armed verb
        this.dragStart = { x: pointer.worldX, y: pointer.worldY };
        this.dragging = false;
    }

    onPointerMove(pointer) {
        if (this.panFrom && pointer.middleButtonDown()) {
            this.cam.setScroll(
                this.panFrom.scrollX + (this.panFrom.x - pointer.x) / this.cam.zoom,
                this.panFrom.scrollY + (this.panFrom.y - pointer.y) / this.cam.zoom,
            );
            return;
        }
        if (this.faceFrom && pointer.rightButtonDown()) {
            this.drawFacing(this.faceFrom, { x: pointer.worldX, y: pointer.worldY });
            return;
        }
        if (!this.dragStart || !pointer.leftButtonDown()) return;
        const dx = pointer.worldX - this.dragStart.x;
        const dy = pointer.worldY - this.dragStart.y;
        if (Math.hypot(dx, dy) > CLICK_SLOP) this.dragging = true;
        if (this.dragging) this.drawBox(this.dragStart, { x: pointer.worldX, y: pointer.worldY });
    }

    onPointerUp(pointer) {
        if (this.overUi(pointer) && !this.dragging) {
            this.dragStart = null;
            return;
        }
        if (pointer.button === 1) {
            this.panFrom = null;
            return;
        }
        // Right button released: move there, facing whichever way it was dragged.
        if (pointer.button === 2) {
            const from = this.faceFrom;
            this.faceFrom = null;
            this.boxGfx.clear();
            if (!from) return;
            const dx = pointer.worldX - from.x;
            const dy = pointer.worldY - from.y;
            const facing = Math.hypot(dx, dy) > FACE_SLOP ? Math.atan2(dy, dx) : null;
            this.scene.issueMoveOrder(from.x, from.y, from.queue, facing);
            return;
        }
        // A click that belongs to an armed verb never selects or box-selects.
        if (this.pending) {
            const verb = this.pending;
            this.arm(null);
            this.scene.resolveAimedOrder(verb, pointer.worldX, pointer.worldY);
            return;
        }
        if (pointer.button !== 0 || !this.dragStart) return;
        const start = this.dragStart;
        const end = { x: pointer.worldX, y: pointer.worldY };
        this.dragStart = null;
        this.boxGfx.clear();

        if (!this.dragging) {
            const unit = this.scene.squad.find(
                (u) => u.alive && Math.hypot(u.x - end.x, u.y - end.y) <= u.radius + 8,
            );
            this.select(unit ? [unit] : []);
            return;
        }
        this.dragging = false;

        const minX = Math.min(start.x, end.x);
        const maxX = Math.max(start.x, end.x);
        const minY = Math.min(start.y, end.y);
        const maxY = Math.max(start.y, end.y);
        const inBox = this.scene.squad.filter(
            (u) => u.alive && u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY,
        );
        this.select(inBox);
    }

    // The arrow you drag out of a move order: where they go, and which way they
    // will be looking when they get there.
    drawFacing(from, to) {
        const g = this.boxGfx;
        g.clear();
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        if (Math.hypot(dx, dy) <= FACE_SLOP) return;
        const angle = Math.atan2(dy, dx);
        const reach = 74;
        const spread = 0.42;

        g.lineStyle(2, COLORS.friendlySel, 0.85);
        g.strokeCircle(from.x, from.y, 12);
        g.lineBetween(
            from.x, from.y,
            from.x + Math.cos(angle) * reach, from.y + Math.sin(angle) * reach,
        );
        for (const side of [-1, 1]) {
            g.lineBetween(
                from.x, from.y,
                from.x + Math.cos(angle + side * spread) * reach * 0.8,
                from.y + Math.sin(angle + side * spread) * reach * 0.8,
            );
        }
    }

    drawBox(a, b) {
        this.boxGfx.clear();
        this.boxGfx.lineStyle(2, COLORS.friendlySel, 0.9);
        this.boxGfx.fillStyle(COLORS.friendlySel, 0.12);
        const rect = new Phaser.Geom.Rectangle(
            Math.min(a.x, b.x),
            Math.min(a.y, b.y),
            Math.abs(b.x - a.x),
            Math.abs(b.y - a.y),
        );
        this.boxGfx.fillRectShape(rect);
        this.boxGfx.strokeRectShape(rect);
    }

    update(dt) {
        const k = this.panKeys;
        const step = (CAMERA_PAN_SPEED * dt) / 1000 / this.cam.zoom;
        let dx = 0;
        let dy = 0;
        if (k.left.isDown || k.left2.isDown) dx -= step;
        if (k.right.isDown || k.right2.isDown) dx += step;
        if (k.up.isDown || k.up2.isDown) dy -= step;
        if (k.down.isDown || k.down2.isDown) dy += step;
        if (dx !== 0 || dy !== 0) this.cam.setScroll(this.cam.scrollX + dx, this.cam.scrollY + dy);
    }
}
