const ASSET_LINK_RELS = new Set([
  "apple-touch-icon",
  "icon",
  "manifest",
  "mask-icon",
  "modulepreload",
  "preload",
  "stylesheet",
]);

/** Extract browser-loaded assets without mistaking ordinary navigation for code. */
export function runtimeAssetReferences(html: string): readonly string[] {
  const references = [
    ...[...html.matchAll(/\s(?:poster|src)="([^"]+)"/g)]
      .map((match) => match[1] ?? ""),
    ...[...html.matchAll(/\ssrcset="([^"]+)"/g)]
      .flatMap((match) =>
        (match[1] ?? "").split(",").map((candidate) =>
          candidate.trim().split(/\s+/, 1)[0] ?? ""
        )
      ),
    ...[...html.matchAll(/<object\b[^>]*\sdata="([^"]+)"[^>]*>/g)]
      .map((match) => match[1] ?? ""),
  ];

  for (const match of html.matchAll(/<link\b[^>]*>/g)) {
    const tag = match[0];
    const rels = (tag.match(/\srel="([^"]+)"/)?.[1] ?? "")
      .toLowerCase()
      .split(/\s+/);
    if (!rels.some((rel) => ASSET_LINK_RELS.has(rel))) continue;
    references.push(tag.match(/\shref="([^"]+)"/)?.[1] ?? "");
  }

  return references.filter((value) =>
    value.length > 0 && !value.startsWith("#") &&
    !value.startsWith("data:")
  );
}
