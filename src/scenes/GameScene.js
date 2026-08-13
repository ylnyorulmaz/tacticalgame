// Mission scene: owns the world state and drives every system once per frame.
// Simulation only advances while unpaused; selection, orders, camera and drawing
// always run, which is what makes the pausable real-time loop work.

import { WORLD } from '../config.js';
import { LEVEL } from '../level.js';
import { NavGrid, CELL } from '../systems/nav.js';
import { VisionSystem, FogRenderer } from '../systems/vision.js';
import { CombatSystem } from '../systems/combat.js';
import { Unit, doorAtPoint } from '../systems/units.js';
import { updateHostile } from '../systems/ai.js';
import { updateSupport } from '../systems/support.js';
import { AudioEngine } from '../systems/audio.js';
import { EffectSystem } from '../systems/effects.js';
import { InputController } from '../systems/input.js';
import { buildTerrain } from '../render/terrain.js';
import { EntityRenderer } from '../render/entities.js';

export class GameScene extends Phaser.Scene {
    constructor() {
        super('game');
    }

    create() {
        // LEVEL is a module singleton; doors carry state, so reset them on restart.
        for (const door of LEVEL.doors) door.open = false;

        this.paused = false;
        this.outcome = null;
        this.outcomeAnnounced = false;
        this.level = LEVEL;

        buildTerrain(this, LEVEL, 0);
        this.vision = new VisionSystem(LEVEL);
        this.nav = new NavGrid(LEVEL);
        this.combat = new CombatSystem(LEVEL, this.vision);
        this.fog = new FogRenderer(this, 20);
        this.entities = new EntityRenderer(this);
        this.entities.drawDoors(LEVEL);
        // Survives restarts: the scene is rebuilt, but the AudioContext and the
        // player's mute choice should not be.
        const wasMuted = this.audio ? this.audio.muted : false;
        if (this.audio) this.audio.dispose();
        this.audio = new AudioEngine(this);
        this.audio.setMuted(wasMuted);
        this.effects = new EffectSystem();

        this.squad = LEVEL.squad.map((spec) => new Unit(spec));
        this.hostiles = LEVEL.hostiles.map((spec) => {
            const unit = new Unit({ cls: spec.cls || 'hostile', x: spec.x, y: spec.y, facing: spec.facing });
            unit.route = spec.route;
            unit.ai.state = spec.route ? 'patrol' : 'idle';
            return unit;
        });
        this.units = [...this.squad, ...this.hostiles];
        this.selected = [];

        this.ctx = {
            vision: this.vision,
            nav: this.nav,
            friendlies: this.squad,
            noises: this.combat.noises,
            // A shut door is pathable (you can plan through it) but not walkable
            // until it is actually breached open.
            blocked: (x, y) => this.nav.isBlockedWorld(x, y) || !!doorAtPoint(LEVEL.doors, x, y, 2),
            closedDoorAt: (x, y) => doorAtPoint(LEVEL.doors, x, y, 10),
            openDoor: (door) => this.openDoor(door),
            onBreachStart: (unit) => this.audio.play('breachStart', unit.x, unit.y),
            repath: (unit, point) => {
                const path = this.nav.findPath(unit.x, unit.y, point.x, point.y);
                unit.setPath(path);
            },
        };

        const cam = this.cameras.main;
        cam.setBounds(0, 0, WORLD.width, WORLD.height);
        cam.setZoom(0.78);
        cam.centerOn(LEVEL.cameraStart.x, LEVEL.cameraStart.y);

        this.inputCtl = new InputController(this);
        this.selectUnits([this.squad[0]]);

        // Only the first scene in the config array boots on its own.
        if (!this.scene.isActive('hud')) this.scene.launch('hud');
    }

    openDoor(door) {
        if (door.open) return;
        door.open = true;
        this.audio.play('breach', door.x + door.w / 2, door.y + door.h / 2);
        this.nav.rebuild();
        this.vision.refreshSegments();
        this.combat.refreshBlockers();
        this.entities.drawDoors(LEVEL);
    }

    togglePause() {
        if (this.outcome) return;
        this.paused = !this.paused;
        this.audio.play(this.paused ? 'pause' : 'unpause');
    }

    restartMission() {
        this.scene.restart();
    }

    selectUnits(units) {
        const unique = [...new Set(units.filter((u) => u && u.alive))];
        for (const unit of this.squad) unit.selected = false;
        for (const unit of unique) unit.selected = true;
        this.selected = unique;
    }

