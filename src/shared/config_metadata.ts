/**
 * Metadata discern writes into `[meta]` rather than asking the project owner to
 * author. This is the canonical ownership classification used by the schema,
 * generated JSON Schema, template, and config reference.
 */
export const DISCERN_WRITTEN_META = {
  managed_version: { template: "omit" },
  schema_version: { template: "render" },
  bootstrapped: { template: "omit" },
  setup_completion: { template: "omit" },
  setup_model: { template: "omit" },
  setup_version: { template: "omit" },
} as const satisfies Readonly<
  Record<string, { readonly template: "render" | "omit" }>
>;

export type DiscernWrittenMetaKey = keyof typeof DISCERN_WRITTEN_META;

/** Every discern-written metadata key, in its public schema order. */
export const DISCERN_WRITTEN_META_KEYS = Object.keys(
  DISCERN_WRITTEN_META,
) as DiscernWrittenMetaKey[];

/** Discern-written metadata that an owner-facing scaffold must not invite edits to. */
export const TEMPLATE_OMITTED_META_KEYS = DISCERN_WRITTEN_META_KEYS.filter(
  (key) => DISCERN_WRITTEN_META[key].template === "omit",
);
