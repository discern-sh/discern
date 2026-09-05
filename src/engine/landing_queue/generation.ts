/** Use the existing generated ownership, compiler, and supervised command capabilities. */
import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import {
  type ResolvedGeneratedGroup,
  resolveGeneratedGroups,
} from "../../shared/generated_artifacts.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { renderAgentFiles } from "../instruction_render.ts";
import { adrIndexState } from "../../lib/adr_index.ts";
import {
  compileInstructions,
  instructionRefreshErrors,
} from "../instructions.ts";
import { Logger } from "../../lib/log.ts";
import { runCapturedCommands } from "../jobs/captured.ts";
import type {
  ClaimedExecution,
  CompletionBlocker,
} from "../completion/protocol.ts";
import type { Candidate } from "../completion/candidate.ts";

export interface CompositionRecipe {
  readonly identity: Pick<
    Candidate["composition"],
    "procedure" | "generated_ownership" | "generators"
  >;
  readonly groups: readonly ResolvedGeneratedGroup[];
  readonly built_in_paths: readonly string[];
  readonly engine_identity: string;
  readonly timeout: number;
  readonly environment: Readonly<Record<string, string>>;
}

/** Compiler identity is an explicit host input, just as producer toolchain identity is. */
export async function compositionRecipe(
  root: string,
  config: DiscernConfig,
  engineIdentity: string,
  timeout: number,
  environment: Readonly<Record<string, string>>,
): Promise<CompositionRecipe> {
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("Generators need a positive bounded timeout.");
  }
  const groups = resolveGeneratedGroups(config).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const index = await adrIndexState(root, config.map.dir);
  const builtIn = [
    ...(await renderAgentFiles(root, config)).keys(),
    ...(index.kind === "absent" ? [] : [index.path]),
  ].sort();
  const ownership = await sha256Hex(
    JSON.stringify([groups.map((group) => [group.name, group.paths]), builtIn]),
  );
  const generators = await sha256Hex(
    JSON.stringify([
      groups.map((group) => [group.name, group.run, group.timeout ?? timeout]),
      engineIdentity,
      Object.entries(environment).sort(([a], [b]) => a.localeCompare(b)),
    ]),
  );
  return {
    identity: {
      procedure: await sha256Hex(
        JSON.stringify(["git-update-generated-v1", ownership, generators]),
      ),
      generated_ownership: ownership,
      generators,
    },
    groups,
    built_in_paths: builtIn,
    engine_identity: engineIdentity,
    timeout,
    environment,
  };
}

/** A changed generator/ownership definition makes the selected procedure stale before execution. */
export async function convergeGenerated(
  execution: ClaimedExecution,
  recipe: CompositionRecipe,
): Promise<CompletionBlocker | undefined> {
  const root = execution.environment.path;
  const current = await compositionRecipe(
    root,
    await loadConfig(root),
    recipe.engine_identity,
    recipe.timeout,
    recipe.environment,
  );
  if (JSON.stringify(current.identity) !== JSON.stringify(recipe.identity)) {
    return {
      kind: "missing-judgment",
      subjects: ["composition-procedure-changed"],
    };
  }
  for (const group of recipe.groups) {
    const result = await runCapturedCommands({
      root,
      label: `generated:${group.name}`,
      commands: [group.run],
      timeout: group.timeout ?? recipe.timeout,
      signal: execution.signal,
      environment: recipe.environment,
    });
    if (!result.capture_complete || result.result.code !== 0) {
      return { kind: "validation-failed", evidence_ids: [] };
    }
  }
  const refreshed = await compileInstructions(
    root,
    new Logger({ json: true, noColor: true }),
    { reconcileProofNotesFetch: false },
  );
  if (instructionRefreshErrors(refreshed).length > 0) {
    return { kind: "validation-failed", evidence_ids: [] };
  }
  const after = await compositionRecipe(
    root,
    await loadConfig(root),
    recipe.engine_identity,
    recipe.timeout,
    recipe.environment,
  );
  return JSON.stringify(after.identity) === JSON.stringify(recipe.identity)
    ? undefined
    : { kind: "missing-judgment", subjects: ["composition-procedure-changed"] };
}
