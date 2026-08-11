/* Homepage-only progressive enhancement for the visible setup prompt. */
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
    if (!target || !label) continue;

    let resetTimer = null;
    const reflect = (copied) => {
      label.textContent = copied
        ? "Copied! Now paste it to your agent."
        : "Copy setup prompt";
      control.toggleAttribute("data-prompt-copied", copied);
      if (status) {
        status.textContent = copied
          ? "Copied! Now paste it to your agent."
          : "";
      }
    };
    const reset = () => reflect(false);

    control.hidden = false;
    control.addEventListener("click", async () => {
      if (resetTimer !== null) clearTimeout(resetTimer);
      const prompt = target.textContent.trim();
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("clipboard unavailable");
        }
        await Promise.race([
          navigator.clipboard.writeText(prompt),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("clipboard timed out")), 1000);
          }),
        ]);
        reflect(true);
        resetTimer = setTimeout(reset, 2000);
      } catch {
        selectText(target);
        reset();
      }
    });
  }
})();
