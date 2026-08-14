# AGENTS.md

Contributor guide for coding agents working on Tactical CQB. Player-facing
documentation is in [README.md](README.md); this file is about how the code is
put together and what will bite you.

## The shape of the project

A browser game: Phaser 3 plus Howler, ES modules, **no build step and no
bundler**. `npm install` exists solely to get Playwright for the browser test;
the game itself ships zero runtime dependencies. Phaser and Howler load from a
CDN with vendored copies in `vendor/` as an offline fallback (`index.html` does
the `document.write` dance), so the game boots with no network.

Keep it that way. If a change would need a compile step to run, it is the wrong
change for this repo.

## Commands

```bash
npm start                    # serve on :8000 — ES modules need HTTP, not file://
npm test                     # maps, audio, tactics, then the browser smoke test
npm run build:audio          # regenerate assets/audio/sfx.wav + src/audio-sprite.js
```

`?renderer=canvas` on the URL forces Phaser's canvas backend, which is the fog's
fallback path — worth checking after any fog change, because the WebGL path uses
an inverted geometry mask that canvas does not support.

`window.__cqb` is the Phaser game instance, which is how the browser tests and
any console poking reach the simulation.

### Tests

Four suites, run by a dependency-free runner in `test/run.mjs`:

| Suite | Needs a browser | What it protects |
| --- | --- | --- |
| `maps.test.mjs` | no | spawns standable, everything reachable, terrain and roads sane, armour can move |
| `audio.test.mjs` | no | every `weapon.sound` resolves, sprite offsets match the WAV |
| `tactics.test.mjs` | no | the rules: orders, tools, alarm, objectives, terrain, armour |
| `smoke.test.mjs` | **yes** | menu → mission → win → menu, with a clean console |

The browser suite is **skipped with a notice** when Playwright is missing, so
check the output rather than trusting a green run. `PLAYWRIGHT_PATH=...` points
the runner at a global install.

`tactics.test.mjs` builds a headless world with the same systems in the same
order as `GameScene`. That is only possible because every simulation module
avoids browser APIs — **keep new game logic out of the render and scene layers**
or it becomes untestable.

## Architecture

### The frame

`GameScene.update()` is the spine and the first thing to read. Fixed order every
frame, and the simulation half is skipped while `paused` (selection, camera and
drawing keep running — that is what makes the pausable real-time loop work):

```
AI / vehicle brains → unit.update → separate → cover → combat
  → smoke into vision → support → alarm → objectives → outcome
  → drain combat.events → fog polygons → draw
```

### Systems do not know about each other

Every system is handed one `ctx` object, built once in `GameScene.create()`:

```js
{ vision, nav, level, friendlies, hostiles, noises,
  navFor(unit), blocked(x, y, unit), closedDoorAt(x, y),
  openDoor(door, chargedBy), onBreachStart(unit, door, charge),
  repath(unit, point), spawnHostile(cls, x, y) }
```

`ctx.now` is stamped onto it at the top of every frame, because anything that
reports a noise has to timestamp it against the same clock combat prunes with.

Combat pushes records onto `combat.events` describing what happened; the scene
drains them into audio, particles, decals, the feed and the mission stats.
Combat has no idea any of those exist. New feedback belongs on that stream, not
as a call from inside a system.

### The distinctions that matter

Most bugs in this codebase have come from conflating one of these three.

**Seeing.** `src/systems/vision.js` answers three different questions:

- `hasLineOfSight(ax, ay, bx, by)` — walls and low cover. The *bullet's* question;
  blast and tracers use it. Smoke and grass do not stop a round.
- `canObserve(ax, ay, bx, by)` — adds smoke, and honours raised ground looking
  over chest-high cover. The *eye's* question; the fog is built from it.
- `canSeeUnit(ax, ay, unit)` — the eye's question about a *unit*, which adds
  concealment. Tall grass hides a man past ~150 px and does nothing to hide a
  tank.

Occluders live in four buckets — `walls`, `low`, `dynamic` (smoke) and the
`concealing` / `high` terrain rects. Concealment is deliberately **not** an
occluder: it is a property of the ground somebody is standing on. Modelling it as
segments made the fog show a field as plainly lit while acquisition insisted
nothing in it could be seen, which is the picture lying to the player.

