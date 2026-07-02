/**
 * Guided, end-to-end clean-room setup eval runner.
 *
 * This is the one-command path over the lower-level fixture and agent runners:
 * choose targets/agents/flavors, create disposable fixtures, run first+continue
 * phases, write a summary, and clean up temporary repos/checkouts.
 */

import { Checkbox, Confirm, Input } from "@cliffy/prompt";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const SCRIPT_DIR = dirname(fromFileUrl(import.meta.url));
const MAKE_FIXTURE = join(SCRIPT_DIR, "make-fixture.ts");
const RUN_AGENT = join(SCRIPT_DIR, "run-agent.ts");
const DEFAULT_BASELINE_SHA = "37ff892";
const DEFAULT_DOCS_ANSWER = "docs/discern/";
/** How many generic keep-going turns to send after the continuation before calling
 * the run stalled. One is normal (the brief's discovery batch is a real pause);
 * needing all of them is a finding worth grading, not retrying past. */
const MAX_RESUME_TURNS = 3;

const AGENTS = ["claude", "codex"] as const;
const FLAVORS = ["deno", "node"] as const;

type Agent = typeof AGENTS[number];
type Flavor = typeof FLAVORS[number];

interface RawOptions {
  agents: Agent[] | undefined;
  baselineSha: string;
  changedCheckout: string | undefined;
  claudeModel: string | undefined;
  claudeModelId: string | undefined;
  codexModel: string | undefined;
  codexModelId: string | undefined;
  docsAnswer: string;
  dryRun: boolean;
  extraClaudeArgs: string[];
  extraCodexArgs: string[];
  flavors: Flavor[] | undefined;
  help: boolean;
  includeBaseline: boolean | undefined;
  includeCurrent: boolean | undefined;
  keepCheckouts: boolean;
  keepFixtures: boolean;
  pauseAfterFirst: boolean;
  resultsRoot: string | undefined;
  stopOnFailure: boolean;
  withDocs: boolean | undefined;
  yes: boolean;
}

interface ResolvedOptions {
  agents: Agent[];
  agentModels: Record<Agent, string | undefined>;
  docsAnswer: string;
  dryRun: boolean;
  extraArgs: Record<Agent, string[]>;
  flavors: Flavor[];
  includeBaseline: boolean;
  includeCurrent: boolean;
  keepCheckouts: boolean;
  keepFixtures: boolean;
  modelIds: Record<Agent, string | undefined>;
  pauseAfterFirst: boolean;
  resultsRoot: string;
  stopOnFailure: boolean;
  withDocs: boolean;
  yes: boolean;
}

interface CommandResult {
  code: number;
  stderr: string;
  stdout: string;
}

interface FixtureResult {
  branch: string;
  docs: string | null;
  flavor: Flavor;
  path: string;
}

interface RunRecord {
  agent: Agent;
  command: string[];
  cwd: string;
  discernCheckout: string;
  discernDirty: boolean;
  discernSha: string;
  elapsedMs: number;
  endedAt: string;
  exitCode: number;
  fixture: string;
  phase: "first" | "continue";
  promptFile: string;
  resultDir: string;
  sessionId: string | null;
  startedAt: string;
  stderrBytes: number;
  stderrFile: string;
  stdoutBytes: number;
  stdoutFile: string;
}

interface EvalTarget {
  cleanupParent: string | undefined;
  kind: "baseline" | "current";
  label: string;
  managed: boolean;
  path: string;
}

interface EvalRun {
  agent: Agent;
  /** True once the fixture's discern.toml records `bootstrapped = true` — setup
   * genuinely completed, derived from repo state, never from transcript text. */
  bootstrapped: boolean;
  checkout: string;
  checkoutLabel: string;
  continuation: RunRecord | null;
  errors: string[];
  first: RunRecord | null;
  fixture: string;
  fixtureCleaned: boolean;
  flavor: Flavor;
  resultDir: string;
  /** Generic keep-going turns sent after the continuation because the agent ended
   * its turn mid-setup (e.g. waiting on the discovery batch). Data, not failure:
   * the count shows how many human turns this agent's setup actually took. */
  resumes: RunRecord[];
}

