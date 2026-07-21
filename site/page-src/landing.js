/* Copy-to-clipboard enhancement for the otherwise-static landing page. */
(() => {
  "use strict";

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
