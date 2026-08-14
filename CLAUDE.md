# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The full contributor guide — architecture, conventions and the traps this
codebase has already fallen into — lives in **[AGENTS.md](AGENTS.md)**. Read that
first. What follows is the short version.

## Commands

```bash
npm test                     # everything: maps, audio, tactics, browser smoke
npm start                    # serve on :8000 (the game needs HTTP, not file://)
npm run build:audio          # regenerate assets/audio/sfx.wav + src/audio-sprite.js
```

There is no build step and no bundler. `npm install` only exists for Playwright.

**Running one suite.** The runner takes no filter flags. To run a single suite,
import it directly:

```bash
node -e "import('./test/maps.test.mjs').then(async m => {
  const { suite } = await import('./test/harness.mjs');
  const { t, report } = suite(m.name); await m.run(t); process.exit(report());
})"
```

**The browser suite needs Playwright.** It is skipped with a notice when the
module is missing, so a green `npm test` does not necessarily mean the browser
suite ran — check the output for `smoke (browser)`. Point the runner at a global
install with `PLAYWRIGHT_PATH`:

```bash
PLAYWRIGHT_PATH=$(npm root -g)/playwright/index.js npm test
```

## Architecture in one pass

`GameScene.update()` is the spine. Read it first: it drives every system in a
fixed order each frame (AI → unit movement → separation → cover → combat →
support → alarm → objectives → outcome → fog → draw), and nothing advances while
`paused`.

Systems never reach for each other. They are handed a `ctx` object built once in
`GameScene.create()` carrying `vision`, `nav`, `navFor`, `friendlies`, `hostiles`,
`noises`, `blocked`, `repath`, `openDoor` and the current time. Combat reports
what happened into `combat.events`, which the scene drains into the audio engine,
the particle system, the decal layer and the HUD feed — combat itself knows about
none of them.

Three distinctions carry most of the design weight, and getting them wrong is the
usual source of bugs:

- **`hasLineOfSight` vs `canObserve` vs `canSeeUnit`** (`src/systems/vision.js`).
  The first is the bullet's question, the second the eye's, the third the eye's
  question about a *unit* — because tall grass hides a man and not a tank.
- **Two nav grids.** Infantry route on `nav`; anything with a `vehicle` block on
  its class routes on `vehicleNav`, which is wider and has doorways sealed. Use
  `ctx.navFor(unit)` rather than picking one.
- **`unit.facing` vs `unit.turretAngle`.** Weapons fire along the turret. For
  infantry the two are the same value, so code written against the turret is
  correct for everyone.

`src/config.js` holds every gameplay number — stats, weapons, armour, surfaces,
timings. Change balance there, not in the systems.

## Conventions

Match the surrounding code: four-space indent, ES modules, no framework beyond
Phaser, and comments that explain *why* a rule exists rather than restating the
line below them.

Add a test to `test/tactics.test.mjs` for any new rule. It runs headless in plain
Node against the same systems in the same order as `GameScene`, which is only
possible because the simulation modules touch no browser APIs. Keep it that way:
anything importing Phaser cannot be tested there.

When a test fails, check the fixture before the game. Several suites in this
repo's history broke because a fixture sat in tall grass or off the map, not
because the rule was wrong.
