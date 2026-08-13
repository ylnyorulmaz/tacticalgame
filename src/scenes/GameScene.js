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
        this.level = LEVEL;

        buildTerrain(this, LEVEL, 0);
        this.vision = new VisionSystem(LEVEL);
        this.nav = new NavGrid(LEVEL);
        this.combat = new CombatSystem(LEVEL, this.vision);
        this.fog = new FogRenderer(this, 20);
        this.entities = new EntityRenderer(this);
        this.entities.drawDoors(LEVEL);

        this.squad = LEVEL.squad.map((spec) => new Unit(spec));
        this.hostiles = LEVEL.hostiles.map((spec) => {
            const unit = new Unit({ cls: 'hostile', x: spec.x, y: spec.y, facing: spec.facing });
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
        this.nav.rebuild();
        this.vision.refreshSegments();
        this.combat.refreshBlockers();
        this.entities.drawDoors(LEVEL);
    }

    togglePause() {
        if (this.outcome) return;
        this.paused = !this.paused;
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
    }

    issueMoveOrder(x, y, queue) {
        if (this.outcome || this.selected.length === 0) return;
        const targets = formationTargets(x, y, this.selected.length);

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
        });
    }

    update(time, delta) {
        const dt = Math.min(delta, 50);
        this.inputCtl.update(dt);

        if (!this.paused && !this.outcome) {
            for (const hostile of this.hostiles) updateHostile(hostile, dt, this.ctx);
            for (const unit of this.units) unit.update(dt, this.ctx);
            for (const unit of this.units) unit.separate(this.units, this.ctx);
            this.combat.update(dt, this.units, time);
            this.checkOutcome();
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
            vision: this.vision,
            friendlies: this.squad,
            selected: this.selected,
        });
    }

    checkOutcome() {
        if (this.hostiles.every((u) => !u.alive)) this.outcome = 'win';
        else if (this.squad.every((u) => !u.alive)) this.outcome = 'lose';
    }

    getHudState() {
        return {
            cls: this.selected.length > 0 ? this.selected[0].cls : null,
            hostilesTotal: this.hostiles.length,
            hostilesDown: this.hostiles.filter((u) => !u.alive).length,
            squadTotal: this.squad.length,
            squadAlive: this.squad.filter((u) => u.alive).length,
            paused: this.paused,
            outcome: this.outcome,
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
