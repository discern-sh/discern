/* Page-owned enhancement for the clarity-first campaign composition. */

(() => {
  "use strict";

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
