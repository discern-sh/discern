/**
 * The per-register Vale styles as registry data: every mechanical prose
 * check the voice registry supports, declared once here and compiled into
 * one generated style directory per register (`.vale/DiscernBrand/`,
 * `.vale/DiscernProduct/`, `.vale/DiscernAgent/`) through the codegen write
 * chokepoint. `.vale.ini` scopes each style to its tier: the brand style
 * scans `_internal/brand/`, so it switches on when the brand pages promote
 * out of `_private`; the product and agent styles join the map-wide scan
 * beside the authored house style (`.vale/Discern/`), which keeps the
 * shared banned canon — these styles add only what it does not cover.
 *
 * Every rule cites its registry sources (a banned word or move, a voice
 * rule or principle, a proposed mechanical check from the copy review), and
 * `resolveValeSource` throws on any id the registry does not declare — a
 * rename can never strand a rule. The copy review's proposed checks that no
 * rule implements each carry a recorded disposition in `VALE_DISPOSITIONS`;
 * `tests/brand_vale_codegen_test.ts` holds the partition exact, so "to the
 * extent practical" stays an audited boundary.
 */

import type {
  BannedMove,
  BannedWord,
  Register,
  VoicePrinciple,
  VoiceRule,
} from "./model.ts";
import { BANNED_MOVES, BANNED_WORDS, VOICES } from "./voice.ts";
import { PROPOSED_MECHANICAL_CHECKS } from "./docs/copy_review.ts";

/** Severity policy: `error` only for a rule with no legitimate exception;
 * `warning` and `suggestion` where judgment is real. */
export type ValeSeverity = "suggestion" | "warning" | "error";

type BannedWordId = (typeof BANNED_WORDS)[number]["id"];
type BannedMoveId = (typeof BANNED_MOVES)[number]["id"];

/** A register-and-id pair naming one proposed mechanical check, typed so an
 * entry can only cite a check its register actually proposes. */
type ProposedCheckRef = {
  [R in Register]: {
    readonly kind: "proposed-check";
    readonly register: R;
    readonly check: (typeof PROPOSED_MECHANICAL_CHECKS)[R][number]["id"];
  };
}[Register];

/** Where a Vale rule's content comes from in the voice registry. */
export type ValeRuleSource =
  | { readonly kind: "banned-word"; readonly word: BannedWordId }
  | { readonly kind: "banned-move"; readonly move: BannedMoveId }
  | {
    readonly kind: "voice-rule";
    readonly register: Register;
    readonly section: string;
    readonly item: string;
  }
  | {
    readonly kind: "voice-principle";
    readonly register: Register;
    readonly principle: string;
  }
  | ProposedCheckRef;

/** The Vale extension points the renderer knows how to emit. */
export type ValeCheck =
  | {
    readonly extends: "existence";
    /** Patterns Vale wraps in word boundaries (unless `nonword`). */
    readonly tokens?: readonly string[];
    /** Self-delimiting patterns used exactly as written. */
    readonly raw?: readonly string[];
    readonly ignorecase?: true;
    readonly nonword?: true;
    readonly scope?: string;
  }
  | {
    readonly extends: "occurrence";
    readonly token: string;
    readonly max: number;
    readonly scope: string;
  };

/** One generated Vale rule: a `<StyleName>/<id>.yml` artifact. */
export interface ValeStyleRule {
  /** The rule's file and check name (PascalCase, e.g. `GenericVerbs`). */
  readonly id: string;
  readonly register: Register;
  /** The rule-file header comment: what it catches and the severity call. */
  readonly comment: string;
  readonly message: string;
  readonly level: ValeSeverity;
  readonly sources: readonly [ValeRuleSource, ...ValeRuleSource[]];
  readonly check: ValeCheck;
}

/**
 * The generated rule set, in rendering order. The authored house style
 * already blocks the shared banned canon map-wide (hype vocabulary,
 * contrast-frames, scene-setting, self-narration, and the rest), so a rule
 * appears here only when it adds enforcement the house style does not
 * carry; each comment names any sibling coverage.
 */
