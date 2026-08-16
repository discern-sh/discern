/**
 * Field semantics for the five prose registries: what the pen may do at each
 * declared field. Every map compiles `satisfies Record<keyof X, FieldSpec>`
 * against its registry interface, so adding a field to a registry breaks the
 * studio's typecheck until the editor says how to treat it — the enrolment
 * forcing function that keeps the editor current by compiler error instead of
 * by noticing rot.
 *
 * These are semantics only. Whether a specific value literal is actually
 * patchable is the syntax view's call (an interpolated template stays locked
 * however the field is classified here), and a save must satisfy both.
 */

import type {
  BenefitCluster,
  BenefitEntry,
  FeatureNode,
  PlainAccount,
} from "../feature_registry.ts";
import type { PracticeTenet, TenetUpheld } from "../practice_registry.ts";
import type {
  GlossaryEntry,
  GlossaryPlainRendering,
  RetiredException,
  RetiredSynonym,
} from "../glossary_registry.ts";
import type { Claim } from "../brand/model.ts";
import type { RegistryName } from "./registry_ast.ts";

/** The live set a list field's picker draws from. */
export type PickerSource =
  | "feature-node"
  | "benefit-cluster"
  | "claim"
  | "hint"
  | "surface"
  | "carrier"
  | "inventory"
  | "evidence-class"
  | "audience"
  | "free";

/** The register a prose field is judged in, for the as-you-type lint. */
export type ProseFieldRegister = "technical" | "plain" | "public" | "brand";

/** What the editor may do with one declared field. */
export type FieldSpec =
  /** In-place editable prose, judged in the named register. */
  | { readonly edit: "prose"; readonly register: ProseFieldRegister }
  /** A typed list over a live set — picker territory, not freehand prose. */
  | { readonly edit: "list"; readonly picker: PickerSource }
  /** An object whose own fields carry the semantics — resolve one deeper. */
  | { readonly edit: "nested" }
  /** Child entries — entries of their own, never fields. */
  | { readonly edit: "structural" }
  /** Untouchable in place, with the reason the editor shows. */
  | { readonly edit: "locked"; readonly reason: string };

const IDENTITY_LOCK = {
  edit: "locked",
  reason:
    "identity — renames ripple through citations; a campaign, not a keystroke",
} as const;

/** The feature node's fields (both canon registers live on one node). */
export const FEATURE_NODE_FIELDS = {
  id: IDENTITY_LOCK,
  title: { edit: "prose", register: "technical" },
  kind: { edit: "locked", reason: "a structural marker, not prose" },
  what: { edit: "prose", register: "technical" },
  why: { edit: "prose", register: "technical" },
  agent: { edit: "prose", register: "technical" },
  hints: { edit: "list", picker: "hint" },
  plain: { edit: "nested" },
  surfaces: { edit: "list", picker: "surface" },
  children: { edit: "structural" },
} as const satisfies Record<keyof FeatureNode, FieldSpec>;

/** The plain twin's fields — the plain register's own account. */
export const PLAIN_ACCOUNT_FIELDS = {
  title: { edit: "prose", register: "plain" },
  what: { edit: "prose", register: "plain" },
  why: { edit: "prose", register: "plain" },
  agent: { edit: "prose", register: "plain" },
} as const satisfies Record<keyof PlainAccount, FieldSpec>;

/** A benefit cluster's fields. */
export const BENEFIT_CLUSTER_FIELDS = {
  id: IDENTITY_LOCK,
  title: { edit: "prose", register: "technical" },
  role: { edit: "locked", reason: "the commercial vocabulary is a closed set" },
  primaryFor: { edit: "list", picker: "audience" },
  promise: { edit: "prose", register: "technical" },
  commercialValue: { edit: "prose", register: "technical" },
  benefits: { edit: "structural" },
} as const satisfies Record<keyof BenefitCluster, FieldSpec>;

/** A benefit entry's fields. */
export const BENEFIT_ENTRY_FIELDS = {
  id: IDENTITY_LOCK,
  title: { edit: "prose", register: "technical" },
  value: { edit: "prose", register: "technical" },
  whyItFollows: { edit: "prose", register: "technical" },
  drawsOn: { edit: "list", picker: "feature-node" },
  claims: { edit: "list", picker: "claim" },
} as const satisfies Record<keyof BenefitEntry, FieldSpec>;

/** A practice tenet's fields. */
export const PRACTICE_TENET_FIELDS = {
  id: IDENTITY_LOCK,
  title: { edit: "prose", register: "public" },
  obligation: { edit: "prose", register: "public" },
  body: { edit: "prose", register: "public" },
  arc: { edit: "locked", reason: "the rendering lenses are a closed set" },
  upheld: { edit: "nested" },
  mechanisms: { edit: "list", picker: "feature-node" },
  yields: { edit: "list", picker: "benefit-cluster" },
  holds: { edit: "list", picker: "inventory" },
} as const satisfies Record<keyof PracticeTenet, FieldSpec>;

/** The tenet's upheld tiers — each a carrier list. */
export const TENET_UPHELD_FIELDS = {
  enforced: { edit: "list", picker: "carrier" },
  automated: { edit: "list", picker: "carrier" },
  taught: { edit: "list", picker: "carrier" },
} as const satisfies Record<keyof TenetUpheld, FieldSpec>;

