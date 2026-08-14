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
    crate: 0xb07a3c,
    crateDark: 0x8a5c2a,
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
            magazine: 30,
            spare: 6,
            reloadTime: 2200,
        },
        kit: { smoke: 1 },
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
            magazine: 6,
            spare: 6,
            reloadTime: 2700,
            pellets: 3,
        },
        kit: { charge: 2, flash: 2 },
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
            magazine: 30,
            spare: 8,
            reloadTime: 2400,
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
            penetration: 20,    // enough for a tank's back plate, nothing more
        },
        kit: { frag: 4, smoke: 2 },
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
            magazine: 32,
            spare: 5,
            reloadTime: 2000,
        },
        support: {
            healRate: 9,        // hp per second, only while not engaging
            healRadius: 115,
            reviveTime: 2600,
            reviveHp: 45,
        },
        kit: { smoke: 2 },
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
            // Suppressed: the squad's one quiet weapon. A kill with it does not
            // raise the alarm, though the body still will once somebody finds it.
            name: 'Suppressed DMR',
            sound: 'suppressed',
            suppressed: true,
            damage: 52,
            cooldown: 1500,
            spread: 0.008,
            range: 700,
            bulletSpeed: 2200,
            burst: 1,
            burstGap: 0,
            magazine: 10,
            spare: 6,
            reloadTime: 2500,
        },
        steadyTime: 420,        // ms stationary before the shot can be taken
        kit: { },
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
            magazine: 100,
            spare: 3,
            reloadTime: 4200,
        },
        suppressionPerHit: 26,  // applied on hits and near misses alike
        kit: { },
        bars: { Speed: 3, Firepower: 7, Survivability: 7, Range: 6 },
        ability: 'Sustained fire pins hostiles',
    },
    // The answer to armour. One tube, a long reload, and it has to be planted
    // to fire — plus a backblast that hurts anyone standing behind it, so where
    // it sets up is a real decision rather than a stat line.
    antitank: {
        id: 'antitank',
        name: 'AT Gunner',
        team: 'friendly',
        hp: 95,
        speed: 112,
        sight: 470,
        turnSpeed: 5.5,
        breachTime: 1800,
        // Sidearm: what it has once the tubes are gone, and all it has against
        // infantry that gets close.
        weapon: {
            name: 'Sidearm',
            sound: 'pdw',
            damage: 8,
            cooldown: 300,
            spread: 0.11,
            range: 210,
            bulletSpeed: 1300,
            burst: 3,
            burstGap: 800,
            magazine: 15,
            spare: 5,
            reloadTime: 1900,
        },
        // The launcher rides the same machinery as a tank's main gun.
        mainGun: {
            name: 'AT Launcher',
            sound: 'atLaunch',
            damage: 120,
            radius: 90,
            penetration: 80,
            cooldown: 5200,
            speed: 620,
            range: 560,
            minRange: 120,
            spread: 0.02,
            rounds: 4,
            steadyTime: 500,        // has to be planted, like the marksman
            backblast: { range: 90, arc: 0.7, damage: 45 },
        },
        kit: { smoke: 1 },
        bars: { Speed: 4, Firepower: 10, Survivability: 4, Range: 7 },
        ability: 'Kills armour · mind the backblast',
    },
    // The squad's own armour. Same rules as theirs, including the doorways it
    // cannot fit through and the engine that gives the whole approach away.
    tank: {
        id: 'tank',
        name: 'Tank',
        team: 'friendly',
        hp: 240,
        speed: 68,
        sight: 520,
        turnSpeed: 1.2,
        breachTime: 99999,
        radius: 34,
        vehicle: {
            armour: { front: 60, side: 34, rear: 14 },
            turretSpeed: 1.8,
            engineNoise: 520,
        },
        weapon: {
            name: 'Coaxial MG',
            sound: 'mg',
            damage: 6,
            cooldown: 110,
            spread: 0.14,
            range: 430,
            bulletSpeed: 1500,
            burst: 12,
            burstGap: 1500,
            magazine: 250,
            spare: 4,
            reloadTime: 5000,
            penetration: 0,
        },
        mainGun: {
            name: '90 mm',
            sound: 'mainGun',
            damage: 95,
            radius: 115,
            penetration: 70,
            cooldown: 4600,
            speed: 900,
            range: 700,
            minRange: 150,
            spread: 0.025,
            rounds: 12,
        },
        suppressionPerHit: 22,
        kit: { },
        bars: { Speed: 2, Firepower: 10, Survivability: 10, Range: 9 },
        ability: 'Armoured · cannot go indoors · very loud',
    },
    // Not a fighter: carries nothing, shoots at nobody, and is not deliberately
    // targeted by either side. Stray rounds and blast are what kill them, which
    // is exactly why a frag is the wrong tool on a rescue.
    hostage: {
        id: 'hostage',
        name: 'Hostage',
        team: 'civilian',
        noncombatant: true,
        hp: 60,
        speed: 126,
        sight: 220,
        turnSpeed: 7,
        breachTime: 99999,
        weapon: {
            name: 'Unarmed',
            sound: 'carbine',
            damage: 0,
            cooldown: 99999,
            spread: 0,
            range: 0,
            bulletSpeed: 1,
            burst: 1,
            burstGap: 0,
        },
        bars: { Speed: 6, Firepower: 0, Survivability: 2, Range: 0 },
        ability: 'Get them out alive',
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
            magazine: 30,
            spare: 8,
            reloadTime: 2400,
        },
        bars: { Speed: 4, Firepower: 5, Survivability: 4, Range: 6 },
        ability: 'Holds its assigned arc',
    },
    // Armour. Cannot fit through a doorway, which is what makes every building
    // on a tank map worth running to, and cannot be suppressed or blinded.
    hostileTank: {
        id: 'hostileTank',
        name: 'Tank',
        team: 'hostile',
        hp: 240,
        speed: 64,
        sight: 520,
        turnSpeed: 1.1,
        breachTime: 99999,
        radius: 34,
        vehicle: {
            armour: { front: 60, side: 34, rear: 14 },
            turretSpeed: 1.7,       // rad/s, independent of the hull
            engineNoise: 520,       // tracks are audible a long way off
        },
        // Coaxial machine gun: what it uses on infantry it can see.
        weapon: {
            name: 'Coaxial MG',
            sound: 'mg',
            damage: 6,
            cooldown: 110,
            spread: 0.14,
            range: 430,
            bulletSpeed: 1500,
            burst: 12,
            burstGap: 1500,
            magazine: 250,
            spare: 4,
            reloadTime: 5000,
            penetration: 0,
        },
        // And the gun it uses on everything else, on its own slow timer.
        mainGun: {
            name: '90 mm',
            sound: 'mainGun',
            damage: 95,
            radius: 115,
            penetration: 70,
            cooldown: 4600,
            speed: 900,
            range: 700,
            minRange: 150,
            spread: 0.025,
        },
        suppressionPerHit: 22,
        bars: { Speed: 2, Firepower: 10, Survivability: 10, Range: 9 },
        ability: 'Armoured — flank it or bring the launcher',
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
            magazine: 2,
            spare: 20,
            reloadTime: 1900,
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
            magazine: 20,
            spare: 8,
            reloadTime: 3000,
        },
        bars: { Speed: 2, Firepower: 7, Survivability: 8, Range: 8 },
        ability: 'Slow, tough, long reach',
    },
};

