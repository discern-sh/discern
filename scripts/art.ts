/** Print the complete discern terminal-art family for visual review. */

import { DISCERN_ART_VARIANTS } from "../src/shared/brand_art.ts";

/** Render every registered variant in stable order with a compact name label. */
export function renderArtGallery(): string {
  return Object.entries(DISCERN_ART_VARIANTS)
    .map(([name, variant]) => `[${name}]\n${variant.render()}`)
    .join("\n\n");
}

if (import.meta.main) {
  console.log(renderArtGallery());
}
