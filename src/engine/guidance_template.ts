/**
 * A tiny, strict, dependency-free template engine for discern's BUILT-IN guidance
 * sections (`templates/guidance/*.md`). The guidance compiler renders each section
 * against a context before concatenating them (see `guidance_render.ts`), so the
 * generic shipped prose can name a project's real branch prefix / integration
 * branch and drop sections that are inert until configured.
 *
 * ## Syntax — deliberately minimal (no library, no expressions, no loops)
 *
 *   - `{{var}}`                        — substitute a string variable.
 *   - `{{#if pred}}…{{/if}}`            — include the body only when `pred` is true.
 *   - `{{#if pred}}…{{else}}…{{/if}}`   — include one branch or the other.
 *
 * Variables work inside `{{#if}}` blocks, and `{{#if}}` may nest (the recursive
 * parser handles it). Tag names are lowercase snake_case (`[a-z][a-z0-9_]*`);
 * surrounding whitespace inside the braces is ignored (`{{ var }}` == `{{var}}`).
 *
 * ## Strictness — a typo fails the compile, it never ships blank
 *
 * The context is a CLOSED, curated set. An unknown `{{var}}` or `{{#if pred}}` name
 * — anywhere in the template, including a branch that won't be taken — throws
 * {@link GuidanceTemplateError}, as does a malformed or unbalanced tag. A mistake
 * in a built-in template therefore fails loudly at refresh / currency-check time
 * instead of silently emitting an empty string.
 *
 * ## Boundary — discern's own shipped surfaces ONLY
 *
 * This renders discern's OWN guidance sections, plus bundled-skill markdown at
 * materialization (`src/lib/skills.ts` — ADR 0102), both against the one
 * context `guidanceContext` builds. The user's `[guidance].sources` are
 * appended verbatim by the compiler, and authored skills are symlinked
 * untouched — a user's markdown may legitimately contain `{{…}}` and is NEVER
 * passed through here.
 *
 * ## Not the scaffold templater (`src/lib/template.ts`)
 *
 * That module substitutes `{{token}}` in the `.tmpl` SCAFFOLD surface at `setup`
 * time, over a different token set, leaving an unknown token VERBATIM (drift is
 * reported, not fatal). This one runs at guidance-compile time, is strict, and adds
 * conditionals. They never process the same files — the scaffold skips
 * `templates/guidance/` (`fs_plan.ts`) — so the shared `{{}}` delimiter never
 * collides.
 */

/**
 * The closed context a built-in guidance section renders against. Both maps must be
 * a pure function of committed config (built by `guidanceContext` in
 * `guidance_render.ts`); that purity is what keeps the generated files' currency
 * check deterministic (ADR 0034).
 */
export interface GuidanceContext {
  /** `{{var}}` string substitutions. */
  readonly vars: Readonly<Record<string, string>>;
  /** `{{#if pred}}` booleans. */
  readonly preds: Readonly<Record<string, boolean>>;
}

/** A malformed template, an unbalanced block, or an unknown variable/predicate
 * name. Thrown so a built-in-template mistake fails the compile loudly rather than
 * shipping blank guidance. */
export class GuidanceTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuidanceTemplateError";
  }
}

/** A valid tag name: lowercase, snake_case, leading letter. */
const NAME_RE = /^[a-z][a-z0-9_]*$/;

/** Match a `{{ … }}` tag; group 1 is the inner text with surrounding ws trimmed. */
const TAG_RE = /\{\{\s*(.*?)\s*\}\}/gs;

type Token =
  | { kind: "text"; value: string }
  | { kind: "var"; name: string }
  | { kind: "if"; name: string }
  | { kind: "else" }
  | { kind: "endif" };

/** Classify the trimmed inner text of one `{{ … }}` tag, rejecting anything that
 * is not a recognized form. */
