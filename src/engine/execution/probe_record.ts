/**
 * The durable record of which environment declarations `discern setup done`
 * has proved, kept in common Git administration beside the completion records.
 *
 * A proof binds to the declaration's own identity (the same digest enrolled
 * environments carry), not to a commit: the probe exercises prepare, restore,
 * declared ignored output, and resources, so those are what a later change
 * invalidates. Doctor reads it to say whether a declaration was ever proved and
 * whether it changed since; the landing queue reads it before validating any
 * effort early; setup reads it to decide whether a replay may skip the probe.
 * An older discern that meets a newer file treats every declaration as
 * unproven and says why; it never replaces the newer bytes.
 */

import { dirname } from "@std/path";
import { z } from "@zod/zod";
import { atomicReplaceJson } from "../../shared/atomic_write.ts";
import type {
  DiscernConfig,
  EnvironmentDeclaration,
} from "../../shared/config_schema.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import {
  inspectOnDiskJsonVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";
import type { EnvironmentProbeSummary } from "../../shared/environment_probe.ts";
import type { CompletionBlocker } from "../completion/protocol.ts";
import { declarationIdentity } from "./subjects.ts";

const PROOF_VERSION = ON_DISK_FORMATS.environmentProof.version;

/** One proved declaration: which context, which exact declaration, and where. */
export const EnvironmentProofSchema = z.strictObject({
  context: z.string().min(1),
  /** The declaration identity the probe exercised. */
  declaration: z.string().min(1),
  proven_at: z.number().int().nonnegative(),
  source: z.strictObject({
    branch: z.string().min(1),
    head: z.string().min(1),
  }),
  exercised: z.array(z.string().min(1)),
});
export type EnvironmentProof = z.infer<typeof EnvironmentProofSchema>;

const EnvironmentProofsSchema = z.strictObject({
  version: z.literal(PROOF_VERSION),
  proofs: z.array(EnvironmentProofSchema),
});

export type EnvironmentProofsRead =
  | {
    readonly status: "recorded";
    readonly proofs: readonly EnvironmentProof[];
  }
  | { readonly status: "missing" }
  | { readonly status: "newer"; readonly reason: string }
  | { readonly status: "malformed" }
  | { readonly status: "unavailable" };

/** Read every recorded proof without collapsing forward skew or damage into absence. */
export async function readEnvironmentProofs(
  root: string,
): Promise<EnvironmentProofsRead> {
  const path = await gitAdminStatePath(root, "environmentProofs");
  if (path === undefined) return { status: "unavailable" };
  const raw = await readTextIfExists(path);
  if (raw === undefined) return { status: "missing" };
  const version = inspectOnDiskJsonVersion("environmentProof", raw);
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage("environmentProof", version.found),
    };
  }
  if (version.status === "invalid") return { status: "malformed" };
  const parsed = EnvironmentProofsSchema.safeParse(JSON.parse(raw));
  return parsed.success
    ? { status: "recorded", proofs: parsed.data.proofs }
    : { status: "malformed" };
}

/**
 * Record one proved declaration, replacing any earlier proof for its context.
 * A file written by a newer discern is never replaced.
 */
export async function recordEnvironmentProof(
  root: string,
  proof: EnvironmentProof,
): Promise<void> {
  const path = await gitAdminStatePath(root, "environmentProofs");
  if (path === undefined) {
    throw new Error(
      "The environment proof record cannot be located; the probe's result was not recorded.",
    );
  }
  const current = await readEnvironmentProofs(root);
  if (current.status === "newer") throw new Error(current.reason);
  const kept = current.status === "recorded"
    ? current.proofs.filter((entry) => entry.context !== proof.context)
    : [];
  await Deno.mkdir(dirname(path), { recursive: true });
  await atomicReplaceJson(
    path,
    EnvironmentProofsSchema.parse({
      version: PROOF_VERSION,
      proofs: [...kept, EnvironmentProofSchema.parse(proof)],
    }),
    { mode: 0o666, sync: false, space: 2, trailingNewline: true },
  );
}

/** What the record says about one declared context. */
export type DeclarationProofState =
  | { readonly state: "proven"; readonly proof: EnvironmentProof }
  /** No proof was ever recorded for this context. */
  | { readonly state: "unproven" }
  /** A proof exists, but for a different declaration than the current one. */
  | { readonly state: "changed"; readonly proof: EnvironmentProof }
  /** The record cannot be read by this build or is damaged; nothing is assumed. */
  | { readonly state: "unreadable"; readonly reason: string }
  /** Isolated declarations are provided outside setup and never rehearsed by it. */
  | { readonly state: "not-rehearsed" };

