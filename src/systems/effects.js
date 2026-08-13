// Transient particles: ejected casings, muzzle smoke, wall dust, blood flicks,
// explosion debris and shockwaves. Purely cosmetic, so it freezes with the rest
// of the simulation when the game is paused.

import { GUN } from '../render/weapons.js';

const MAX_PARTICLES = 420;
const GRENADE_TRAIL_INTERVAL = 45;   // ms between puffs behind a grenade in flight

export class EffectSystem {
    constructor() {
        this.particles = [];
        this.trailTimer = 0;
    }

    get count() {
        return this.particles.length;
    }

    add(p) {
        // Oldest particles lose their slot rather than letting the array grow.
        if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
        p.maxLife = p.life;
        this.particles.push(p);
    }

    // Dispatch for the event stream the combat system produces.
    handle(event) {
        switch (event.kind) {
            case 'shot': return this.shot(event.x, event.y, event.angle, GUN[event.cls]);
            case 'grenade': return this.smokePuff(event.x, event.y, event.angle, 3, 0.9);
            case 'impact': return this.impact(event.x, event.y, event.angle);
            case 'hit': return this.bloodHit(event.x, event.y, event.angle, event.team);
            case 'explosion': return this.explosion(event.x, event.y, event.radius);
            default: return undefined;
        }
    }

    // Ejected brass plus a wisp of smoke off the muzzle.
    shot(x, y, angle, gun) {
        const casing = (gun && gun.casing) || { color: 0xd8a44a, size: 3 };
        const side = angle + Math.PI / 2 + (Math.random() - 0.5) * 0.5;
        const speed = 70 + Math.random() * 70;
        this.add({
            kind: 'casing',
            x,
            y,
            vx: Math.cos(side) * speed - Math.cos(angle) * 30,
            vy: Math.sin(side) * speed - Math.sin(angle) * 30,
            angle: Math.random() * Math.PI,
            spin: (Math.random() - 0.5) * 22,
            size: casing.size,
            color: casing.color,
            drag: 4.5,
            life: 1400,
        });
        this.smokePuff(x, y, angle, 2, 0.55);
    }

    smokePuff(x, y, angle, count, strength) {
        for (let i = 0; i < count; i++) {
            const spread = angle + (Math.random() - 0.5) * 0.8;
            const speed = (20 + Math.random() * 45) * strength;
            this.add({
                kind: 'smoke',
                x: x + (Math.random() - 0.5) * 4,
                y: y + (Math.random() - 0.5) * 4,
                vx: Math.cos(spread) * speed,
                vy: Math.sin(spread) * speed,
                size: 3 + Math.random() * 4 * strength,
                grow: 22 * strength,
                alpha: 0.32 * strength,
                drag: 2.2,
                life: 420 + Math.random() * 260,
            });
        }
    }

    // Dust and chips kicked off whatever the round buried itself in.
    impact(x, y, angle = Math.random() * Math.PI * 2) {
        for (let i = 0; i < 5; i++) {
            const away = angle + Math.PI + (Math.random() - 0.5) * 1.9;
            const speed = 60 + Math.random() * 150;
            this.add({
                kind: 'spark',
                x,
                y,
                vx: Math.cos(away) * speed,
                vy: Math.sin(away) * speed,
                size: 1.5 + Math.random() * 2,
                color: i === 0 ? 0xffd24a : 0xbfc4c9,
                drag: 7,
                life: 180 + Math.random() * 160,
            });
        }
        this.smokePuff(x, y, angle + Math.PI, 1, 0.45);
    }

    // A flick of colour off a body — stylised to match the flat unit circles,
    // not gore.
    bloodHit(x, y, angle = Math.random() * Math.PI * 2, team) {
        const color = team === 'friendly' ? 0x1a6fa8 : 0xa81a1a;
        for (let i = 0; i < 5; i++) {
            const away = angle + (Math.random() - 0.5) * 1.5;
            const speed = 50 + Math.random() * 120;
            this.add({
                kind: 'spark',
                x,
                y,
                vx: Math.cos(away) * speed,
                vy: Math.sin(away) * speed,
                size: 2 + Math.random() * 2.5,
                color,
                drag: 6,
                life: 260 + Math.random() * 180,
            });
        }
    }