interface EvalSummary {
  endedAt: string;
  failures: number;
  resultsRoot: string;
  runs: EvalRun[];
  startedAt: string;
  summaryFile: string;
}

function usage(): string {
  return `Usage:
  deno task setup-eval [options]

Guided defaults:
  no flags          TUI prompts for target checkout(s), agents, fixtures, cleanup
  --yes             run non-interactively with safe defaults

Options:
  --baseline                  Also run the pinned baseline checkout
  --baseline-only             Run only the baseline checkout
  --baseline-sha <sha>        Baseline commit/ref (default: ${DEFAULT_BASELINE_SHA})
  --changed-checkout <path>   Changed checkout to evaluate (default: current repo)
  --agents <list>             claude,codex
  --flavors <list>            deno,node (alias: --flavours)
  --no-docs                   Create fixtures without an existing docs/ tree
  --docs-answer <path>        Consent answer for discern's docs tree (default: ${DEFAULT_DOCS_ANSWER})
  --codex-model <model>       Pass --model to codex
  --claude-model <model>      Pass --model to claude
  --codex-model-id <id>       Model id used in the consent continuation
  --claude-model-id <id>      Model id used in the consent continuation
  --extra-codex-arg <arg>     Extra raw codex CLI arg; repeat as needed
  --extra-claude-arg <arg>    Extra raw claude CLI arg; repeat as needed
  --results-root <path>       Results directory (default: scripts/setup-eval/results)
  --keep-fixtures             Leave disposable target repos on disk
  --keep-checkouts            Leave managed baseline checkouts on disk
  --pause-after-first         Prompt before the continuation phase
  --stop-on-failure           Stop the matrix after the first failed run
  --dry-run                   Print the resolved plan without running agents
  --yes                       Do not prompt; use defaults and supplied flags
  -h, --help                  Show this help
`;
}

function valueAfter(
  args: readonly string[],
  index: number,
  flag: string,
): { next: number; value: string } {
  const value = args[index + 1];
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  return { next: index + 1, value };
}

function parseChoiceList<T extends string>(
  value: string,
  known: readonly T[],
  label: string,
): T[] {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  const parsed: T[] = [];
  const unknown: string[] = [];
  for (const part of parts) {
    if ((known as readonly string[]).includes(part)) {
      parsed.push(part as T);
    } else {
      unknown.push(part);
    }
  }
  if (unknown.length > 0) {
    throw new Error(`unknown ${label}(s): ${unknown.join(", ")}`);
  }
  if (parsed.length === 0) {
    throw new Error(`choose at least one ${label}`);
  }
  return parsed;
}

