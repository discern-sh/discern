/* Route-neutral progressive enhancement for public Copy prompt controls. */
import { SYSTEM_SCHEDULER, withTimeout } from "/assets/scheduler.js";

(() => {
  "use strict";

  const controls = [...document.querySelectorAll("[data-copy-prompt]")];

  const selectText = (target) => {
    const selection = window.getSelection?.();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  for (const control of controls) {
    const targetId = control.getAttribute("data-copy-prompt-target");
    const target = targetId === null ? null : document.getElementById(targetId);
    const label = control.querySelector(".discern-button__label");
    const status = targetId === null
      ? null
      : document.getElementById(`${targetId}-status`);
    const idleLabel = control.getAttribute("data-copy-label") ?? "Copy prompt";
    const copiedLabel = control.getAttribute("data-copied-label") ??
      "Prompt copied";
    if (!target || !label) continue;

    let resetTimer = null;
    const reflect = (copied) => {
      label.textContent = copied ? copiedLabel : idleLabel;
      control.toggleAttribute("data-prompt-copied", copied);
      if (status) {
        status.textContent = copied
          ? "Paste this into a coding-agent session rooted in your project."
          : "";
      }
    };
    const reset = () => reflect(false);

    control.hidden = false;
    control.addEventListener("click", async () => {
      if (resetTimer !== null) SYSTEM_SCHEDULER.cancelTimeout(resetTimer);
      const prompt = target.textContent.trim();
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("clipboard unavailable");
        }
        await withTimeout(
          navigator.clipboard.writeText(prompt),
          1000,
          "clipboard timed out",
        );
        reflect(true);
        resetTimer = SYSTEM_SCHEDULER.scheduleTimeout(reset, 2000);
      } catch {
        selectText(target);
        reset();
      }
    });
  }
})();
