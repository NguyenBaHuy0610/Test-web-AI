(() => {
    const storageKey = "aecpt-theme";
    const themes = new Set(["light", "dark"]);

    function getSavedTheme() {
        try {
            const theme = window.localStorage.getItem(storageKey);
            return themes.has(theme) ? theme : "light";
        } catch (error) {
            console.error("Không thể đọc giao diện đã lưu:", error);
            return "light";
        }
    }

    function refreshToggleButton() {
        const button = document.querySelector("[data-theme-toggle]");
        if (!button) return;

        const isDark = document.documentElement.dataset.theme === "dark";
        button.setAttribute("aria-pressed", String(isDark));
    }

    function applyTheme(theme, save = false) {
        document.documentElement.dataset.theme = theme;
        if (save) {
            try {
                window.localStorage.setItem(storageKey, theme);
            } catch (error) {
                console.error("Không thể lưu giao diện:", error);
            }
        }
        refreshToggleButton();
    }

    applyTheme(getSavedTheme());

    document.addEventListener("click", event => {
        const button = event.target.closest("[data-theme-toggle]");
        if (!button) return;

        const nextTheme = document.documentElement.dataset.theme === "dark"
            ? "light"
            : "dark";
        applyTheme(nextTheme, true);
    });

    window.AppTheme = { refreshToggleButton };
})();