function parseArgs(args: readonly string[]): RawOptions {
  const raw: RawOptions = {
    agents: undefined,
    baselineSha: DEFAULT_BASELINE_SHA,
    changedCheckout: undefined,
    claudeModel: undefined,
    claudeModelId: undefined,
    codexModel: undefined,
    codexModelId: undefined,
    docsAnswer: DEFAULT_DOCS_ANSWER,
    dryRun: false,
    extraClaudeArgs: [],
    extraCodexArgs: [],
    flavors: undefined,
    help: false,
    includeBaseline: undefined,
    includeCurrent: undefined,
    keepCheckouts: false,
    keepFixtures: false,
    pauseAfterFirst: false,
    resultsRoot: undefined,
    stopOnFailure: false,
    withDocs: undefined,
    yes: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--agents" || arg === "--agent") {
      const parsed = valueAfter(args, index, arg);
      raw.agents = parseChoiceList(parsed.value, AGENTS, "agent");
      index = parsed.next;
    } else if (
      arg === "--flavors" || arg === "--flavours" || arg === "--flavor" ||
      arg === "--flavour"
    ) {
      const parsed = valueAfter(args, index, arg);
      raw.flavors = parseChoiceList(parsed.value, FLAVORS, "flavor");
      index = parsed.next;
    } else if (arg === "--baseline") {
      raw.includeBaseline = true;
    } else if (arg === "--baseline-only") {
      raw.includeBaseline = true;
      raw.includeCurrent = false;
    } else if (arg === "--no-current") {
      raw.includeCurrent = false;
    } else if (arg === "--current") {
      raw.includeCurrent = true;
    } else if (arg === "--baseline-sha") {
      const parsed = valueAfter(args, index, arg);
      raw.baselineSha = parsed.value;
      index = parsed.next;
    } else if (arg === "--changed-checkout" || arg === "--discern-checkout") {
      const parsed = valueAfter(args, index, arg);
      raw.changedCheckout = parsed.value;
      index = parsed.next;
    } else if (arg === "--no-docs") {
      raw.withDocs = false;
    } else if (arg === "--with-docs") {
      raw.withDocs = true;
    } else if (arg === "--docs-answer") {
      const parsed = valueAfter(args, index, arg);
      raw.docsAnswer = parsed.value;
      index = parsed.next;
    } else if (arg === "--codex-model") {
      const parsed = valueAfter(args, index, arg);
      raw.codexModel = parsed.value;
      index = parsed.next;
    } else if (arg === "--claude-model") {
      const parsed = valueAfter(args, index, arg);
      raw.claudeModel = parsed.value;
      index = parsed.next;
    } else if (arg === "--codex-model-id") {
      const parsed = valueAfter(args, index, arg);
      raw.codexModelId = parsed.value;
      index = parsed.next;
    } else if (arg === "--claude-model-id") {
      const parsed = valueAfter(args, index, arg);
      raw.claudeModelId = parsed.value;
      index = parsed.next;
    } else if (arg === "--extra-codex-arg") {
      const parsed = valueAfter(args, index, arg);
      raw.extraCodexArgs.push(parsed.value);
      index = parsed.next;
    } else if (arg === "--extra-claude-arg") {
      const parsed = valueAfter(args, index, arg);
      raw.extraClaudeArgs.push(parsed.value);
      index = parsed.next;
    } else if (arg === "--results-root") {
      const parsed = valueAfter(args, index, arg);
      raw.resultsRoot = parsed.value;
      index = parsed.next;
    } else if (arg === "--keep-fixtures") {
      raw.keepFixtures = true;
    } else if (arg === "--keep-checkouts") {
      raw.keepCheckouts = true;
    } else if (arg === "--pause-after-first") {
      raw.pauseAfterFirst = true;
    } else if (arg === "--stop-on-failure") {
      raw.stopOnFailure = true;
    } else if (arg === "--dry-run") {
      raw.dryRun = true;
    } else if (arg === "--yes" || arg === "-y") {
      raw.yes = true;
    } else if (arg === "--") {
      continue;
    } else if (arg === "-h" || arg === "--help") {
      raw.help = true;
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }

  return raw;
}

function canPrompt(yes: boolean): boolean {
  return !yes && Deno.stdin.isTerminal() && Deno.stdout.isTerminal();
}

async function commandAvailable(name: string): Promise<boolean> {
  const result = await new Deno.Command("sh", {
    args: ["-c", `command -v "$1" >/dev/null 2>&1`, "sh", name],
    stdout: "null",
    stderr: "null",
  }).output();
  return result.success;
}

async function detectedAgents(): Promise<Agent[]> {
  const entries = await Promise.all(
    AGENTS.map(async (agent) => ({
      agent,
      available: await commandAvailable(agent),
    })),
  );
  return entries.filter((entry) => entry.available).map((entry) => entry.agent);
}

async function optionalInput(
  message: string,
  defaultValue: string | undefined,
): Promise<string | undefined> {
  const answer = await Input.prompt({
    message,
    default: defaultValue ?? "",
  });
  const trimmed = answer.trim();
  return trimmed === "" ? undefined : trimmed;
}

