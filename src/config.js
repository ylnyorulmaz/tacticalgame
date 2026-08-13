// Central tuning table. Gameplay numbers and the HUD stat bars both read from
// here so the card in the corner never drifts from the actual behaviour.

export const WORLD = { width: 2400, height: 1600 };
export const VIEW = { width: 1280, height: 720 };

export const COLORS = {
    grassBase: 0x2fb01c,
    grassLight: 0x46c92c,
    grassDark: 0x25920f,
    grid: 0x0d3d08,
    treeShadow: 0x1d5c37,
    treeBase: 0x2f7a45,
    treeMid: 0x63b755,
    treeLight: 0xa8dd6a,
    floor: 0xe9ebef,
    floorShade: 0xdfe3ea,
    wall: 0x101418,
    sandbag: 0xdda94d,
    sandbagDark: 0xb9822f,
    friendly: 0x29a8e8,
    friendlySel: 0xffffff,
    hostile: 0xf21b1b,
    gun: 0x101418,
    hp: 0x53e06a,
    hpLow: 0xe8b23a,
    hpCrit: 0xe83a3a,
    hud: 0xffffff,
};

export const UNIT_RADIUS = 15;
export const ENEMY_RADIUS = 15;

// Bars are 0..10 and are purely presentational, but they are written to match
// the stats below so the card is an honest summary of the unit.
export const UNIT_CLASSES = {
    operator: {
        id: 'operator',
        name: 'Operator',
        team: 'friendly',
        hp: 100,
        speed: 132,
        sight: 460,
        turnSpeed: 7.5,
        breachTime: 1400,
        weapon: {
            name: 'Carbine',
            damage: 13,
            cooldown: 220,
            spread: 0.055,
            range: 440,
            bulletSpeed: 1500,
            burst: 3,
            burstGap: 620,
        },
        bars: { Speed: 6, Firepower: 6, Survivability: 6, Range: 8 },
    },
    breacher: {
        id: 'breacher',
        name: 'Breacher',
        team: 'friendly',
        hp: 140,
        speed: 148,
        sight: 380,
        turnSpeed: 9,
        breachTime: 650,
        weapon: {
            name: 'Shotgun',
            damage: 34,
            cooldown: 620,
            spread: 0.13,
            range: 210,
            bulletSpeed: 1250,
            burst: 1,
            burstGap: 0,
            pellets: 3,
        },
        bars: { Speed: 8, Firepower: 9, Survivability: 8, Range: 3 },
    },
    hostile: {
        id: 'hostile',
        name: 'Hostile',
        team: 'hostile',
        hp: 80,
        speed: 96,
        sight: 380,
        turnSpeed: 4.2,
        breachTime: 1400,
        weapon: {
            name: 'Rifle',
            damage: 10,
            cooldown: 300,
            spread: 0.1,
            range: 380,
            bulletSpeed: 1300,
            burst: 3,
            burstGap: 900,
        },
        bars: { Speed: 4, Firepower: 5, Survivability: 4, Range: 6 },
    },
};

export const AI = {
    reactionTime: 420,      // ms of contact before a hostile opens fire
    hearingRange: 620,      // gunfire within this radius pulls a hostile to ALERT
    searchTimeout: 6000,    // ms spent poking around a last known position
    alertTurnTime: 500,
};

export const FOG = {
    unexploredAlpha: 0.9,
    exploredAlpha: 0.42,    // ground you have cleared stays readable, just muted
    rayCount: 96,           // boundary rays used to round off the sight circle
    epsilon: 0.00035,       // angular nudge on each side of a corner
};
