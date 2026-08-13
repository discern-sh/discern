/** Exhaustive browser renderers derived from the pure artwork registry. */

import type { ReactNode } from "react";
import { AlignmentArtwork } from "./alignment.tsx";
import { BifurcationArtwork } from "./bifurcation.tsx";
import { CircuitArtwork } from "./circuit.tsx";
import { ContourArtwork } from "./contour.tsx";
import { DeltaArtwork } from "./delta.tsx";
import { GateArtwork } from "./gate.tsx";
import { InterferenceArtwork } from "./interference.tsx";
import { InvariantCoreArtwork } from "./invariant-core.tsx";
import { IsolateArtwork } from "./isolate.tsx";
import { LedgerArtwork } from "./ledger.tsx";
import { MeshArtwork } from "./mesh.tsx";
import { PackingArtwork } from "./packing.tsx";
import { PersistentTraceArtwork } from "./persistent-trace.tsx";
import { PhaseArtwork } from "./phase.tsx";
import { PrismArtwork } from "./prism.tsx";
import { QuorumArtwork } from "./quorum.tsx";
import { RatchetArtwork } from "./ratchet.tsx";
import { RuleArtwork } from "./rule.tsx";
import { SealArtwork } from "./seal.tsx";
import { ShadowArtwork } from "./shadow.tsx";
import { SurveyArtwork } from "./survey.tsx";
import {
  BROWSER_ARTWORKS,
  type BrowserArtworkMetadata,
  type BrowserArtworkSlug,
} from "./registry.ts";

export type BrowserArtworkRenderer = (idPrefix: string) => ReactNode;

/** Rendering is exhaustive over the membership authority, without owning it. */
export const BROWSER_ARTWORK_RENDERERS: Readonly<
  Record<BrowserArtworkSlug, BrowserArtworkRenderer>
> = {
  alignment: (idPrefix) => <AlignmentArtwork id={idPrefix} />,
  bifurcation: (idPrefix) => <BifurcationArtwork idPrefix={idPrefix} />,
  contour: (idPrefix) => <ContourArtwork idPrefix={idPrefix} />,
  "persistent-trace": (idPrefix) => <PersistentTraceArtwork id={idPrefix} />,
  "invariant-core": (idPrefix) => (
    <div className="invariant-core-art__artboard">
      <InvariantCoreArtwork idPrefix={idPrefix} />
    </div>
  ),
  circuit: (idPrefix) => <CircuitArtwork id={idPrefix} />,
  seal: (idPrefix) => <SealArtwork id={idPrefix} />,
  delta: (idPrefix) => <DeltaArtwork id={idPrefix} />,
  ratchet: (idPrefix) => <RatchetArtwork id={idPrefix} />,
  rule: (idPrefix) => <RuleArtwork id={idPrefix} />,
  survey: (idPrefix) => <SurveyArtwork id={idPrefix} />,
  interference: (idPrefix) => <InterferenceArtwork id={idPrefix} />,
  mesh: (idPrefix) => <MeshArtwork id={idPrefix} />,
  phase: (idPrefix) => <PhaseArtwork id={idPrefix} />,
  prism: (idPrefix) => <PrismArtwork id={idPrefix} />,
  packing: (idPrefix) => <PackingArtwork id={idPrefix} />,
  quorum: (idPrefix) => <QuorumArtwork id={idPrefix} />,
  isolate: (idPrefix) => <IsolateArtwork id={idPrefix} />,
  ledger: (idPrefix) => <LedgerArtwork id={idPrefix} />,
  gate: (idPrefix) => <GateArtwork id={idPrefix} />,
  shadow: (idPrefix) => <ShadowArtwork id={idPrefix} />,
};

/** Render-ready projection used by the development gallery. */
export interface BrowserArtworkEntry extends BrowserArtworkMetadata {
  readonly render: BrowserArtworkRenderer;
}

export const BROWSER_ARTWORK_ENTRIES: readonly BrowserArtworkEntry[] =
  BROWSER_ARTWORKS.map((artwork) => ({
    ...artwork,
    render: BROWSER_ARTWORK_RENDERERS[artwork.slug],
  }));
