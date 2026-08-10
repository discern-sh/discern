/* Homepage-only progressive enhancement for the visible setup prompt. */
(() => {
  "use strict";

  const controls = [...document.querySelectorAll("[data-copy-prompt]")];
  const prism = document.querySelector("[data-provider-prism]");
  const prismInstruction = prism?.querySelector("[data-prism-instruction]");
  const providerControls = controls.filter((control) =>
    control.hasAttribute("data-prism-provider")
  );

  const activateProvider = (control) => {
    const id = control.getAttribute("data-prism-provider");
    const provider = control.getAttribute("data-copy-prompt-provider");
    if (!prism || id === null || provider === null) return;
    prism.setAttribute("data-prism-engaged", "");
    for (const candidate of providerControls) {
      candidate.toggleAttribute(
        "data-prism-selected",
        candidate === control,
      );
    }
    for (const beam of prism.querySelectorAll("[data-prism-beam]")) {
      beam.toggleAttribute(
        "data-prism-selected",
        beam.getAttribute("data-prism-beam") === id,
      );
    }
    const statusId = control.getAttribute("data-copy-prompt-status");
    const status = statusId === null ? null : document.getElementById(statusId);
    if (status) status.textContent = `${provider} ready`;
    if (prismInstruction) {
      prismInstruction.textContent = `Click ${provider} to copy.`;
    }
  };

  for (const control of providerControls) {
    control.addEventListener("mouseenter", () => activateProvider(control));
    control.addEventListener("focus", () => activateProvider(control));
    control.addEventListener("pointerdown", () => activateProvider(control));
  }

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
    const label = control.querySelector(
      ".discern-button__label, [data-copy-prompt-label]",
    );
    const provider = control.getAttribute("data-copy-prompt-provider");
    const statusId = control.getAttribute("data-copy-prompt-status") ??
      (targetId === null ? null : `${targetId}-status`);
    const status = statusId === null ? null : document.getElementById(statusId);
    if (!target || !label) continue;

    const idleLabel = label.textContent;
    let resetTimer = null;
    const reflect = (copied) => {
      const copiedLabel = provider === null
        ? "Prompt copied"
        : `${provider} prompt copied`;
      label.textContent = copied ? copiedLabel : idleLabel;
      control.toggleAttribute("data-prompt-copied", copied);
      if (status) {
        status.textContent = copied
          ? copiedLabel
          : provider === null
          ? ""
          : `${provider} ready`;
      }
      if (prismInstruction && provider !== null) {
        prismInstruction.textContent = copied
          ? "Prompt copied. Paste it into the agent."
          : `Click ${provider} to copy.`;
      }
    };
    const reset = () => reflect(false);

    if (control.hasAttribute("data-copy-prompt-progressive")) {
      control.hidden = false;
    }
    control.addEventListener("click", async () => {
      if (control.hasAttribute("data-prism-provider")) {
        activateProvider(control);
      }
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
