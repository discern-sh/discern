/** Progressive interactions for the static /agents composition. */

for (const button of document.querySelectorAll("[data-copy-instruction]")) {
  if (!(button instanceof HTMLButtonElement)) continue;
  const container = button.closest(".agents-evaluate");
  const source = container?.querySelector("[data-copy-source]");
  const status = container?.querySelector("[data-copy-status]");
  const label = button.querySelector("[data-copy-label]");
  if (source === null || source === undefined) continue;

  button.addEventListener("click", async () => {
    const instruction = source.textContent?.trim() ?? "";
    try {
      await navigator.clipboard.writeText(instruction);
      if (label !== null) label.textContent = "Copied";
      if (status !== null && status !== undefined) {
        status.textContent =
          "Instruction copied. Run it in a coding-agent session rooted in the repository.";
      }
    } catch {
      if (status !== null && status !== undefined) {
        status.textContent =
          "Copy unavailable. Select the instruction and copy it directly.";
      }
    }
  });
}