export const VALE_STYLE_RULES = [
  // ── brand: scans _internal/brand/ (active once the pages promote) ──
  {
    id: "ProductName",
    register: "brand",
    comment:
      "The product name is written lower-case in every position, including at the start of a sentence — recast the line rather than capitalizing it. Zero legitimate exceptions in the canon, so it blocks the gate; compound code identifiers (style and type names) keep their own word boundaries, and code spans are never linted.",
    message:
      "The product name is always lower-case 'discern': recast the sentence rather than capitalizing the name.",
    level: "error",
    sources: [
      {
        kind: "voice-rule",
        register: "agent",
        section: "language-rules",
        item: "write-the-product-name-as-discern",
      },
    ],
    check: { extends: "existence", tokens: ["Discern"] },
  },
  {
    id: "GenericVerbs",
    register: "brand",
    comment:
      "Generic transformation verbs with no concrete content. The house style already blocks 'unlock' and 'empower' map-wide at error severity; this rule adds the proposal's remaining pair. Warning severity: 'transform' can name a real operation, so the writer judges.",
    message: "'%s' is a generic verb: name the concrete change instead.",
    level: "warning",
    sources: [
      { kind: "proposed-check", register: "brand", check: "generic-verbs" },
      {
        kind: "voice-rule",
        register: "brand",
        section: "banned-moves",
        item: "unlock-empower-reimagine-and-seamless",
      },
    ],
    check: {
      extends: "existence",
      tokens: ["transform(?:s|ed|ing)?", "reimagin(?:e[sd]?|ing)"],
      ignorecase: true,
    },
  },
  {
    id: "GenericAdjectives",
    register: "brand",
    comment:
      "Adjectives that dodge 'compared to what?'. The house style already blocks 'seamless', 'robust', and 'powerful' map-wide at error severity; this rule adds the proposal's remaining forms. Warning severity: the fix is showing the mechanism, which is the writer's call.",
    message:
      "'%s' dodges 'compared to what?': show the mechanism or artifact that earned it.",
    level: "warning",
    sources: [
      {
        kind: "proposed-check",
        register: "brand",
        check: "unsupported-adjectives",
      },
      {
        kind: "voice-principle",
        register: "brand",
        principle: "make-confidence-feel-earned",
      },
    ],
    check: {
      extends: "existence",
      tokens: ["enterprise[-\\s]grade", "transformative(?:ly)?"],
      ignorecase: true,
    },
  },
  {
    id: "TemplateOpener",
    register: "brand",
    comment:
      "Model-copy opening templates. The house style already blocks 'in a world where' map-wide at error severity; this rule adds the registers' other named templates. Warning severity: the brand pages legitimately quote these templates when teaching against them.",
    message: "Model-copy template ('%s'): make the claim directly.",
    level: "warning",
    sources: [
      {
        kind: "voice-rule",
        register: "brand",
        section: "banned-moves",
        item: "this-isnt-just-openings",
      },
      {
        kind: "voice-rule",
        register: "brand",
        section: "banned-moves",
        item: "the-future-of-claims",
      },
    ],
    check: {
      extends: "existence",
      tokens: [
        "this\\s+is(?:n(?:'|’)t|\\s+not)\\s+just",
        "the\\s+future\\s+of",
      ],
      ignorecase: true,
    },
  },
  {
    id: "CtaGenericLabel",
    register: "brand",
    comment:
      "A call to action whose whole label is a generic verb tells the reader nothing about the destination. Matches the raw link syntax (raw scope: rendered text loses the markup), so only a label that IS the whole CTA fires. Warning severity: a secondary link may earn a short label.",
    message:
      "Generic CTA label ('%s'): name the destination or commitment instead.",
    level: "warning",
    sources: [
      { kind: "proposed-check", register: "brand", check: "cta-generic-label" },
    ],
    check: {
      extends: "existence",
      raw: ["\\[(?:Learn\\s+more|Explore|Discover)\\]\\("],
      ignorecase: true,
      scope: "raw",
    },
  },
  {
    id: "RepeatedContrast",
    register: "brand",
    comment:
      "The house style warns on each contrast-frame; this rule adds the proposal's page-level budget — more than one on a page is a template, whatever each instance earns. Warning severity: the budget is editorial.",
    message:
      "More than one contrast-frame on this page: keep at most one, and only where the distinction does real work.",
    level: "warning",
    sources: [
      { kind: "proposed-check", register: "brand", check: "repeated-contrast" },
      {
        kind: "voice-rule",
        register: "brand",
        section: "banned-moves",
        item: "constant-x-not-y-constructions",
      },
    ],
    check: {
      extends: "occurrence",
      token:
        "(?i)(?:not\\s+[^.?!;:—]{1,45},\\s+but|isn(?:'|’)t\\s+[^.?!;:—]{1,45}[,;]\\s+it(?:'|’)s|,\\s+(?:not|never)\\s+[^.?!;:—]{1,45}[.?!:;])",
      max: 1,
      scope: "text",
    },
  },
  {
    id: "StackedSlogans",
    register: "brand",
    comment:
      "Three consecutive slogan-length sentences read as stacked aphorisms. Suggestion severity: spec fragments listing facts are legal, so this prompts a look rather than asserting a defect.",
    message:
      "Three consecutive slogan-length sentences: let one line land and give it support.",
    level: "suggestion",
    sources: [
      {
        kind: "voice-principle",
        register: "brand",
        principle: "write-for-the-page-not-for-a-slogan-collection",
      },
    ],
    check: {
      extends: "existence",
      tokens: [
        "(?:\\b[\\w’-]+(?:\\s+[\\w’-]+){0,3}[.!?]\\s+){2}\\b[\\w’-]+(?:\\s+[\\w’-]+){0,3}[.!?]",
      ],
      nonword: true,
      scope: "paragraph",
    },
  },
  // ── product: joins the map-wide scan beside the house style ──
  {
    id: "ProductName",
    register: "product",
    comment:
      "The product name is lower-case on human-facing product surfaces. Public documentation holds this warning at zero; internal pages may quote historical or provider-facing names while the wider editorial pass remains pending. Compound code identifiers keep their own word boundaries, and code spans are never linted.",
    message:
      "The product name is lower-case 'discern': recast the sentence rather than capitalizing the name.",
    level: "warning",
    sources: [
      {
        kind: "proposed-check",
        register: "product",
        check: "canonical-glossary-terms",
      },
      {
        kind: "voice-rule",
        register: "agent",
        section: "language-rules",
        item: "write-the-product-name-as-discern",
      },
    ],
    check: { extends: "existence", tokens: ["Discern"] },
  },
  {
    id: "AgentBlame",
    register: "product",
    comment:
      "Product surfaces describe the object's state, never a worker's character: name the branch, tree, or command, not what the agent supposedly is. Warning severity: an analytical page may describe recorded behavior, so the writer judges the verdict.",
    message:
      "Agent-blame vocabulary ('%s'): describe the object's state, not the worker's character.",
    level: "warning",
    sources: [
      { kind: "proposed-check", register: "product", check: "agent-blame" },
      {
        kind: "voice-principle",
        register: "product",
        principle: "name-the-object-in-the-state",
      },
      {
        kind: "voice-rule",
        register: "product",
        section: "anti-patterns",
        item: "blames-or-praises-an-agents-character",
      },
    ],
    check: {
      extends: "existence",
      tokens: [
        "the\\s+agent\\s+(?:forgot|neglected|didn(?:'|’)t\\s+bother)",
        "(?:careless|lazy|stupid|dumb|incompetent|untrustworthy|unreliable)\\s+agents?",
        "agents?\\s+(?:is|are|was|were)\\s+(?:careless|lazy|stupid|dumb|incompetent|untrustworthy|unreliable)",
        "blames?\\s+the\\s+agent",
      ],
      ignorecase: true,
    },
  },
  // ── agent: joins the map-wide scan beside the house style ──
  {
    id: "BestJudgment",
    register: "agent",
    comment:
      "Deferring to an agent's judgment where a real boundary can be stated leaves the boundary unstated. Warning severity by the rule's own qualifier: where no boundary can be stated, the phrase is legitimate.",
    message: "'%s': state the real boundary instead, where one can be stated.",
    level: "warning",
    sources: [
      {
        kind: "voice-rule",
        register: "agent",
        section: "language-rules",
        item: "do-not-say-use-your-best-judgment",
      },
    ],
    check: {
      extends: "existence",
      tokens: ["use\\s+your\\s+(?:best\\s+|own\\s+)?judg(?:e)?ment"],
      ignorecase: true,
    },
  },
  {
    id: "PositionalReference",
    register: "agent",
    comment:
      "A positional reference breaks the moment context is compressed or reordered; a stable target (a path, heading, or anchor) survives. Warning severity: prose about a directly preceding block can occasionally earn it.",
    message:
      "Positional reference ('%s'): point at a stable target (a path, heading, or anchor) instead.",
    level: "warning",
    sources: [
      {
        kind: "voice-rule",
        register: "agent",
        section: "language-rules",
        item: "prefer-stable-targets-over-positional-references",
      },
    ],
    check: {
      extends: "existence",
      tokens: [
        "(?:as\\s+)?(?:mentioned|noted|shown|described|listed)\\s+above",
        "see\\s+above",
        "the\\s+(?:file|command|section|table|list|example|snippet|step|output)\\s+above",
      ],
      ignorecase: true,
    },
  },
] as const satisfies readonly ValeStyleRule[];