// What the ground itself does. Every cell of the nav grid carries one of these,
// so where you walk costs time, makes noise, and (from the next block down)
// hides you or lets you see over things.
export const SURFACES = {
    plain: { id: 0, cost: 1, speed: 1, noise: 0 },
    mud: { id: 1, cost: 1.9, speed: 0.55, noise: 0 },
    gravel: { id: 2, cost: 1, speed: 0.95, noise: 280 },
    rubble: { id: 3, cost: 1.7, speed: 0.6, noise: 320, cover: 0.5 },
    grass: { id: 4, cost: 1.15, speed: 0.85, noise: 0, conceals: true },
    high: { id: 5, cost: 1.25, speed: 0.9, noise: 0, elevated: true },
};

// Indexed by the `id` above, so the nav grid can store one byte per cell and
// still answer "how fast, how loud, how expensive" without a lookup by name.
export const SURFACE_BY_ID = Object.values(SURFACES).sort((a, b) => a.id - b.id);

// Concealment is not cover: tall grass hides you without stopping anything.
// The rule that keeps it from being a wall is a range one — you can see into
// the edge of a field, you cannot see across it.
export const CONCEAL = { seeInto: 150 };

// Raised ground: you look over chest-high cover from up here, and a little
// further besides. It cuts both ways — everyone else can see you over it too.
export const ELEVATION = { sightBonus: 1.15 };

export const FOOTSTEPS = {
    interval: 420,          // ms between footfalls loud enough to report
    paceScale: { normal: 1, sprint: 1.45, careful: 0 },
};

