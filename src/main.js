// Entry point: boot Phaser with the menu, the mission and the HUD on top.

import { VIEW, COLORS } from './config.js';
import { MenuScene } from './scenes/MenuScene.js';
import { GameScene } from './scenes/GameScene.js';
import { HudScene } from './render/hud.js';

// ?renderer=canvas forces the canvas backend, which is the fog's fallback path.
const forceCanvas = new URLSearchParams(location.search).get('renderer') === 'canvas';

const game = new Phaser.Game({
    type: forceCanvas ? Phaser.CANVAS : Phaser.AUTO,
    parent: 'game',
    backgroundColor: COLORS.grassBase,
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: VIEW.width,
        height: VIEW.height,
    },
    render: { antialias: true, roundPixels: false },
    scene: [MenuScene, GameScene, HudScene],
});

// Handy for poking at the sim from the console while tuning.
window.__cqb = game;