/** A glossary term's fields. */
export const GLOSSARY_ENTRY_FIELDS = {
  term: IDENTITY_LOCK,
  summary: { edit: "prose", register: "public" },
  matches: { edit: "list", picker: "free" },
  plain: { edit: "nested" },
  definition: { edit: "prose", register: "public" },
  retired: { edit: "nested" },
} as const satisfies Record<keyof GlossaryEntry, FieldSpec>;

/** The translated variant of a term's plain rendering. */
export const GLOSSARY_PLAIN_PHRASE_FIELDS = {
  phrase: { edit: "prose", register: "plain" },
  match: {
    edit: "locked",
    reason: "a matcher override — edit beside the pattern it tunes",
  },
} as const satisfies Record<
  keyof Extract<GlossaryPlainRendering, { phrase: string }>,
  FieldSpec
>;

/** The kept-as-is variant of a term's plain rendering. */
export const GLOSSARY_PLAIN_KEEP_FIELDS = {
  keep: { edit: "prose", register: "plain" },
} as const satisfies Record<
  keyof Extract<GlossaryPlainRendering, { keep: string }>,
  FieldSpec
>;

/** A retired synonym's fields. */
export const RETIRED_SYNONYM_FIELDS = {
  phrase: {
    edit: "locked",
    reason: "the drift guard's subject — retiring wording is structural",
  },
  pattern: {
    edit: "locked",
    reason: "a regex source; the guard proves it against its own phrase",
  },
  allowed: { edit: "nested" },
} as const satisfies Record<keyof RetiredSynonym, FieldSpec>;

/** A retired-synonym exception's fields. */
export const RETIRED_EXCEPTION_FIELDS = {
  path: { edit: "locked", reason: "must name a real path — the guard checks" },
  reason: { edit: "prose", register: "technical" },
} as const satisfies Record<keyof RetiredException, FieldSpec>;

/** A public claim's fields. */
export const CLAIM_FIELDS = {
  title: { edit: "prose", register: "brand" },
  evidence: { edit: "list", picker: "evidence-class" },
  strongestPublicForm: { edit: "prose", register: "brand" },
  mechanism: { edit: "prose", register: "brand" },
  conditions: { edit: "prose", register: "brand" },
  forbiddenInference: { edit: "prose", register: "brand" },
  evidenceNote: { edit: "prose", register: "brand" },
  tacticalUse: { edit: "prose", register: "brand" },
  wordingCorrection: { edit: "prose", register: "brand" },
  primarySource: { edit: "prose", register: "brand" },
} as const satisfies Record<keyof Claim, FieldSpec>;

/** The technical fields whose plain twins ride the same node. */
export const PLAIN_TWIN: Readonly<Record<string, string>> = {
  title: "plain.title",
  what: "plain.what",
  why: "plain.why",
  agent: "plain.agent",
};

type FieldMap = Readonly<Record<string, FieldSpec>>;

/** The merged plain-rendering map (the union's variants share no keys). */
const GLOSSARY_PLAIN_FIELDS: FieldMap = {
  ...GLOSSARY_PLAIN_PHRASE_FIELDS,
  ...GLOSSARY_PLAIN_KEEP_FIELDS,
};

/** Step one map deeper for a nested field, skipping array indices. */
function nestedMap(
  registry: RegistryName,
  head: string,
): FieldMap | undefined {
  if (registry === "feature" && head === "plain") return PLAIN_ACCOUNT_FIELDS;
  if (registry === "practice" && head === "upheld") return TENET_UPHELD_FIELDS;
  if (registry === "glossary" && head === "plain") return GLOSSARY_PLAIN_FIELDS;
  if (registry === "glossary" && head === "retired") {
    return RETIRED_SYNONYM_FIELDS;
  }
  return undefined;
}

/** The top-level map for one entry kind. */
function topMap(registry: RegistryName, kind: string): FieldMap | undefined {
  if (registry === "feature") return FEATURE_NODE_FIELDS;
  if (registry === "benefit") {
    return kind === "cluster" ? BENEFIT_CLUSTER_FIELDS : BENEFIT_ENTRY_FIELDS;
  }
  if (registry === "practice") return PRACTICE_TENET_FIELDS;
  if (registry === "glossary") return GLOSSARY_ENTRY_FIELDS;
  if (registry === "claims") return CLAIM_FIELDS;
  return undefined;
}

/**
 * Resolve a dotted field path to its semantics. Numeric segments step through
 * array elements; a `nested` spec resolves one map deeper. Undefined means
 * the studio has no semantics for the path — the guard treats that as a
 * defect, not a shrug.
 */
export function fieldSpecFor(
  registry: RegistryName,
  kind: string,
  path: string,
): FieldSpec | undefined {
  const segments = path.split(".").filter((segment) => !/^\d+$/.test(segment));
  let map = topMap(registry, kind);
  let spec: FieldSpec | undefined;
  for (const [index, segment] of segments.entries()) {
    if (map === undefined) return undefined;
    spec = map[segment];
    if (spec === undefined) return undefined;
    if (index < segments.length - 1) {
      if (spec.edit !== "nested") return undefined;
      map = segment === "allowed"
        ? RETIRED_EXCEPTION_FIELDS
        : nestedMap(registry, segment);
    }
  }
  return spec;
}
