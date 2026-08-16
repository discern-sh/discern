/**
 * One ordered reconciliation of every tracked provider integration.
 *
 * `discern refresh` calls this with live file effects; the read-only convergence
 * planner calls it with an in-memory overlay. That shared invocation is the
 * authority for ordering, error isolation, and future-provider enrollment.
 */

import { wireProviderHooks } from "../lib/provider_hooks.ts";
import {
  DISCERN_MCP_SERVER,
  wireProviderMcp,
  wireProviderProjectRules,
  wireProviderWorktreeApp,
} from "../lib/providers.ts";
import {
  LIVE_REFRESH_FILE_OPS,
  type RefreshFileOps,
} from "../lib/refresh_file_ops.ts";
import type { DiscernConfig } from "../shared/config_schema.ts";
import type { EnvReader } from "../shared/env.ts";
import { instructionAgents } from "./instruction_render.ts";

/** Ordered provider-integration refresh result shared by plan and apply. */
export interface TrackedProviderRefreshResult {
  readonly mcpWired: string[];
  readonly mcpFirstInstall: boolean;
  readonly mcpFirstInstallPaths: string[];
  readonly hooksWired: string[];
  readonly worktreeAppWired: string[];
  readonly projectRulesWired: string[];
  readonly errors: string[];
}

/** Preserve an Error's message and stringify non-Error failures. */
function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run every tracked provider writer in refresh order against one effect sink. */
export async function reconcileTrackedProviderArtifacts(
  root: string,
  config: DiscernConfig,
  env: EnvReader = Deno.env,
  files: RefreshFileOps = LIVE_REFRESH_FILE_OPS,
  firstInstallBaselineFiles?: RefreshFileOps,
): Promise<TrackedProviderRefreshResult> {
  const agents = instructionAgents(config);
  const errors: string[] = [];
  let mcpWired: string[] = [];
  let mcpFirstInstall = false;
  let mcpFirstInstallPaths: string[] = [];
  let hooksWired: string[] = [];
  let worktreeAppWired: string[] = [];
  let projectRulesWired: string[] = [];

  try {
    const result = await wireProviderMcp(
      root,
      agents,
      DISCERN_MCP_SERVER,
      config,
      env,
      files,
    );
    mcpWired = result.written;
    mcpFirstInstall = result.firstInstall;
    mcpFirstInstallPaths = result.firstInstallPaths;
    if (
      firstInstallBaselineFiles !== undefined &&
      mcpFirstInstallPaths.length > 0
    ) {
      const baseline = await wireProviderMcp(
        root,
        agents,
        DISCERN_MCP_SERVER,
        config,
        env,
        firstInstallBaselineFiles,
      );
      mcpFirstInstallPaths = mcpFirstInstallPaths.filter((path) =>
        baseline.firstInstallPaths.includes(path)
      );
    }
  } catch (error) {
    errors.push(`could not update the MCP integration: ${errText(error)}`);
  }

  try {
    const result = await wireProviderHooks(root, config, files);
    hooksWired = result.written;
    errors.push(...result.errors);
  } catch (error) {
    errors.push(
      `could not update the provider hook integration: ${errText(error)}`,
    );
  }

  try {
    worktreeAppWired = await wireProviderWorktreeApp(
      root,
      agents,
      env,
      files,
    );
  } catch (error) {
    errors.push(
      `could not update the worktree-app integration: ${errText(error)}`,
    );
  }

  try {
    projectRulesWired = await wireProviderProjectRules(
      root,
      agents,
      env,
      files,
    );
  } catch (error) {
    errors.push(
      `could not update the project-rules integration: ${errText(error)}`,
    );
  }

  return {
    mcpWired,
    mcpFirstInstall,
    mcpFirstInstallPaths,
    hooksWired,
    worktreeAppWired,
    projectRulesWired,
    errors,
  };
}
