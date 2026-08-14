// End-to-end smoke test: serve the game, open it in Chromium, walk from the menu
// into a mission and back out. Needs Playwright; the runner skips this suite when
// it is not installed so the fast suites still work anywhere.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.wav': 'audio/wav', '.png': 'image/png', '.json': 'application/json',
};

export const name = 'smoke (browser)';
export const needsBrowser = true;

// A static server small enough to not warrant a dependency.
function serve(port) {
    const server = createServer(async (req, res) => {
        const path = normalize(decodeURIComponent(req.url.split('?')[0]));
        const file = join(ROOT, path === '/' ? 'index.html' : path);
        if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
        try {
            const body = await readFile(file);
            res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
            res.end(body);
        } catch {
            res.writeHead(404).end();
        }
    });
    return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

export async function run(t, { chromium }) {
    const port = 8199;
    const server = await serve(port);
    const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
        // The CDN tags fail closed in offline environments; the vendored copies
        // are what the game actually boots from, so that error is expected.
        const text = m.text();
        if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(text)) errors.push(text);
    });

    try {
        await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
        await page.waitForFunction(() => !!window.__cqb, null, { timeout: 20000 });
        await page.waitForTimeout(1200);

        t.ok(await page.evaluate(() => !!window.Phaser && !!window.Phaser.Game), 'Phaser loaded');
        t.ok(await page.evaluate(() => typeof window.Howl === 'function'), 'Howler loaded');
        t.ok(
            await page.evaluate(() => window.__cqb.scene.getScene('menu').scene.isActive()),
            'the game opens on the map menu',
        );

        // Into a mission.
        await page.evaluate(() => window.__cqb.scene.getScene('menu').launch(1));
        await page.waitForFunction(() => {
            const s = window.__cqb.scene.getScene('game');
            return s && s.scene.isActive() && s.squad && s.squad.length > 0;
        }, null, { timeout: 20000 });
        await page.mouse.click(640, 300);           // gesture: unlocks audio
        await page.waitForTimeout(1200);

        const state = await page.evaluate(() => {
            const s = window.__cqb.scene.getScene('game');
            return {
                map: s.level.id,
                squad: s.squad.length,
                hostiles: s.hostiles.length,
                hudActive: s.scene.isActive('hud'),
                audio: s.audio.available,
                fps: Math.round(window.__cqb.loop.actualFps),
            };
        });
        t.equal(state.map, 'warehouse', 'the chosen map is the one that loads');
        // Seven on the warehouse: the AT gunner comes along wherever there is
        // armour on the map.
        t.equal(state.squad, 7, 'the squad deploys at full strength');
        t.ok(state.hostiles >= 6, `the garrison is present (${state.hostiles})`);
        t.ok(state.hudActive, 'the HUD comes up with the mission');
        t.ok(state.audio, 'the sound bank loaded');
        t.ok(state.fps > 0, `the loop is running (${state.fps} fps)`);

        // Warehouse is an intel run, so clearing it is not the same as winning:
        // the mission ends when the objectives say it does.
        await page.evaluate(() => {
            const s = window.__cqb.scene.getScene('game');
            s.hostiles.forEach((h) => h.takeDamage(9999));
        });
        await page.waitForTimeout(600);
        t.equal(
            await page.evaluate(() => window.__cqb.scene.getScene('game').outcome),
            null,
            'clearing the map is not enough on an intel mission',
        );

        // Stand on the intel, then walk everyone into the extraction zone.
        await page.evaluate(() => {
            const s = window.__cqb.scene.getScene('game');
            const intel = s.objectives.list.find((o) => o.kind === 'intel');
            s.squad.forEach((u) => { u.x = intel.x; u.y = intel.y; });
        });
        // Software rendering runs the simulation well under real time, so wait
        // on the state rather than on the clock.
        const picked = await page.waitForFunction(
            () => window.__cqb.scene.getScene('game').objectives.list
                .find((o) => o.kind === 'intel').done,
            null,
            { timeout: 20000 },
        ).then(() => true, () => false);
        t.ok(picked, 'standing on the intel picks it up');

        await page.evaluate(() => {
            const s = window.__cqb.scene.getScene('game');
            const zone = s.objectives.exfil;
            s.squad.forEach((u) => { u.x = zone.x + zone.w / 2; u.y = zone.y + zone.h / 2; });
        });
        await page.waitForFunction(
            () => !!window.__cqb.scene.getScene('game').outcome,
            null,
            { timeout: 20000 },
        ).catch(() => {});
        const finish = await page.evaluate(() => {
            const s = window.__cqb.scene.getScene('game');
            return { outcome: s.outcome, grade: s.rating && s.rating.grade };
        });
        t.equal(finish.outcome, 'win', 'exfil with the intel wins the mission');
        t.ok(!!finish.grade, `and the run is graded (${finish.grade})`);

        await page.keyboard.press('Escape');
        await page.waitForTimeout(900);
        const back = await page.evaluate(() => ({
            menu: window.__cqb.scene.getScene('menu').scene.isActive(),
            hud: window.__cqb.scene.getScene('hud').scene.isActive(),
        }));
        t.ok(back.menu, 'Esc returns to the map menu');
        t.ok(!back.hud, 'the HUD does not leak over the menu');

        t.empty(errors, 'no console or page errors');
    } finally {
        await browser.close();
        server.close();
    }
}