async function resolveOptions(raw: RawOptions): Promise<ResolvedOptions> {
  const interactive = canPrompt(raw.yes);
  const detected = await detectedAgents();

  let includeCurrent = raw.includeCurrent ?? true;
  let includeBaseline = raw.includeBaseline ?? false;
  if (
    interactive && raw.includeCurrent === undefined &&
    raw.includeBaseline === undefined
  ) {
    const targets = await Checkbox.prompt<string>({
      message: "Discern checkout(s) to evaluate",
      options: [
        { name: "Current checkout", value: "current", checked: true },
        {
          name: `Baseline checkout (${raw.baselineSha})`,
          value: "baseline",
        },
      ],
      minOptions: 1,
    });
    includeCurrent = targets.includes("current");
    includeBaseline = targets.includes("baseline");
  }

  let agents = raw.agents;
  if (agents === undefined && interactive) {
    agents = await Checkbox.prompt<Agent>({
      message: "Agent CLI(s) to run",
      options: AGENTS.map((agent) => ({
        name: `${agent}${detected.includes(agent) ? " (detected)" : ""}`,
        value: agent,
        checked: detected.includes(agent),
      })),
      default: detected.length > 0 ? detected : ["codex"],
      minOptions: 1,
    }) as Agent[];
  }
  if (agents === undefined) {
    agents = detected.length > 0 ? detected : ["codex"];
  }

  let flavors = raw.flavors;
  if (flavors === undefined && interactive) {
    flavors = await Checkbox.prompt<Flavor>({
      message: "Fixture flavor(s)",
      options: [
        { name: "Deno fixture", value: "deno", checked: true },
        { name: "Node fixture", value: "node" },
      ],
      default: ["deno"],
      minOptions: 1,
    }) as Flavor[];
  }
  if (flavors === undefined) {
    flavors = ["deno"];
  }

  let withDocs = raw.withDocs ?? true;
  if (interactive && raw.withDocs === undefined) {
    withDocs = await Confirm.prompt({
      message: "Include an existing docs/ tree in each fixture?",
      default: true,
    });
  }

  let keepFixtures = raw.keepFixtures;
  let keepCheckouts = raw.keepCheckouts;
  if (interactive && !raw.keepFixtures) {
    keepFixtures = !await Confirm.prompt({
      message: "Clean up disposable fixture repos after the run?",
      default: true,
    });
  }
  if (interactive && includeBaseline && !raw.keepCheckouts) {
    keepCheckouts = !await Confirm.prompt({
      message: "Clean up managed baseline checkout after the run?",
      default: true,
    });
  }

  const agentModels: Record<Agent, string | undefined> = {
    claude: raw.claudeModel ?? Deno.env.get("CLAUDE_MODEL"),
    codex: raw.codexModel ?? Deno.env.get("CODEX_MODEL"),
  };
  const modelIds: Record<Agent, string | undefined> = {
    claude: raw.claudeModelId ?? raw.claudeModel ??
      Deno.env.get("CLAUDE_MODEL"),
    codex: raw.codexModelId ?? raw.codexModel ?? Deno.env.get("CODEX_MODEL"),
  };

  if (interactive) {
    for (const agent of agents) {
      agentModels[agent] = await optionalInput(
        `${agent} CLI --model (optional)`,
        agentModels[agent],
      );
      modelIds[agent] = await optionalInput(
        `${agent} setup provenance model id (optional)`,
        modelIds[agent] ?? agentModels[agent],
      );
    }
  }

  if (interactive && raw.resultsRoot === undefined) {
    const answer = await Input.prompt({
      message: "Results root",
      default: join(SCRIPT_DIR, "results"),
    });
    raw.resultsRoot = answer.trim() || undefined;
  }

  return {
    agents,
    agentModels,
    docsAnswer: raw.docsAnswer,
    dryRun: raw.dryRun,
    extraArgs: {
      claude: raw.extraClaudeArgs,
      codex: raw.extraCodexArgs,
    },
    flavors,
    includeBaseline,
    includeCurrent,
    keepCheckouts,
    keepFixtures,
    modelIds,
    pauseAfterFirst: raw.pauseAfterFirst,
    resultsRoot: resolve(raw.resultsRoot ?? join(SCRIPT_DIR, "results")),
    stopOnFailure: raw.stopOnFailure,
    withDocs,
    yes: raw.yes,
  };
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
  const result = await new Deno.Command(command, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: result.code,
    stderr: new TextDecoder().decode(result.stderr),
    stdout: new TextDecoder().decode(result.stdout),
  };
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const result = await runCommand("git", args, cwd);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

async function repoRoot(): Promise<string> {
  return await gitOutput(Deno.cwd(), ["rev-parse", "--show-toplevel"]);
}

function stamp(date: Date): string {
  const withoutMs = date.toISOString().replace(/\.\d{3}Z$/, "Z");
  return withoutMs
    .replaceAll("-", "")
    .replace("T", "-")
    .replaceAll(":", "");
}

function slug(value: string): string {
  const cleaned = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return cleaned || "run";
}

async function checkoutInfo(path: string): Promise<{
  dirty: boolean;
  sha: string;
}> {
  const sha = await gitOutput(path, ["rev-parse", "--short=12", "HEAD"]);
  const status = await gitOutput(path, ["status", "--porcelain"]);
  return { dirty: status.length > 0, sha };
}

async function createBaselineCheckout(
  root: string,
  sha: string,
): Promise<EvalTarget> {
  const parent = await Deno.makeTempDir({
    prefix: `discern-setup-eval-baseline-${slug(sha)}-`,
  });
  const path = join(parent, "checkout");
  const result = await runCommand(
    "git",
    ["worktree", "add", "--detach", path, sha],
    root,
  );
  if (result.code !== 0) {
    await Deno.remove(parent, { recursive: true }).catch(() => {});
    throw new Error(`could not create baseline checkout:\n${result.stderr}`);
  }
  return {
    cleanupParent: parent,
    kind: "baseline",
    label: `baseline-${slug(sha)}`,
    managed: true,
    path,
  };
}

async function resolveTargets(
  root: string,
  raw: RawOptions,
  opts: ResolvedOptions,
): Promise<EvalTarget[]> {
  const targets: EvalTarget[] = [];
  if (opts.includeCurrent) {
    targets.push({
      cleanupParent: undefined,
      kind: "current",
      label: "current",
      managed: false,
      path: resolve(raw.changedCheckout ?? root),
    });
  }
  if (opts.includeBaseline) {
    targets.push(await createBaselineCheckout(root, raw.baselineSha));
  }
  if (targets.length === 0) {
    throw new Error("choose at least one checkout to evaluate");
  }
  return targets;
}

function denoRunArgs(script: string, args: string[]): string[] {
  return [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-run",
    script,
    ...args,
  ];
}

async function createFixture(
  root: string,
  flavor: Flavor,
  withDocs: boolean,
): Promise<FixtureResult> {
  const args = ["--flavor", flavor, "--json"];
  if (!withDocs) {
    args.push("--no-docs");
  }
  const result = await runCommand(
    Deno.execPath(),
    denoRunArgs(MAKE_FIXTURE, args),
    root,
  );
  if (result.code !== 0) {
    throw new Error(`fixture creation failed:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout) as FixtureResult;
}

async function runAgentPhase(params: {
  agent: Agent;
  agentModel: string | undefined;
  attempt?: number;
  checkout: string;
  docsAnswer: string;
  extraArgs: string[];
  fixture: string;
  modelId: string | undefined;
  phase: "first" | "continue" | "resume";
  resultDir: string;
  root: string;
}): Promise<RunRecord> {
  const args = [
    "--json",
    "--agent",
    params.agent,
    "--fixture",
    params.fixture,
    "--discern-checkout",
    params.checkout,
    "--phase",
    params.phase,
    "--result-dir",
    params.resultDir,
    "--docs-answer",
    params.docsAnswer,
  ];
  if (params.phase === "resume" && params.attempt !== undefined) {
    args.push("--attempt", String(params.attempt));
  }
  if (params.agentModel !== undefined && params.agentModel !== "") {
    args.push("--agent-model", params.agentModel);
  }
  if (
    params.phase === "continue" && params.modelId !== undefined &&
    params.modelId !== ""
  ) {
    args.push("--model-id", params.modelId);
  }
  for (const extra of params.extraArgs) {
    args.push("--extra-agent-arg", extra);
  }

  const result = await runCommand(
    Deno.execPath(),
    denoRunArgs(RUN_AGENT, args),
    params.root,
  );
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return JSON.parse(result.stdout) as RunRecord;
}

/** True when the fixture's discern.toml records `bootstrapped = true` — the same
 * unfakeable marker `discern setup done` writes on success, read as plain text so
 * the harness needs no engine import. Absent file (pre-`begin` pause) reads false. */
async function fixtureBootstrapped(fixturePath: string): Promise<boolean> {
  try {
    const toml = await Deno.readTextFile(join(fixturePath, "discern.toml"));
    return /^\s*bootstrapped\s*=\s*true\s*$/m.test(toml);
  } catch {
    return false;
  }
}

async function cleanupFixture(path: string): Promise<boolean> {
  try {
    await Deno.remove(path, { recursive: true });
    await Deno.remove(`${path}.worktrees`, { recursive: true }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function cleanupBaseline(
  root: string,
  target: EvalTarget,
): Promise<void> {
  if (!target.managed) return;
  const result = await runCommand(
    "git",
    ["worktree", "remove", "--force", target.path],
    root,
  );
  if (result.code !== 0) {
    console.error(`could not remove baseline checkout ${target.path}:`);
    console.error(result.stderr);
  }
  if (target.cleanupParent !== undefined) {
    await Deno.remove(target.cleanupParent, { recursive: true }).catch(
      () => {},
    );
  }
}

async function maybePause(
  opts: ResolvedOptions,
  run: EvalRun,
): Promise<boolean> {
  if (!opts.pauseAfterFirst || !canPrompt(opts.yes)) {
    return true;
  }
  return await Confirm.prompt({
    message:
      `Continue ${run.checkoutLabel}/${run.flavor}/${run.agent} after first phase?`,
    default: true,
  });
}

async function runOne(params: {
  agent: Agent;
  checkout: EvalTarget;
  flavor: Flavor;
  opts: ResolvedOptions;
  root: string;
  runStamp: string;
}): Promise<EvalRun> {
  const info = await checkoutInfo(params.checkout.path);
  const resultDir = join(
    params.opts.resultsRoot,
    `${params.runStamp}-${
      slug(params.checkout.label)
    }-${params.agent}-${params.flavor}-${info.sha}`,
  );
  const run: EvalRun = {
    agent: params.agent,
    bootstrapped: false,
    checkout: params.checkout.path,
    checkoutLabel: params.checkout.label,
    continuation: null,
    errors: [],
    first: null,
    fixture: "",
    fixtureCleaned: false,
    flavor: params.flavor,
    resultDir,
    resumes: [],
  };

  let fixture: FixtureResult | undefined;
  try {
    fixture = await createFixture(
      params.root,
      params.flavor,
      params.opts.withDocs,
    );
    run.fixture = fixture.path;
    console.log(
      `→ ${params.checkout.label}/${params.flavor}/${params.agent}: first phase`,
    );
    run.first = await runAgentPhase({
      agent: params.agent,
      agentModel: params.opts.agentModels[params.agent],
      checkout: params.checkout.path,
      docsAnswer: params.opts.docsAnswer,
      extraArgs: params.opts.extraArgs[params.agent],
      fixture: fixture.path,
      modelId: params.opts.modelIds[params.agent],
      phase: "first",
      resultDir,
      root: params.root,
    });
    if ((run.first?.exitCode ?? 1) !== 0) {
      run.errors.push(`first phase exited ${run.first?.exitCode}`);
      return run;
    }

    if (!await maybePause(params.opts, run)) {
      run.errors.push("continuation skipped by operator");
      return run;
    }

    console.log(
      `→ ${params.checkout.label}/${params.flavor}/${params.agent}: continuation phase`,
    );
    run.continuation = await runAgentPhase({
      agent: params.agent,
      agentModel: params.opts.agentModels[params.agent],
      checkout: params.checkout.path,
      docsAnswer: params.opts.docsAnswer,
      extraArgs: params.opts.extraArgs[params.agent],
      fixture: fixture.path,
      modelId: params.opts.modelIds[params.agent],
      phase: "continue",
      resultDir,
      root: params.root,
    });
    if ((run.continuation?.exitCode ?? 1) !== 0) {
      run.errors.push(
        `continuation phase exited ${run.continuation?.exitCode}`,
      );
      return run;
    }

    // The turn count is the agent's, not the harness's: an agent that honors the
    // brief's discovery batch (or any genuine mid-setup question) ends its turn
    // waiting for an answer. Nudge it with a generic keep-going turn until setup is
    // genuinely complete — derived from the fixture's own discern.toml, never from
    // transcript text — up to a small cap. The resume count is itself data.
    run.bootstrapped = await fixtureBootstrapped(fixture.path);
    for (
      let attempt = 1;
      !run.bootstrapped && attempt <= MAX_RESUME_TURNS;
      attempt++
    ) {
      console.log(
        `→ ${params.checkout.label}/${params.flavor}/${params.agent}: resume ${attempt} (setup not complete yet)`,
      );
      const resume = await runAgentPhase({
        agent: params.agent,
        agentModel: params.opts.agentModels[params.agent],
        attempt,
        checkout: params.checkout.path,
        docsAnswer: params.opts.docsAnswer,
        extraArgs: params.opts.extraArgs[params.agent],
        fixture: fixture.path,
        modelId: params.opts.modelIds[params.agent],
        phase: "resume",
        resultDir,
        root: params.root,
      });
      run.resumes.push(resume);
      if (resume.exitCode !== 0) {
        run.errors.push(`resume ${attempt} exited ${resume.exitCode}`);
        break;
      }
      run.bootstrapped = await fixtureBootstrapped(fixture.path);
    }
    if (!run.bootstrapped && run.errors.length === 0) {
      run.errors.push(
        `setup did not complete within ${MAX_RESUME_TURNS} resume turn(s) — grade the transcripts to see where it stalled`,
      );
    }
  } catch (error) {
    run.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (fixture !== undefined && !params.opts.keepFixtures) {
      run.fixtureCleaned = await cleanupFixture(fixture.path);
    }
  }

  return run;
}

function planLines(
  raw: RawOptions,
  opts: ResolvedOptions,
  targets: readonly EvalTarget[],
): string[] {
  return [
    "Setup eval plan",
    "",
    `Checkouts: ${
      targets.map((target) => `${target.label} (${target.path})`).join(", ")
    }`,
    `Agents: ${opts.agents.join(", ")}`,
    `Fixtures: ${opts.flavors.join(", ")}${
      opts.withDocs ? " with docs/" : " without docs/"
    }`,
    `Baseline ref: ${raw.baselineSha}`,
    `Results: ${opts.resultsRoot}`,
    `Cleanup fixtures: ${opts.keepFixtures ? "no" : "yes"}`,
    `Cleanup managed checkouts: ${opts.keepCheckouts ? "no" : "yes"}`,
    "",
    `Total runs: ${targets.length * opts.agents.length * opts.flavors.length}`,
  ];
}

function dryRunTargets(
  root: string,
  raw: RawOptions,
  opts: ResolvedOptions,
): EvalTarget[] {
  const targets: EvalTarget[] = [];
  if (opts.includeCurrent) {
    targets.push({
      cleanupParent: undefined,
      kind: "current",
      label: "current",
      managed: false,
      path: resolve(raw.changedCheckout ?? root),
    });
  }
  if (opts.includeBaseline) {
    targets.push({
      cleanupParent: undefined,
      kind: "baseline",
      label: `baseline-${slug(raw.baselineSha)}`,
      managed: false,
      path: `(managed checkout for ${raw.baselineSha})`,
    });
  }
  return targets;
}

async function writeSummary(
  opts: ResolvedOptions,
  startedAt: Date,
  runs: EvalRun[],
): Promise<EvalSummary> {
  await Deno.mkdir(opts.resultsRoot, { recursive: true });
  const summaryFile = join(
    opts.resultsRoot,
    `${stamp(startedAt)}-summary.json`,
  );
  const failures = runs.filter((run) => run.errors.length > 0).length;
  const summary: EvalSummary = {
    endedAt: new Date().toISOString(),
    failures,
    resultsRoot: opts.resultsRoot,
    runs,
    startedAt: startedAt.toISOString(),
    summaryFile,
  };
  await Deno.writeTextFile(
    summaryFile,
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  const markdown = [
    "# Setup Eval Summary",
    "",
    `Started: ${summary.startedAt}`,
    `Ended: ${summary.endedAt}`,
    `Failures: ${failures}/${runs.length}`,
    "",
    "| Checkout | Flavor | Agent | Result | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...runs.map((run) => {
      const note = run.errors.length > 0
        ? run.errors.join("<br>")
        : run.resumes.length > 0
        ? `ok (${run.resumes.length} resume turn(s))`
        : "ok";
      return `| ${run.checkoutLabel} | ${run.flavor} | ${run.agent} | \`${run.resultDir}\` | ${note} |`;
    }),
    "",
    `Grade the saved transcripts with \`${join(SCRIPT_DIR, "rubric.md")}\`.`,
    "",
  ].join("\n");
  await Deno.writeTextFile(
    summaryFile.replace(/\.json$/, ".md"),
    markdown,
  );
  return summary;
}

