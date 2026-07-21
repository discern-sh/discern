/** Shared paths and pre-paint bootstrap for every design-system page. */

export const THEME_STYLESHEET_PATH = "/assets/theme.css";
export const THEME_SCRIPT_PATH = "/assets/theme.js";

/** Resolve the stored override or system preference before the first paint. */
export const THEME_BOOTSTRAP =
  `(function(){var t=null;try{t=localStorage.getItem("discern-theme")}catch(_){}var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.discernTheme=d?"dark":"light"})();`;
