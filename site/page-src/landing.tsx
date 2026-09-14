/** Homepage route adapter: metadata, composition selection, and asset boundary. */

import { renderToStaticMarkup } from "react-dom/server";
import { LANDING_DESCRIPTION, LANDING_TITLE } from "../brand.ts";
import { pageDocument } from "./document.ts";
import { ClarityFirst } from "./clarity-first.tsx";

/** Render the selected homepage composition for static serving. */
export function renderLanding(): string {
  return pageDocument({
    source: "landing.tsx",
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    styles: ["fonts.css", "discern.css", "campaign.css", "clarity-first.css"],
    scripts: ["discern.js", "copy-prompt.js", "clarity-first.js"],
    body: renderToStaticMarkup(<ClarityFirst />),
  });
}
