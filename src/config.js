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
            sound: 'carbine',
            damage: 13,
            cooldown: 220,
            spread: 0.055,
            range: 440,
            bulletSpeed: 1500,
            burst: 3,
            burstGap: 620,
        },
        bars: { Speed: 6, Firepower: 6, Survivability: 6, Range: 8 },
        ability: 'Balanced rifleman',
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
            sound: 'shotgun',
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
        ability: 'Forces doors twice as fast',
    },
    grenadier: {
        id: 'grenadier',
        name: 'Grenadier',
        team: 'friendly',
        hp: 105,
        speed: 124,
        sight: 430,
        turnSpeed: 6.5,
        breachTime: 1500,
        weapon: {
            name: 'Rifle',
            sound: 'carbine',
            damage: 11,
            cooldown: 260,
            spread: 0.07,
            range: 380,
            bulletSpeed: 1450,
            burst: 3,
            burstGap: 700,
        },
        // Thrown instead of the rifle when a target is far enough away to be
        // worth a charge. Runs dry, at which point this is a plain rifleman.
        grenade: {
            count: 4,
            cooldown: 4200,
            minRange: 140,
            radius: 96,
            damage: 70,
            speed: 470,
        },
        bars: { Speed: 5, Firepower: 9, Survivability: 6, Range: 6 },
        ability: 'Grenades arc over cover',
    },
    medic: {
        id: 'medic',
        name: 'Medic',
        team: 'friendly',
        hp: 110,
        speed: 138,
        sight: 420,
        turnSpeed: 8,
        breachTime: 1600,
        weapon: {
            name: 'PDW',
            sound: 'pdw',
            damage: 9,
            cooldown: 240,
            spread: 0.09,
            range: 260,
            bulletSpeed: 1400,
            burst: 4,
            burstGap: 720,
        },
        support: {
            healRate: 9,        // hp per second, only while not engaging
            healRadius: 115,
            reviveTime: 2600,
            reviveHp: 45,
        },
        bars: { Speed: 7, Firepower: 3, Survivability: 7, Range: 4 },
        ability: 'Heals nearby · revives downed',
    },
    marksman: {
        id: 'marksman',
        name: 'Marksman',
        team: 'friendly',
        hp: 85,
        speed: 118,
        sight: 640,
        turnSpeed: 5,
        breachTime: 1700,
        weapon: {
            name: 'Marksman Rifle',
            sound: 'dmr',
            damage: 52,
            cooldown: 1500,
            spread: 0.008,
            range: 700,
            bulletSpeed: 2200,
            burst: 1,
            burstGap: 0,
        },
        steadyTime: 420,        // ms stationary before the shot can be taken
        bars: { Speed: 4, Firepower: 8, Survivability: 3, Range: 10 },
        ability: 'Must be set to shoot',
    },
    machinegunner: {
        id: 'machinegunner',
        name: 'Machine Gunner',
        team: 'friendly',
        hp: 125,
        speed: 100,
        sight: 400,
        turnSpeed: 3.4,
        breachTime: 1900,
        weapon: {
            name: 'Light MG',
            sound: 'mg',
            damage: 7,
            cooldown: 95,
            spread: 0.17,
            range: 400,
            bulletSpeed: 1500,
            burst: 14,
            burstGap: 1200,
        },
        suppressionPerHit: 26,  // applied on hits and near misses alike
        bars: { Speed: 3, Firepower: 7, Survivability: 7, Range: 6 },
        ability: 'Sustained fire pins hostiles',
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
            sound: 'carbine',
            damage: 10,
            cooldown: 300,
            spread: 0.1,
            range: 380,
            bulletSpeed: 1300,
            burst: 3,
            burstGap: 900,
        },
        bars: { Speed: 4, Firepower: 5, Survivability: 4, Range: 6 },
        ability: 'Holds its assigned arc',
    },
    hostileShotgun: {
        id: 'hostileShotgun',
        name: 'Shotgunner',
        team: 'hostile',
        hp: 70,
        speed: 122,
        sight: 340,
        turnSpeed: 6,
        breachTime: 1400,
        weapon: {
            name: 'Sawn-off',
            sound: 'shotgun',
            damage: 22,
            cooldown: 700,
            spread: 0.15,
            range: 190,
            bulletSpeed: 1250,
            burst: 1,
            burstGap: 0,
            pellets: 3,
        },
        aggressive: true,       // closes the distance instead of holding ground
        bars: { Speed: 7, Firepower: 8, Survivability: 3, Range: 2 },
        ability: 'Rushes whoever it hears',
    },
    hostileHeavy: {
        id: 'hostileHeavy',
        name: 'Heavy',
        team: 'hostile',
        hp: 150,
        speed: 78,
        sight: 430,
        turnSpeed: 3.2,
        breachTime: 1400,
        weapon: {
            name: 'Battle Rifle',
            sound: 'dmr',
            damage: 12,
            cooldown: 260,
            spread: 0.08,
            range: 470,
            bulletSpeed: 1400,
            burst: 4,
            burstGap: 850,
        },
        bars: { Speed: 2, Firepower: 7, Survivability: 8, Range: 8 },
        ability: 'Slow, tough, long reach',
    },
};

export const AI = {
    reactionTime: 420,      // ms of contact before a hostile opens fire
    hearingRange: 620,      // gunfire within this radius pulls a hostile to ALERT
    searchTimeout: 6000,    // ms spent poking around a last known position
    alertTurnTime: 500,
};

// Incoming fire pins a hostile down: past the threshold it stops shooting until
// the pressure lets up. Near misses count, which is what makes a machine gun
// useful even when it is not hitting anything.
export const SUPPRESSION = {
    threshold: 100,
    max: 180,
    decayPerSecond: 55,
    nearMissRadius: 42,
};

// Friendlies go down before they die, leaving the medic a window to drag them
// back. Hostiles get no such courtesy.
export const DOWNED = {
    bleedOut: 22000,
    reviveHp: 45,
};

export const FOG = {
    unexploredAlpha: 0.9,
    exploredAlpha: 0.42,    // ground you have cleared stays readable, just muted
    rayCount: 96,           // boundary rays used to round off the sight circle
    epsilon: 0.00035,       // angular nudge on each side of a corner
};
