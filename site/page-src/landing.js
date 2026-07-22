/* Homepage progressive enhancement: copy controls for the install command.
 * Without JavaScript the command remains ordinary selectable text. */
(() => {
  "use strict";

  for (const host of document.querySelectorAll("[data-copy-command]")) {
    const value = host.getAttribute("data-copy-command");
    if (!value) continue;

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "discern-copy-button landing-copy";
    copy.setAttribute("aria-live", "polite");
    let resetTimer = null;

    const setCopyState = (text, label, copied) => {
      copy.textContent = text;
      copy.setAttribute("aria-label", label);
      if (copied) {
        copy.setAttribute("data-discern-copied", "");
      } else {
        copy.removeAttribute("data-discern-copied");
      }
    };
    const resetCopy = () => setCopyState("copy", "Copy the install command");
    resetCopy();

    copy.addEventListener("click", async () => {
      if (resetTimer !== null) clearTimeout(resetTimer);
      try {
        if (!navigator.clipboard) throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(value);
        setCopyState("copied", "Copied", true);
      } catch {
        setCopyState("copy failed", "Copy failed");
      }
      resetTimer = setTimeout(resetCopy, 2000);
    });

    host.append(copy);
  }
})();
