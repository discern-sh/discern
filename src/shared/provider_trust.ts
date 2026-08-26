/** Structured provider trust guidance and its presentation projections. */

import { markdownCodeSpan } from "./markdown_code.ts";

/** The closed vocabulary for literal trust facts. */
export const TRUST_FACT_KINDS = [
  "path",
  "config-key",
  "config-value",
  "flag",
  "environment-variable",
] as const;

/** The closed action vocabulary for provider trust recovery. */
export const TRUST_ACTION_KINDS = [
  "verify-configuration",
  "trust-directory",
  "approve-hook",
  "enable-hooks",
  "approve-tools",
] as const;

/** One literal machine fact used by a provider trust action. */
export interface ProviderTrustFact {
  readonly kind: (typeof TRUST_FACT_KINDS)[number];
  readonly value: string;
}

/** One action a person can take to activate committed provider configuration. */
export interface ProviderTrustAction {
  readonly kind: (typeof TRUST_ACTION_KINDS)[number];
  /** Explanation prose only; literal paths, keys, values, and flags live in facts. */
  readonly instruction: string;
  readonly facts: ProviderTrustFact[];
}

/** Whether and how a provider activates committed integration configuration. */
export interface TrustGate {
  readonly required: boolean;
  /** Why trust is or is not needed. Contains no literal machine facts. */
  readonly explanation: string;
  readonly actions: ProviderTrustAction[];
}

/** JSON-safe trust guidance projected from one provider registry member. */
export interface ProviderTrustData {
  readonly provider: string;
  readonly required: boolean;
  readonly explanation: string;
  readonly actions: ProviderTrustAction[];
}

/** Preserve typed trust facts for compact JSON and MCP projections. */
export function providerTrustData(
  provider: string,
  trust: TrustGate,
): ProviderTrustData {
  return {
    provider,
    required: trust.required,
    explanation: trust.explanation,
    actions: trust.actions.map((action) => ({
      kind: action.kind,
      instruction: action.instruction,
      facts: action.facts.map((fact) => ({ ...fact })),
    })),
  };
}

const TRUST_FACT_LABELS: Record<ProviderTrustFact["kind"], string> = {
  path: "path",
  "config-key": "key",
  "config-value": "value",
  flag: "flag",
  "environment-variable": "environment variable",
};

/** Render typed facts, preserving an adjacent config key/value as one assignment. */
function renderTrustFacts(facts: readonly ProviderTrustFact[]): string[] {
  const rendered: string[] = [];
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index];
    if (fact === undefined) continue;
    const next = facts[index + 1];
    if (fact.kind === "config-key" && next?.kind === "config-value") {
      rendered.push(
        `key ${markdownCodeSpan(fact.value)} = ${markdownCodeSpan(next.value)}`,
      );
      index += 1;
      continue;
    }
    rendered.push(
      `${TRUST_FACT_LABELS[fact.kind]} ${markdownCodeSpan(fact.value)}`,
    );
  }
  return rendered;
}

/** Terminate one rendered prose fragment without changing authored punctuation. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Render trust guidance from typed facts for generated Markdown references. */
export function renderProviderTrustMarkdown(trust: TrustGate): string {
  const actions = trust.actions.map((action) => {
    const facts = renderTrustFacts(action.facts);
    return sentence(
      `${action.instruction}${
        facts.length === 0 ? "" : ` (${facts.join(", ")})`
      }`,
    );
  });
  return [sentence(trust.explanation), ...actions].join(" ");
}

/** The CLI uses the same literal-preserving wording as generated Markdown. */
export const renderProviderTrustCli = renderProviderTrustMarkdown;