function classifyTag(inner: string): Token {
  if (inner === "else") return { kind: "else" };
  if (inner === "/if") return { kind: "endif" };
  if (inner.startsWith("#")) {
    const name = inner.match(/^#if\s+([a-z][a-z0-9_]*)$/)?.[1];
    if (name === undefined) {
      throw new GuidanceTemplateError(
        `malformed block tag {{${inner}}} — expected {{#if <name>}}`,
      );
    }
    return { kind: "if", name };
  }
  if (!NAME_RE.test(inner)) {
    throw new GuidanceTemplateError(
      `malformed template tag {{${inner}}} — expected {{var}}, {{#if x}}, {{else}}, or {{/if}}`,
    );
  }
  return { kind: "var", name: inner };
}

/** Split a template into a flat token stream: literal text interleaved with tags.
 * A `{{` with no closing `}}` simply never matches and stays literal text. */
function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of src.matchAll(TAG_RE)) {
    const index = m.index;
    if (index > last) {
      tokens.push({ kind: "text", value: src.slice(last, index) });
    }
    // Group 1 always matches (it is `(.*?)`); `?? ""` only satisfies the indexer's
    // type — an empty inner (`{{}}`) is then correctly rejected as malformed.
    tokens.push(classifyTag(m[1] ?? ""));
    last = index + m[0].length;
  }
  if (last < src.length) tokens.push({ kind: "text", value: src.slice(last) });
  return tokens;
}

type Node =
  | { kind: "text"; value: string }
  | { kind: "var"; name: string }
  | { kind: "if"; name: string; then: Node[]; otherwise: Node[] };

/** Recursive-descent parse of the token stream into a node tree. Nesting falls out
 * for free (an `{{#if}}` body is parsed by the same routine). Throws on any
 * unbalanced or stray block tag. */
function parse(tokens: readonly Token[]): Node[] {
  let pos = 0;

  /** Consume nodes until a block boundary (`{{else}}`/`{{/if}}`), which is left
   * unconsumed for the caller to inspect. */
  function parseNodes(): { nodes: Node[]; stop: Token | undefined } {
    const nodes: Node[] = [];
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t === undefined) break; // bounded by length — satisfies the indexer's type
      if (t.kind === "else" || t.kind === "endif") return { nodes, stop: t };
      pos++;
      nodes.push(t.kind === "if" ? parseIf(t.name) : t);
    }
    return { nodes, stop: undefined };
  }

  function parseIf(name: string): Node {
    const thenPart = parseNodes();
    if (thenPart.stop === undefined) {
      throw new GuidanceTemplateError(
        `unclosed {{#if ${name}}} — missing {{/if}}`,
      );
    }
    let otherwise: Node[] = [];
    if (thenPart.stop.kind === "else") {
      pos++; // consume {{else}}
      const elsePart = parseNodes();
      if (elsePart.stop?.kind !== "endif") {
        throw new GuidanceTemplateError(
          `unclosed {{#if ${name}}} — missing {{/if}} after {{else}}`,
        );
      }
      otherwise = elsePart.nodes;
    }
    pos++; // consume {{/if}}
    return { kind: "if", name, then: thenPart.nodes, otherwise };
  }

  const top = parseNodes();
  if (top.stop !== undefined) {
    const tag = top.stop.kind === "endif" ? "/if" : "else";
    throw new GuidanceTemplateError(
      `stray {{${tag}}} with no matching {{#if}}`,
    );
  }
  return top.nodes;
}

/** Walk the whole tree — both branches of every `{{#if}}`, reachable or not — and
 * reject any name absent from the context. This is what makes a typo in a dead
 * branch fail the compile rather than lurk until some project's config takes it. */
function validateNames(nodes: readonly Node[], ctx: GuidanceContext): void {
  for (const n of nodes) {
    if (n.kind === "var") {
      if (!Object.hasOwn(ctx.vars, n.name)) {
        throw new GuidanceTemplateError(
          `unknown template variable {{${n.name}}}`,
        );
      }
    } else if (n.kind === "if") {
      if (!Object.hasOwn(ctx.preds, n.name)) {
        throw new GuidanceTemplateError(
          `unknown template predicate {{#if ${n.name}}}`,
        );
      }
      validateNames(n.then, ctx);
      validateNames(n.otherwise, ctx);
    }
  }
}

/** Emit the validated tree against the context. */
function renderNodes(nodes: readonly Node[], ctx: GuidanceContext): string {
  let out = "";
  for (const n of nodes) {
    if (n.kind === "text") out += n.value;
    else if (n.kind === "var") out += ctx.vars[n.name];
    else out += renderNodes(ctx.preds[n.name] ? n.then : n.otherwise, ctx);
  }
  return out;
}

/**
 * Render one built-in guidance section against `ctx`. Pure: same `(template, ctx)`
 * always yields the same string. Throws {@link GuidanceTemplateError} on a
 * malformed/unbalanced tag or an unknown variable/predicate name (validated across
 * the entire tree, before any output is produced).
 */
export function renderGuidanceTemplate(
  template: string,
  ctx: GuidanceContext,
): string {
  const ast = parse(tokenize(template));
  validateNames(ast, ctx);
  return renderNodes(ast, ctx);
}
