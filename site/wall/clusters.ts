/** Cluster presentation shared by every wall surface that takes a cluster's color. */
import type { CSSProperties } from "react";
import type { ClusterId } from "./types.ts";

/**
 * One OKLCH hue per cluster, in cluster order. Lightness and chroma are the
 * same for every cluster and belong to the stylesheets.
 */
const CLUSTER_HUES: Readonly<Record<ClusterId, number>> = {
  "build-further": 255,
  "return-human-attention": 210,
  "know-what-is-ready": 165,
  "make-improvement-accumulate": 120,
  "keep-project-knowledge-working": 75,
  "put-practice-in-place": 30,
  "change-tools-without-starting-over": 345,
  "keep-control": 300,
};

/**
 * The inline style that hands one cluster's hue to the stylesheets as
 * `--wall-hue`, a bare OKLCH hue angle. A card root and an opened card carry it.
 */
export function clusterHueStyle(
  cluster: ClusterId,
): CSSProperties & Record<"--wall-hue", number> {
  return { "--wall-hue": CLUSTER_HUES[cluster] };
}
