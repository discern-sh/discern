/* Progressive enhancement for the otherwise-static landing page: theme
   toggle, copy-to-clipboard, and the staged playback of the catch. */
(() => {
  "use strict";

  const root = document.documentElement;
  const themeButton = document.querySelector("[data-theme-toggle]");
  const themeLabel = document.querySelector("[data-theme-label]");

  const reflectTheme = () => {
    const dark = root.dataset.discernTheme === "dark";
    if (themeLabel) themeLabel.textContent = dark ? "Light" : "Dark";
    if (themeButton) themeButton.setAttribute("aria-pressed", String(dark));
  };

  if (themeButton) {
    themeButton.addEventListener("click", () => {
      const dark = root.dataset.discernTheme !== "dark";
      root.dataset.discernTheme = dark ? "dark" : "light";
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

  /* The catch plays its four frames in sequence the first time it scrolls
     into view. The playing class only adds a backwards-filled keyframe, so
     reduced motion, a missing IntersectionObserver, or an environment that
     never runs animations all leave the complete static sequence visible. */
  const stage = document.querySelector("[data-catch-stage]");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (stage && !still && "IntersectionObserver" in window) {
    let settle = 0;
    const play = () => {
      stage.classList.remove("is-playing");
      void stage.getBoundingClientRect();
      stage.classList.add("is-playing");
      clearTimeout(settle);
      settle = setTimeout(() => stage.classList.remove("is-playing"), 5000);
    };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      play();
    }, { threshold: 0.18 });
    observer.observe(stage);

    const replay = stage.querySelector("[data-catch-replay]");
    if (replay) {
      replay.hidden = false;
      replay.addEventListener("click", play);
    }
  }
})();