async function main(): Promise<void> {
  const raw = parseArgs(Deno.args);
  if (raw.help) {
    console.log(usage());
    return;
  }

  const root = await repoRoot();
  const opts = await resolveOptions(raw);
  const targets = raw.dryRun
    ? dryRunTargets(root, raw, opts)
    : await resolveTargets(root, raw, opts);
  if (targets.length === 0) {
    throw new Error("choose at least one checkout to evaluate");
  }

  console.log(planLines(raw, opts, targets).join("\n"));
  if (opts.dryRun) {
    return;
  }
  if (canPrompt(opts.yes)) {
    const proceed = await Confirm.prompt({
      message: "Run this setup eval now?",
      default: true,
    });
    if (!proceed) return;
  }

  const startedAt = new Date();
  const runStamp = stamp(startedAt);
  const runs: EvalRun[] = [];
  try {
    for (const target of targets) {
      for (const flavor of opts.flavors) {
        for (const agent of opts.agents) {
          const run = await runOne({
            agent,
            checkout: target,
            flavor,
            opts,
            root,
            runStamp,
          });
          runs.push(run);
          if (opts.stopOnFailure && run.errors.length > 0) {
            throw new Error("stopping after first failed eval run");
          }
        }
      }
    }
  } finally {
    if (!opts.keepCheckouts) {
      for (const target of targets) {
        await cleanupBaseline(root, target);
      }
    }
  }

  const summary = await writeSummary(opts, startedAt, runs);
  console.log("");
  console.log(`Summary: ${summary.summaryFile}`);
  console.log(`Markdown: ${summary.summaryFile.replace(/\.json$/, ".md")}`);
  console.log(`Failures: ${summary.failures}/${summary.runs.length}`);
  if (summary.failures > 0) {
    Deno.exit(1);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(usage());
    Deno.exit(1);
  }
}
