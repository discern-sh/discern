/**
 * Rasterise social cards on request. The first card a process draws loads
 * the rasteriser and the design system's fonts; each route's image is then
 * kept for the life of the process, because its page cannot change without a
 * new deployment.
 */

import { createRequire } from "module";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { DESIGN_SYSTEM_BUNDLES } from "../design_system.ts";
import { drawSocialCard } from "./draw.ts";
import type { SocialCard } from "./model.ts";
import { Typesetter } from "./typeset.ts";

/** The built composition bundle, whose font selection the site itself serves. */
const FONT_BUNDLE = new URL(
  `../${DESIGN_SYSTEM_BUNDLES.compositions.output}`,
  import.meta.url,
);

let engine: Promise<Typesetter> | undefined;
const images = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

/** Load the rasteriser once, then open the faces from the built bundle. */
async function startEngine(): Promise<Typesetter> {
  const wasm = createRequire(import.meta.url).resolve(
    "@resvg/resvg-wasm/index_bg.wasm",
  );
  await initWasm(await Deno.readFile(wasm));
  return await Typesetter.open((file) =>
    Deno.readFile(new URL(file, FONT_BUNDLE))
  );
}

/** The typesetter every card shares, started on first use. */
export function socialCardTypesetter(): Promise<Typesetter> {
  engine ??= startEngine();
  return engine;
}

/** Draw and rasterise one card. */
async function rasterise(
  card: SocialCard,
): Promise<Uint8Array<ArrayBuffer>> {
  const svg = drawSocialCard(card, await socialCardTypesetter());
  return new Uint8Array(new Resvg(svg).render().asPng());
}

/** One card as PNG bytes, drawn once per route for the process. */
export function socialCardPng(
  card: SocialCard,
): Promise<Uint8Array<ArrayBuffer>> {
  let image = images.get(card.route);
  if (image === undefined) {
    image = rasterise(card);
    images.set(card.route, image);
  }
  return image;
}
