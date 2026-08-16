/* Shared theme behavior for the homepage, composition pages, and docs. */
(() => {
  "use strict";

  const root = document.documentElement;
  const media = matchMedia("(prefers-color-scheme: dark)");
  const controls = [...document.querySelectorAll("[data-theme-toggle]")];

  const storedTheme = () => {
    try {
      const value = localStorage.getItem("discern-theme");
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  };

  const systemTheme = () => media.matches ? "dark" : "light";

  const reflect = (theme) => {
    const dark = theme === "dark";
    for (const control of controls) {
      control.setAttribute(
        "aria-label",
        dark ? "Switch to the light theme" : "Switch to the dark theme",
      );
      control.removeAttribute("aria-pressed");
      const label = control.querySelector("[data-theme-label]");
      if (label) label.textContent = dark ? "Light" : "Dark";
    }
  };

  const apply = (theme) => {
    root.dataset.discernTheme = theme;
    reflect(theme);
  };

  const toggleTheme = () => {
    const next = root.dataset.discernTheme === "dark" ? "light" : "dark";
    try {
      if (next === systemTheme()) {
        localStorage.removeItem("discern-theme");
      } else {
        localStorage.setItem("discern-theme", next);
      }
    } catch {
      /* Storage is optional; the current page still changes. */
    }
    apply(next);
  };

  for (const control of controls) {
    control.addEventListener("click", toggleTheme);
  }
  media.addEventListener?.("change", () => {
    if (storedTheme() === null) apply(systemTheme());
  });
  apply(storedTheme() ?? systemTheme());
})();