    cycleSelection() {
        const alive = this.squad.filter((u) => u.alive);
        if (alive.length === 0) return;
        const current = this.selected.length === 1 ? alive.indexOf(this.selected[0]) : -1;
        this.selectUnits([alive[(current + 1) % alive.length]]);
        this.audio.play('select');
    }

    issueMoveOrder(x, y, queue) {
        if (this.outcome || this.selected.length === 0) return;
        const targets = formationTargets(x, y, this.selected.length);
        let ordered = 0;

        this.selected.forEach((unit, i) => {
            if (!unit.alive) return;
            const wanted = targets[i];
            const cell = this.nav.cellAtWorld(wanted.x, wanted.y);
            const open = this.nav.nearestOpen(cell.cx, cell.cy);
            if (!open) return;
            const goal = this.nav.isBlockedWorld(wanted.x, wanted.y)
                ? { x: open.cx * CELL + CELL / 2, y: open.cy * CELL + CELL / 2 }
                : wanted;

            const queueing = queue && unit.path && unit.pathIndex < unit.path.length;
            const from = queueing ? unit.path[unit.path.length - 1] : unit;
            const path = this.nav.findPath(from.x, from.y, goal.x, goal.y);
            if (!path) return;

            if (queueing) {
                unit.path = [...unit.path.slice(unit.pathIndex), ...path];
                unit.pathIndex = 0;
                unit.orderPoint = { x: goal.x, y: goal.y };
            } else {
                unit.breaching = null;
                unit.setPath(path);
            }
            ordered++;
        });

        if (ordered > 0) this.audio.play('order');
    }

    update(time, delta) {
        const dt = Math.min(delta, 50);
        this.inputCtl.update(dt);

        if (!this.paused && !this.outcome) {
            for (const hostile of this.hostiles) updateHostile(hostile, dt, this.ctx);
            for (const unit of this.units) unit.update(dt, this.ctx);
            for (const unit of this.units) unit.separate(this.units, this.ctx);
            this.combat.update(dt, this.units, time);
            updateSupport(this.units, dt, this.combat.events);
            this.effects.update(dt, this.combat.projectiles);
            this.checkOutcome();
        }

        // One event stream, two consumers: the audio engine reads `type`, the
        // particle system reads `kind` and the extras that come with it. Drained
        // even while paused, so the last shots before a pause are not swallowed.
        if (this.combat.events.length > 0) {
            for (const event of this.combat.events) {
                this.audio.play(event.type, event.x, event.y);
                this.effects.handle(event);
            }
            this.combat.events.length = 0;
        }

        // Selection can outlive its units.
        if (this.selected.some((u) => !u.alive)) {
            this.selectUnits(this.selected.filter((u) => u.alive));
        }

        const polygons = this.squad
            .filter((u) => u.alive)
            .map((u) => this.vision.visibilityPolygon(u.x, u.y, u.stats.sight));
        this.fog.update(polygons);

        this.entities.draw({
            units: this.units,
            projectiles: this.combat.projectiles,
            explosions: this.combat.explosions,
            effects: this.effects,
            time,
            vision: this.vision,
            friendlies: this.squad,
            selected: this.selected,
        });
    }

    checkOutcome() {
        // A downed squadmate is not a lost one until it bleeds out.
        if (this.hostiles.every((u) => !u.alive)) this.outcome = 'win';
        else if (this.squad.every((u) => !u.alive && !u.downed)) this.outcome = 'lose';
        if (this.outcome && !this.outcomeAnnounced) {
            this.outcomeAnnounced = true;
            this.audio.play(this.outcome);
        }
    }

    getHudState() {
        const lead = this.selected.length > 0 ? this.selected[0] : null;
        return {
            cls: lead ? lead.cls : null,
            grenadesLeft: lead ? lead.grenadesLeft : 0,
            hostilesTotal: this.hostiles.length,
            hostilesDown: this.hostiles.filter((u) => !u.alive).length,
            squadTotal: this.squad.length,
            squadAlive: this.squad.filter((u) => u.alive).length,
            squadDown: this.squad.filter((u) => u.downed).length,
            paused: this.paused,
            outcome: this.outcome,
            muted: this.audio.muted || !this.audio.available,
        };
    }
}

// Spread a move order into a loose block so a four-man stack does not try to
// occupy one pixel.
function formationTargets(x, y, count) {
    if (count === 1) return [{ x, y }];
    const spacing = 46;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const targets = [];
    for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        targets.push({
            x: x + (col - (cols - 1) / 2) * spacing,
            y: y + (row - (rows - 1) / 2) * spacing,
        });
    }
    return targets;
}