/** One recorded disposition for a proposed check no generated rule
 * implements: `deferred` names why Vale cannot hold it; `covered` names the
 * existing enforcement that already does. */
export interface ValeDisposition {
  readonly check: ProposedCheckRef;
  readonly disposition: "deferred" | "covered";
  readonly reason: string;
}

/**
 * The audited remainder of the copy review's proposed checks. Every
 * proposal is either cited by a rule in `VALE_STYLE_RULES` or listed here —
 * exactly one of the two; the guard test fails the gate on any drift. The
 * fuller analysis lives in the planning folder's Vale-deferrals note.
 */
export const VALE_DISPOSITIONS = [
  {
    check: {
      kind: "proposed-check",
      register: "brand",
      check: "hero-noun-density",
    },
    disposition: "deferred",
    reason:
      "needs page-region awareness: no scanned page declares a hero, and the site surfaces that will are outside the prose corpus.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "brand",
      check: "claim-annotation",
    },
    disposition: "deferred",
    reason:
      "needs claim-ledger awareness (which blocks bear claims, which slugs resolve) — a registry guard's job, not a token pattern's.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "brand",
      check: "serious-near-threat",
    },
    disposition: "deferred",
    reason:
      "needs proximity plus an approved-context exemption; a token list cannot separate the warned-against pairing from a page discussing it.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "brand",
      check: "headline-duplication",
    },
    disposition: "deferred",
    reason: "needs cross-page state; Vale lints one file at a time.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "brand",
      check: "audience-signature-frequency",
    },
    disposition: "deferred",
    reason:
      "needs corpus-wide frequency counts; Vale lints one file at a time.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "product",
      check: "retired-synonyms",
    },
    disposition: "deferred",
    reason:
      "owned by the glossary-and-proof migration stream: the retired-synonym scan lands with the rename's execution phase.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "product",
      check: "command-flag-references",
    },
    disposition: "covered",
    reason:
      "fenced command examples are already validated against the live verb and flag registry by the map's docs checks; inline prose detection is lexically unsound — the lower-case product name beside an ordinary verb reads identically to a command reference.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "product",
      check: "path-identifier-formatting",
    },
    disposition: "deferred",
    reason:
      "Vale exempts code spans, so this rule needs the complement — recognizing an unformatted path or identifier in plain text — which requires knowing each page's identifier universe.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "product",
      check: "refusal-next-action",
    },
    disposition: "deferred",
    reason:
      "a structural contract on result families, not prose; belongs beside the hint registry's tests.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "product",
      check: "consent-language",
    },
    disposition: "deferred",
    reason:
      "template conformance for consent moments is structural and context-dependent, not lexical.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "agent",
      check: "skill-stop-condition",
    },
    disposition: "deferred",
    reason:
      "Skills and setup briefs sit outside the Vale-scanned map, and a required-section contract is structural — a skills test's job.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "agent",
      check: "authority-field",
    },
    disposition: "deferred",
    reason:
      "authority declarations are structural fields of procedures, not phrases; a token list cannot tell presence from absence.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "agent",
      check: "relative-cross-worktree-paths",
    },
    disposition: "deferred",
    reason:
      "whether a relative path crosses a worktree boundary is path semantics no token pattern holds.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "agent",
      check: "vague-pronouns",
    },
    disposition: "deferred",
    reason:
      "referent ambiguity is semantic — a token list cannot separate a vague 'it' from a bound one; the adjacent stable-target rule is mechanical and ships as DiscernAgent.PositionalReference.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "agent",
      check: "context-length-budgets",
    },
    disposition: "covered",
    reason:
      "the skills_words and guidance standards already hold the agent-surface budgets as ratcheted numbers.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "agent",
      check: "stable-target-validation",
    },
    disposition: "covered",
    reason:
      "intra-map links and heading anchors are already validated against the shared renderer by the map's docs checks; DiscernAgent.PositionalReference adds the prose-side tell.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "agent",
      check: "relay-message-completeness",
    },
    disposition: "deferred",
    reason:
      "completeness of a relay message is semantic; no token list holds it.",
  },
] as const satisfies readonly ValeDisposition[];

