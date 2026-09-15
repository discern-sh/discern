/** Offline release handoff shared by the CLI and an explicitly activated Desk command. */
import {
  DISCERN_VERSION,
  humanVersion,
  RELEASE_METADATA,
} from "../lib/version.ts";
import { type BrowserOpenResult, openInBrowser } from "../lib/open_browser.ts";
import { releaseCheckUrls } from "../shared/product_identity.ts";
import { findRoot } from "../shared/env.ts";
import { SYSTEM_CLOCK } from "../shared/clock.ts";
import { observeTerminalStreams } from "../lib/terminal_interaction.ts";
import { Logger } from "../lib/log.ts";
import { RESULT_MARKDOWN_PRESENTERS } from "../shared/result_markdown.ts";
import { emitResult, renderResultReading } from "../shared/emit.ts";
import { fire, HINTS, hintTexts } from "../shared/hints.ts";
import type { DiscernResult } from "../shared/result.ts";
import type { ReleasesData } from "../shared/result_schemas.ts";
import {
  inspectReleaseCheck,
  type ReleaseCheckRead,
  type ReleaseCheckWrite,
  writeReleaseCheck,
} from "../shared/release_check.ts";

export interface ReleaseInvocation {
  readonly mode: "cli" | "json" | "markdown" | "desk";
  readonly stdinTty: boolean;
  readonly stdoutTty: boolean;
  readonly dryRun: boolean;
}
export interface ReleasePlan {
  readonly version: string;
  readonly codename?: string;
  readonly urls: { html: string; json: string };
  readonly root?: string;
  readonly state: ReleaseCheckRead["status"] | "outside-repository";
  readonly launch: boolean;
  readonly write: boolean;
  readonly dryRun: boolean;
}

/** Pure plan: only the running process identity contributes to the URLs. */
export function planReleases(
  invocation: ReleaseInvocation,
  repository: { root: string; state: ReleaseCheckRead } | undefined,
  metadata: { version: string; codename?: string } = {
    ...RELEASE_METADATA,
    version: DISCERN_VERSION,
  },
): ReleasePlan {
  return {
    version: metadata.version,
    ...(metadata.codename === undefined ? {} : { codename: metadata.codename }),
    urls: releaseCheckUrls(metadata.version),
    ...(repository === undefined ? {} : { root: repository.root }),
    state: repository?.state.status ?? "outside-repository",
    launch: !invocation.dryRun && (invocation.mode === "desk" ||
      (invocation.mode === "cli" && invocation.stdinTty &&
        invocation.stdoutTty)),
    write: !invocation.dryRun && repository !== undefined &&
      repository.state.status !== "newer" &&
      repository.state.status !== "unavailable",
    dryRun: invocation.dryRun,
  };
}
export interface ReleaseEffects {
  readonly now: () => number;
  readonly open: (url: string) => Promise<BrowserOpenResult>;
  readonly write: (
    root: string,
    version: string,
    now: number,
  ) => Promise<ReleaseCheckWrite>;
}
const RELEASE_EFFECTS: ReleaseEffects = {
  now: SYSTEM_CLOCK.wallNow,
  open: openInBrowser,
  write: writeReleaseCheck,
};

/** Apply only the planned local write and optional browser adapter; neither fetches nor installs. */
export async function applyReleases(
  plan: ReleasePlan,
  overrides: Partial<ReleaseEffects> = {},
): Promise<DiscernResult<ReleasesData>> {
  const effects = { ...RELEASE_EFFECTS, ...overrides };
  const stateWrite = plan.write && plan.root !== undefined
    ? await effects.write(plan.root, plan.version, effects.now())
    : { status: "skipped" as const };
  const opened = plan.launch ? await effects.open(plan.urls.html) : undefined;
  return {
    ok: true,
    verb: "releases",
    ...(plan.dryRun ? { dry_run: true as const } : {}),
    data: {
      running_version: plan.version,
      ...(plan.codename === undefined ? {} : { codename: plan.codename }),
      urls: plan.urls,
      repository_state: plan.state,
      launch_eligible: plan.launch,
      launch_attempted: opened !== undefined && opened.status !== "unsupported",
      launch_succeeded: opened?.status === "opened",
      ...(opened !== undefined && opened.status !== "opened"
        ? { launch_message: opened.message }
        : {}),
      state_write: stateWrite,
      network_request: false,
    },
    hints: hintTexts([fire(HINTS["release-check-sequence"])]),
    message: `${
      plan.dryRun
        ? "Would hand off release information for"
        : "Release information for"
    } ${
      humanVersion({
        version: plan.version,
        ...(plan.codename === undefined ? {} : { codename: plan.codename }),
      })
    }.`,
  };
}

/** Observe optional clone state, then execute the same plan for each entry point. */
export async function releasesResult(
  root: string | undefined,
  invocation: ReleaseInvocation,
  effects: Partial<ReleaseEffects> = {},
): Promise<DiscernResult<ReleasesData>> {
  const repository = root === undefined
    ? undefined
    : { root, state: await inspectReleaseCheck(root) };
  return await applyReleases(planReleases(invocation, repository), effects);
}

/** CLI adapter: format selection and actual terminal observations stay explicit. */
export async function runReleases(
  options: { json?: boolean; markdown?: boolean; dryRun?: boolean },
): Promise<number> {
  const streams = observeTerminalStreams();
  const result = await releasesResult(await findRoot(), {
    mode: options.json ? "json" : options.markdown ? "markdown" : "cli",
    stdinTty: streams.stdin,
    stdoutTty: streams.stdout,
    dryRun: options.dryRun ?? false,
  });
  if (options.json || options.markdown) emitResult(result);
  else {new Logger({ json: false, noColor: false }).line(
      renderResultReading(
        { ...result, hints: [] },
        RESULT_MARKDOWN_PRESENTERS.releases,
      ),
    );}
  return 0;
}
