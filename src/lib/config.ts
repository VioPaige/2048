export type Theme = `cerberus` | `catppuccin` | `crimson` | `mint` | `nouveau` | `nosh`;
export const config = {
    themes: [
        { name: `cerberus`, icon: `🐺` },
        { name: `catppuccin`, icon: `🐈` },
        { name: `crimson`, icon: `🔴` },
        { name: `mint`, icon: `🍃` },
        { name: `nouveau`, icon: `👑` },
        { name: `nosh`, icon: `🥙` },
    ],
};

/**
 * Toggles between light and dark themes (not currently in use)
 * @param mode - which mode to switch to
 */
export const setThemeMode = (mode: `light` | `dark`) => {
    localStorage.setItem(`themeMode`, mode);
    document.documentElement.classList[mode == `light` ? `add` : `remove`](`scheme-light`);
    document.documentElement.classList[mode == `light` ? `remove` : `add`](`scheme-dark`);
};

/**
 * Sets and saves the active theme
 * @param theme - the theme to use
 */
export const setTheme = (theme: Theme) => {
    localStorage.setItem(`theme`, theme);
    document.documentElement.dataset.theme = theme;
};

/**
 * Loads the saved theme
 */
export const loadTheme = () => {
    document.documentElement.classList[localStorage.getItem(`themeMode`) == `light` ? `add` : `remove`](`scheme-light`);
    document.documentElement.classList[localStorage.getItem(`themeMode`) == `light` ? `remove` : `add`](`scheme-dark`);
    document.documentElement.dataset.theme = localStorage.getItem(`theme`) ?? `cerberus`;
}