/** A register's generated style name — the Vale check-name prefix and the
 * directory under `.vale/`. */
export function valeStyleName(register: Register): string {
  return `Discern${register.charAt(0).toUpperCase()}${register.slice(1)}`;
}

/** A rule file's repo-relative path. */
export function valeRuleRel(rule: ValeStyleRule): string {
  return `.vale/${valeStyleName(rule.register)}/${rule.id}.yml`;
}

/** Resolve a source reference against the live registry, or throw — the
 * same total-by-construction contract as the citation tokens. Returns the
 * short provenance label the rule file's comment carries. */
export function resolveValeSource(source: ValeRuleSource): string {
  switch (source.kind) {
    case "banned-word": {
      const word: BannedWord | undefined = BANNED_WORDS.find(
        (candidate) => candidate.id === source.word,
      );
      if (word === undefined) {
        throw new Error(`vale rule cites unknown banned word ${source.word}`);
      }
      return `banned word ${source.word}`;
    }
    case "banned-move": {
      const move: BannedMove | undefined = BANNED_MOVES.find(
        (candidate) => candidate.id === source.move,
      );
      if (move === undefined) {
        throw new Error(`vale rule cites unknown banned move ${source.move}`);
      }
      return `banned move ${source.move}`;
    }
    case "voice-rule": {
      for (const section of VOICES[source.register].sections) {
        if (section.kind !== "rules" || section.id !== source.section) continue;
        const item: VoiceRule | undefined = section.items.find(
          (candidate) => candidate.id === source.item,
        );
        if (item !== undefined) {
          return `${source.register} voice rule ${source.section}/${source.item}`;
        }
      }
      throw new Error(
        `vale rule cites unknown ${source.register} voice rule ` +
          `${source.section}/${source.item}`,
      );
    }
    case "voice-principle": {
      for (const section of VOICES[source.register].sections) {
        if (section.kind !== "principles") continue;
        const item: VoicePrinciple | undefined = section.items.find(
          (candidate) => candidate.id === source.principle,
        );
        if (item !== undefined) {
          return `${source.register} voice principle ${source.principle}`;
        }
      }
      throw new Error(
        `vale rule cites unknown ${source.register} voice principle ` +
          source.principle,
      );
    }
    case "proposed-check": {
      const checks: readonly { readonly id: string }[] =
        PROPOSED_MECHANICAL_CHECKS[source.register];
      if (!checks.some((candidate) => candidate.id === source.check)) {
        throw new Error(
          `vale rule cites unknown proposed check ` +
            `${source.register}/${source.check}`,
        );
      }
      return `proposed check ${source.register}/${source.check}`;
    }
  }
}

