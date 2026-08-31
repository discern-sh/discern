/** Shared producer for the glossary's generated Map and Manual projections. */

import type { ManualProjection } from "../src/lib/manual.ts";
import {
  GLOSSARY,
  type GlossaryEntry,
  renderManualGlossaryDoc,
} from "./glossary_registry.ts";
import {
  type GeneratedManualMetadata,
  renderGeneratedManualDocument,
} from "./manual_codegen.ts";

/** The Map-relative source route whose links the Manual adapter rewrites. */
export const GLOSSARY_MAP_REL = "00-orientation/glossary.md";

/** The Manual-relative destination of the public glossary projection. */
export const MANUAL_GLOSSARY_REL = "30-reference/glossary.md";

/** The Manual navigation and redirect policy for the generated glossary. */
export const MANUAL_GLOSSARY_METADATA = {
  id: "reference-glossary",
  order: 120,
  redirects: ["/docs/orientation/glossary"],
} as const satisfies GeneratedManualMetadata;

/**
 * Render the exact Manual artifact codegen writes: the glossary renderer,
 * Manual wrapper, link projection, and navigation metadata stay one producer.
 */
export function renderManualGlossaryArtifact(
  manual: ManualProjection,
  glossary: readonly GlossaryEntry[] = GLOSSARY,
): string {
  return renderGeneratedManualDocument(
    renderManualGlossaryDoc(glossary),
    GLOSSARY_MAP_REL,
    MANUAL_GLOSSARY_REL,
    MANUAL_GLOSSARY_METADATA,
    manual,
  );
}