// Armour is about angles, not hit points. Front plate shrugs off nearly
// everything, the sides are weaker and the back is soft, so the answer to a tank
// is to get round it — or to bring the launcher that does not care.
//
//                     penetration   vs front 60   vs side 34   vs rear 14
//   rifles, MG, buck        0            –             –            –
//   frag grenade           20            –             –            ✔
//   breaching charge       45            –             ✔            ✔
//   tank main gun          70            ✔             ✔            ✔
//   AT rocket              80            ✔             ✔            ✔
export const ARMOUR = {
    frontArc: 1.15,     // rad either side of the nose that counts as front
    rearArc: 1.15,      // and either side of the tail
};

// Throwables and door charges. Smoke is the odd one out: it stops sight without
// stopping a bullet, which is exactly what makes it worth carrying — you can
// cross open ground behind it, and so can they.
export const TOOLS = {
    frag: { radius: 96, damage: 70, speed: 470, minRange: 140, cooldown: 4200, penetration: 20 },
    smoke: {
        radius: 104,
        speed: 430,
        cooldown: 3000,
        duration: 13000,    // ms the cloud blocks sight for
        growTime: 1100,     // ms to bloom to full size
        fadeTime: 2600,     // ms of thinning out at the end
    },
    flash: {
        radius: 165,
        speed: 480,
        cooldown: 3500,
        blindTime: 3200,    // ms of blindness at the centre, less further out
    },
    charge: {
        radius: 120,
        damage: 55,
        penetration: 45,
        placeTime: 700,     // ms to set it on the door
        fuse: 1400,         // ms from set to bang
    },
};

// Orders the player gives on top of "move here". Defaults are chosen so a unit
// with an untouched order record behaves exactly as it did before orders existed.
export const ORDERS = {
    paces: ['normal', 'sprint', 'careful'],
    sprintScale: 1.45,      // fast, but no shooting on the move
    carefulScale: 0.6,      // slow, and stays set: the marksman can creep and shoot
    suppressSpread: 0.06,   // extra cone on fire aimed at ground rather than a body
    suppressSuppression: 45, // pressure each ordered round applies, whatever the weapon
    throwRange: 430,        // how far an aimed grenade can be placed
    stackOffset: 34,        // how far to one side of a door a stacked unit waits
};

export const AI = {
    reactionTime: 420,      // ms of contact before a hostile opens fire
    hearingRange: 620,      // gunfire within this radius pulls a hostile to ALERT
    searchTimeout: 6000,    // ms spent poking around a last known position
    alertTurnTime: 500,

    // A garrison, not a set of strangers: first sighting is shouted to anyone
    // close enough to hear it, and they come looking.
    shoutRange: 620,

    // Hostiles that are not the closest to the target work around the side
    // instead of queueing up in the same doorway.
    flankAfter: 1400,       // ms of contact before trying it
    flankArc: 1.15,         // rad off the target's line to aim for
    flankRadius: 320,       // preferred distance from the target
    flankInterval: 1500,    // ms between re-plans while flanking

    // Badly hurt hostiles break contact rather than trade to the death.
    retreatHp: 0.3,
    retreatDistance: 420,
    retreatTime: 4000,
};

// Winning is not the same as winning well. Missions are standalone, so the
// grade is the only reason to run one twice.
export const RATING = {
    parTime: 240000,        // ms a clean run is expected to take
    perCasualty: 18,        // every squadmate you lose
    alarmPenalty: 22,       // going loud at all
    perMinuteLate: 6,
    latePenaltyCap: 20,
    bonus: 10,              // optional objectives
    grades: [
        { min: 92, letter: 'S', note: 'Textbook' },
        { min: 80, letter: 'A', note: 'Clean' },
        { min: 65, letter: 'B', note: 'Solid' },
        { min: 48, letter: 'C', note: 'Messy' },
        { min: 0, letter: 'D', note: 'Costly' },
    ],
};

// The garrison as a whole, rather than one hostile at a time. Going loud is a
// decision with a cost: a second team walks in.
export const ALARM = {
    reinforceDelay: 9000,       // ms from the alarm going up to the wave arriving
    wave: ['hostile', 'hostileShotgun', 'hostileTank'],
    suppressedHearingScale: 0.35,   // how far a suppressed shot carries
};

// Being tucked behind a barricade makes you a harder target, on top of the
// rounds the barricade physically stops.
export const COVER = {
    radius: 52,             // how far behind a unit cover still counts
    settleTime: 350,        // ms stationary before cover is any use
    threatRange: 900,       // only enemies this close are worth hiding from
    spreadPenalty: 0.1,     // rad of extra spread on shots at a fully covered unit
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
