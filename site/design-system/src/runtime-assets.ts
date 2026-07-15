export const runtimeAssetSelections = ["fonts", "grain"] as const;
export type RuntimeAssetSelection = (typeof runtimeAssetSelections)[number];

export interface EmbeddedRuntimeAsset {
  readonly selection: RuntimeAssetSelection;
  readonly path: string;
  readonly mediaType: string;
  readonly encoding: "base64" | "utf8";
  readonly contents: string;
}
