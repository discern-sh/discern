/* Homepage-only progressive enhancement for prompts and the project preview. */
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
        : "Copy prompt";
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

  const preview = document.querySelector("[data-project-preview]");
  const previewControls = preview?.querySelector("[data-preview-controls]");
  const previewStatus = preview?.querySelector("[data-preview-status]");
  const stageControls = preview === null
    ? []
    : [...preview.querySelectorAll("[data-preview-control]")];

  if (preview && previewControls && stageControls.length > 0) {
    previewControls.hidden = false;
    preview.setAttribute("data-preview-enhanced", "");

    for (const control of stageControls) {
      control.addEventListener("click", () => {
        const stage = control.getAttribute("data-preview-control");
        if (stage === null) return;

        preview.setAttribute("data-preview-stage", stage);
        for (const candidate of stageControls) {
          candidate.setAttribute(
            "aria-pressed",
            String(candidate === control),
          );
        }
        if (previewStatus) {
          previewStatus.textContent =
            `Showing the ${control.textContent.trim()} stage.`;
        }
      });
    }
  }
})();