    explosion(x, y, radius = 90) {
        this.add({
            kind: 'ring',
            x,
            y,
            vx: 0,
            vy: 0,
            size: radius * 0.35,
            grow: radius * 2.6,
            color: 0xffd24a,
            alpha: 0.75,
            drag: 0,
            life: 380,
        });
        for (let i = 0; i < 14; i++) {
            const away = Math.random() * Math.PI * 2;
            const speed = 120 + Math.random() * 300;
            this.add({
                kind: 'debris',
                x,
                y,
                vx: Math.cos(away) * speed,
                vy: Math.sin(away) * speed,
                angle: Math.random() * Math.PI,
                spin: (Math.random() - 0.5) * 26,
                size: 2 + Math.random() * 3.5,
                color: i % 3 === 0 ? 0xffb020 : 0x2f3a2a,
                drag: 4,
                life: 500 + Math.random() * 420,
            });
        }
        this.smokePuff(x, y, Math.random() * Math.PI * 2, 6, 1.4);
    }

    update(dt, projectiles = []) {
        const seconds = dt / 1000;

        for (const p of this.particles) {
            p.life -= dt;
            p.x += p.vx * seconds;
            p.y += p.vy * seconds;
            if (p.drag) {
                const damp = Math.max(0, 1 - p.drag * seconds);
                p.vx *= damp;
                p.vy *= damp;
            }
            if (p.spin) p.angle += p.spin * seconds;
            if (p.grow) p.size += p.grow * seconds;
        }
        this.particles = this.particles.filter((p) => p.life > 0);

        // Grenades leave a thin trail so you can read the arc while it flies.
        this.trailTimer -= dt;
        if (this.trailTimer <= 0) {
            this.trailTimer = GRENADE_TRAIL_INTERVAL;
            for (const shot of projectiles) {
                if (shot.kind !== 'grenade') continue;
                this.smokePuff(shot.x, shot.y, Math.atan2(-shot.vy, -shot.vx), 1, 0.4);
            }
        }
    }

    // Ground-level particles draw under the units, airborne ones over them.
    draw(below, above, isVisible) {
        for (const p of this.particles) {
            if (isVisible && !isVisible(p.x, p.y)) continue;
            const t = Math.max(0, p.life / p.maxLife);
            const g = p.kind === 'casing' ? below : above;

            switch (p.kind) {
                case 'casing':
                    g.fillStyle(p.color, Math.min(1, t * 2.5));
                    fillSpinningRect(g, p.x, p.y, p.size * 2.2, p.size, p.angle);
                    break;
                case 'debris':
                    g.fillStyle(p.color, Math.min(1, t * 2));
                    fillSpinningRect(g, p.x, p.y, p.size * 1.8, p.size, p.angle);
                    break;
                case 'smoke':
                    g.fillStyle(0xb9c2bd, (p.alpha ?? 0.3) * t);
                    g.fillCircle(p.x, p.y, p.size);
                    break;
                case 'spark':
                    g.fillStyle(p.color, Math.min(1, t * 1.8));
                    g.fillCircle(p.x, p.y, p.size * (0.5 + t * 0.5));
                    break;
                case 'ring':
                    g.lineStyle(Math.max(1, 7 * t), p.color, (p.alpha ?? 0.7) * t);
                    g.strokeCircle(p.x, p.y, p.size);
                    break;
                default:
                    break;
            }
        }
    }
}

function fillSpinningRect(g, cx, cy, w, h, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hw = w / 2;
    const hh = h / 2;
    g.fillPoints([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([px, py]) => ({
        x: cx + px * cos - py * sin,
        y: cy + px * sin + py * cos,
    })), true);
}