**Routing.** Two nav grids. Infantry use `nav`; anything with a `vehicle` block
on its class uses `vehicleNav`, which inflates by a larger radius and seals
doorways so armour can never path indoors. Always go through `ctx.navFor(unit)`
or `ctx.repath(unit, point)`; never assume `ctx.nav`.

**Aiming.** `unit.facing` is the body (or a tank's hull, pointing where it
drives). `unit.turretAngle` is the gun. Weapons fire along the turret. For
infantry the two are the same value, so code written against the turret is right
for everyone — code written against `facing` silently breaks vehicles.

### Where the numbers live

`src/config.js` holds every gameplay value: unit classes and their weapons,
armour plates and penetration, throwables, order tuning, surfaces, alarm timings,
the mission rating curve. Balance changes go there, not into the systems. The
HUD's stat bars read the same table, so the card in the corner cannot drift away
from the behaviour.

### Data-driven maps

`src/maps/*.js` each export `build()` returning a **fresh** level object — doors,
prop hit points and terrain all carry state through a mission, so a second build
must never inherit the first's. `src/maps/index.js` holds the roster and assigns
default prop hit points. Adding a map means adding a module and a row there;
nothing else counts maps.

Map thumbnails, the minimap and the mission all read the same arrays, so map data
edits show up everywhere for free.

### Rendering layers

Depth order, all beneath the fog at 20: ground bake `0` (grass, terrain patches,
roads, trees, building — *and* accumulated decals, stamped in), props `5`,
corpses/ground marks `6`, doors `8`, debris `29`, units `30`, effects `31`,
overlays `32`. HUD is a separate scene so camera zoom never scales text.

The ground bake never changes, which is why decals are stamped into it. Props are
a separate texture because they can be destroyed and re-baked.

## Traps this repo has already fallen into

Worth knowing before you repeat one:

- **Only the first scene in the Phaser config array auto-starts.** The HUD is
  launched explicitly by `GameScene`.
- **Arrays handed out in `ctx` must be mutated, not reassigned.** `combat.noises`
  was pruned with `filter`, which silently left the AI and the alarm reading a
  list that never changed again — hostiles never heard gunfire for several
  rounds of work.
- **Anything cached from the level needs refreshing together.** Doors opening,
  cover being destroyed and tanks being knocked out all go through
  `GameScene.rebuildWorld()`: both nav grids, the vision segments and the bullet
  blockers.
- **The nav grid inflates obstacles by a body radius.** "Cell is blocked" is
  therefore not the same as "inside geometry" — map validation checks the latter.
- **Phaser's `centerOn` is not zoom-aware for scroll**, but `camera.worldView`
  gives correct screen↔world mapping. Browser tests must map clicks through it.
- **`Phaser` is a namespace object, not a function.** Test for `window.Phaser &&
  window.Phaser.Game`.
- **When a test fails, suspect the fixture first.** Repeatedly, cases here broke
  because a unit sat in tall grass, was pathed off the map, or was placed inside
  a wall — not because the rule under test was wrong. Fix the fixture and say so.

## Conventions

- Four-space indent, ES modules, single quotes, semicolons. Match the file you
  are in.
- Comments explain **why** a rule exists or what it is protecting, not what the
  next line does. Several of the comments in this repo are the only record of a
  bug that took a while to find; do not strip them.
- Prefer extending an existing pattern to inventing a parallel one. The
  grenadier's `stats.grenade` + `mayThrow` pair became the template for the
  tank's `stats.mainGun` + `mayFireMain`; the door-refresh path became the
  template for destroyed cover.
- New rules get a case in `test/tactics.test.mjs`, asserting behaviour rather
  than pixels.
- Verify in the browser as well as in tests. Several bugs here were invisible to
  the headless suites and obvious in one screenshot.
- Report performance as measured numbers against a baseline, not as claims.

## Git

Work happens on `claude/top-down-cqb-game-f2ftr3` and merges to `main` only when
asked. Commit messages here are prose explaining the problem and the decision,
not bullet lists of changed files.