/** Reject a pattern the map's hard-wrapped prose would defeat: a literal
 * space never matches an instance wrapped across source lines. Returns the
 * offences instead of throwing so the guard test can probe the predicate. */
export function valePatternOffences(pattern: string): string[] {
  const offences: string[] = [];
  if (pattern.includes(" ")) {
    offences.push(
      `literal space in Vale pattern (join words with \\s+): ${pattern}`,
    );
  }
  if (pattern.trim().length === 0) {
    offences.push("empty Vale pattern");
  }
  return offences;
}

/** Every pattern a check can fire on, as written in the rule file. */
export function valeCheckPatterns(check: ValeCheck): readonly string[] {
  if (check.extends === "occurrence") return [check.token];
  return [...(check.tokens ?? []), ...(check.raw ?? [])];
}

const BANNER =
  "# GENERATED by `deno task codegen` from VALE_STYLE_RULES (scripts/brand/vale.ts) — do NOT edit by hand. Change the brand registry (scripts/brand/) and regenerate.";

/** Wrap comment prose into `# `-prefixed lines within 80 columns. */
function commentLines(text: string): string[] {
  const lines: string[] = [];
  let line = "#";
  for (const word of text.split(/\s+/)) {
    if (word.length === 0) continue;
    if (line !== "#" && line.length + 1 + word.length > 78) {
      lines.push(line);
      line = "#";
    }
    line += ` ${word}`;
  }
  if (line !== "#") lines.push(line);
  return lines;
}

