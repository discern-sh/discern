/* Progressive enhancement for the otherwise-static design-system demo. */
(() => {
  "use strict";

  const root = document.documentElement;
  const themeButton = document.querySelector("[data-theme-toggle]");
  const themeLabel = document.querySelector("[data-theme-label]");

  const reflectTheme = () => {
    const dark = root.dataset.dsTheme === "dark";
    if (themeLabel) themeLabel.textContent = dark ? "Light" : "Dark";
    if (themeButton) themeButton.setAttribute("aria-pressed", String(dark));
  };

  if (themeButton) {
    themeButton.addEventListener("click", () => {
      const dark = root.dataset.dsTheme !== "dark";
      root.dataset.dsTheme = dark ? "dark" : "light";
      try {
        localStorage.setItem("discern-theme", dark ? "dark" : "light");
      } catch {
        /* Storage is optional. */
      }
      reflectTheme();
    });
  }
  reflectTheme();

  for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
      const value = button.getAttribute("data-copy");
      if (!value) return;
      try {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(value);
        } else {
          const field = document.createElement("textarea");
          field.value = value;
          field.setAttribute("readonly", "");
          field.style.position = "fixed";
          field.style.opacity = "0";
          document.body.appendChild(field);
          field.select();
          const copied = document.execCommand("copy");
          field.remove();
          if (!copied) return;
        }
        const previous = button.textContent;
        button.textContent = "copied ✓";
        setTimeout(() => {
          button.textContent = previous;
        }, 1400);
      } catch {
        /* Copy permission is optional; keep the command visible. */
      }
    });
  }
})();
