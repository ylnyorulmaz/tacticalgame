// Player settings that outlive a mission. One object, one storage key, and a
// safe default when localStorage is unavailable — a browser with storage blocked
// must still boot the game.

const KEY = 'cqb.settings';

const DEFAULTS = {
    // Magazines, reloads and a finite pouch. Off means weapons never run dry,
    // which is how the game played before the switch existed.
    ammo: true,
};

export const settings = { ...DEFAULTS };

function storage() {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;   // Safari in private mode throws on access, not on use.
    }
}

export function loadSettings() {
    const store = storage();
    if (!store) return settings;
    try {
        const saved = JSON.parse(store.getItem(KEY) || '{}');
        for (const key of Object.keys(DEFAULTS)) {
            if (typeof saved[key] === typeof DEFAULTS[key]) settings[key] = saved[key];
        }
    } catch {
        // Corrupt or foreign data: keep the defaults rather than failing to boot.
    }
    return settings;
}

export function setSetting(key, value) {
    if (!(key in DEFAULTS)) return settings;
    settings[key] = value;
    const store = storage();
    if (store) {
        try {
            store.setItem(KEY, JSON.stringify(settings));
        } catch {
            // Full or blocked storage just means the choice is not remembered.
        }
    }
    return settings;
}

export function toggleSetting(key) {
    return setSetting(key, !settings[key]);
}