/** Classify one declaration against the recorded proofs. */
export async function declarationProofState(
  root: string,
  context: string,
  declaration: EnvironmentDeclaration,
): Promise<DeclarationProofState> {
  if (declaration.kind === "isolated") return { state: "not-rehearsed" };
  const read = await readEnvironmentProofs(root);
  if (read.status === "newer") {
    return { state: "unreadable", reason: read.reason };
  }
  if (read.status === "malformed") {
    return {
      state: "unreadable",
      reason:
        "The environment proof record is damaged; preserve its bytes and run `discern setup done` to record a fresh proof.",
    };
  }
  if (read.status === "unavailable") {
    return {
      state: "unreadable",
      reason: "The environment proof record cannot be located.",
    };
  }
  const proof = read.status === "recorded"
    ? read.proofs.find((entry) => entry.context === context)
    : undefined;
  if (proof === undefined) return { state: "unproven" };
  return proof.declaration === await declarationIdentity(declaration)
    ? { state: "proven", proof }
    : { state: "changed", proof };
}

/** Every required context's declaration, classified; undeclared contexts are absent. */
export async function declarationProofStates(
  root: string,
  config: DiscernConfig,
): Promise<Map<string, DeclarationProofState>> {
  const states = new Map<string, DeclarationProofState>();
  for (const context of config.completion.required_contexts) {
    const declaration = config.execution[context];
    if (declaration === undefined) continue;
    states.set(
      context,
      await declarationProofState(root, context, declaration),
    );
  }
  return states;
}

/** The required contexts whose declaration setup proved, as the capacity facts consume them. */
export async function provenContexts(
  root: string,
  config: DiscernConfig,
): Promise<string[]> {
  return [...(await declarationProofStates(root, config)).entries()]
    .filter(([, state]) =>
      state.state === "proven" || state.state === "not-rehearsed"
    )
    .map(([context]) => context);
}

/** One plain sentence for a declaration setup has not proved, with the route. */
export function unprovenDeclarationReason(
  context: string,
  state: Exclude<DeclarationProofState, { state: "proven" | "not-rehearsed" }>,
): string {
  const because = state.state === "unproven"
    ? `the environment declared for \`${context}\` has not been proven by \`discern setup done\``
    : state.state === "changed"
    ? `the environment declared for \`${context}\` changed after \`discern setup done\` proved it`
    : `the record of proven environments cannot be read (${state.reason})`;
  return `${because}. Run \`discern setup done\` from a clean committed tree to prove the current declaration; until then efforts in that context validate in order.`;
}

/**
 * The blocker that keeps an effort from validating early in an unproven
 * environment. Undefined when the declaration is proven or is isolated.
 */
export async function unprovenSpeculationBlocker(
  root: string,
  context: string,
  declaration: EnvironmentDeclaration,
): Promise<CompletionBlocker | undefined> {
  const state = await declarationProofState(root, context, declaration);
  if (state.state === "proven" || state.state === "not-rehearsed") {
    return undefined;
  }
  return {
    kind: "environment-unavailable",
    reason: `Early validation needs a proven environment, but ${
      unprovenDeclarationReason(context, state)
    }`,
  };
}

/** The probe summary a setup replay reports from the record alone. */
export async function recordedEnvironmentProbe(
  root: string,
  config: DiscernConfig,
): Promise<EnvironmentProbeSummary> {
  const states = await declarationProofStates(root, config);
  return {
    proven: [...states.entries()].filter(([, state]) =>
      state.state === "proven"
    ).map(([context]) => context),
    undeclared: config.completion.required_contexts.filter((context) =>
      config.execution[context] === undefined
    ),
    isolated: [...states.entries()].filter(([, state]) =>
      state.state === "not-rehearsed"
    ).map(([context]) => context),
  };
}

/** Required contexts whose declaration setup must still prove, with each reason. */
export async function unprovenDeclarations(
  root: string,
  config: DiscernConfig,
): Promise<{ readonly context: string; readonly reason: string }[]> {
  return [...(await declarationProofStates(root, config)).entries()].flatMap(
    ([context, state]) =>
      state.state === "proven" || state.state === "not-rehearsed"
        ? []
        : [{ context, reason: unprovenDeclarationReason(context, state) }],
  );
}