/** A YAML scalar for a regex pattern. Plain wherever YAML allows it — the
 * authored house style's idiom, and the one form `deno fmt` never rewrites.
 * A pattern whose first character would start a YAML construct is quoted:
 * double quotes when its backslashes survive them, single quotes otherwise
 * (double-quoted YAML would read `\s` as an escape). */
function patternScalar(pattern: string): string {
  const first = pattern.charAt(0);
  if (!`-?:,[]{}#&*!|>'"%@\``.includes(first)) return pattern;
  if (!pattern.includes("\\") && !pattern.includes('"')) return `"${pattern}"`;
  if (!pattern.includes("'")) return `'${pattern}'`;
  throw new Error(
    `no stable YAML quoting for Vale pattern (rebuild it so it does not ` +
      `open with a YAML indicator, or drop its quotes or backslashes): ` +
      pattern,
  );
}

/** A double-quoted YAML scalar for message text. */
function messageScalar(message: string): string {
  if (message.includes('"') || message.includes("\\")) {
    throw new Error(
      `vale message must not need YAML escapes (rewrite without " or \\): ` +
        message,
    );
  }
  return `"${message}"`;
}

/** Render one rule file: banner, provenance comment, then the check body
 * in the authored style's key order. */
export function renderValeRule(rule: ValeStyleRule): string {
  for (const pattern of valeCheckPatterns(rule.check)) {
    const offences = valePatternOffences(pattern);
    if (offences.length > 0) {
      throw new Error(`${valeRuleRel(rule)}: ${offences.join("; ")}`);
    }
  }
  const provenance = rule.sources.map(resolveValeSource).join("; ");
  const lines: string[] = [
    BANNER,
    "#",
    ...commentLines(rule.comment),
    ...commentLines(`Sources: ${provenance}.`),
    `extends: ${rule.check.extends}`,
    `message: ${messageScalar(rule.message)}`,
  ];
  if (rule.check.extends === "existence") {
    if (rule.check.ignorecase === true) lines.push("ignorecase: true");
    lines.push(`level: ${rule.level}`);
    if (rule.check.nonword === true) lines.push("nonword: true");
    if (rule.check.scope !== undefined) {
      lines.push(`scope: ${rule.check.scope}`);
    }
    const tokens = rule.check.tokens ?? [];
    const raw = rule.check.raw ?? [];
    if (tokens.length + raw.length === 0) {
      throw new Error(`${valeRuleRel(rule)} declares no patterns`);
    }
    if (tokens.length > 0) {
      lines.push("tokens:");
      for (const token of tokens) lines.push(`  - ${patternScalar(token)}`);
    }
    if (raw.length > 0) {
      lines.push("raw:");
      for (const pattern of raw) lines.push(`  - ${patternScalar(pattern)}`);
    }
  } else {
    lines.push(`level: ${rule.level}`);
    lines.push(`scope: ${rule.check.scope}`);
    lines.push(`max: ${rule.check.max}`);
    lines.push(`token: ${patternScalar(rule.check.token)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Every generated style file, in registry order — the codegen loop's
 * write list and the guard test's expected set. */
export function valeStyleFiles(): readonly { rel: string; text: string }[] {
  const seen = new Set<string>();
  return VALE_STYLE_RULES.map((rule) => {
    const rel = valeRuleRel(rule);
    if (seen.has(rel)) {
      throw new Error(`duplicate Vale rule file ${rel}`);
    }
    seen.add(rel);
    return { rel, text: renderValeRule(rule) };
  });
}
