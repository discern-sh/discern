/**
 * Headless runner for clean-room setup eval transcripts.
 *
 * It creates the same kind of `discern` PATH shim the engine tests use, but the
 * shim points at a chosen checkout so an operator can compare a baseline SHA
 * against the current working tree.
 */

import { dirname, fromFileUrl, join, resolve } from "@std/path";

type Agent = "claude" | "codex";
type Phase = "first" | "continue" | "resume";

interface Options {
  agent: Agent | undefined;
  agentModel: string | undefined;
  /** Which resume turn this is (1-based); only meaningful for `--phase resume`. */
  attempt: number;
  discernCheckout: string | undefined;
  extraArgs: string[];
  fixture: string | undefined;
  help: boolean;
  json: boolean;
  modelId: string | undefined;
  phase: Phase;
  resultDir: string | undefined;
  sessionId: string | undefined;
}

interface AgentCommand {
  args: string[];
  command: string;
  stdin: string | undefined;
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
  phase: Phase;
  promptFile: string;
  resultDir: string;
  sessionId: string | null;
  startedAt: string;
  stderrBytes: number;
  stderrFile: string;
  stdoutBytes: number;
  stdoutFile: string;
}

const DECODER = new TextDecoder();
const ENCODER = new TextEncoder();

const GIT_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
};

function usage(): string {
  return `Usage:
  deno run --allow-read --allow-write --allow-env --allow-run scripts/setup-eval/run-agent.ts --agent <claude|codex> --fixture <repo> --discern-checkout <checkout> [options]

Options:
  --phase <first|continue|resume>  The first consent turn, the continuation, or a
                                 generic keep-going nudge for a session that paused
                                 mid-setup to ask a question (default: first)
  --attempt <n>                  Which resume turn this is, 1-based (default: 1)
  --result-dir <path>            Reuse a result directory; required for --phase continue/resume
  --agent-model <model>          Pass a model flag to the agent CLI
  --model-id <id>                Human answer for setup's --model question
  --session-id <id>              Resume a specific agent session when supported
  --extra-agent-arg <arg>        Append one raw argument to the agent CLI; repeat as needed
  --json                         Print the run record as JSON
  -h, --help                     Show this help
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

function parseAgent(value: string): Agent {
  if (value === "claude" || value === "codex") {
    return value;
  }
  throw new Error(`unknown agent "${value}"`);
}

function parsePhase(value: string): Phase {
  if (value === "first" || value === "continue" || value === "resume") {
    return value;
  }
  throw new Error(`unknown phase "${value}"`);
}

function parseArgs(args: readonly string[]): Options {
  let agent: Agent | undefined;
  let agentModel: string | undefined;
  let discernCheckout: string | undefined;
  let fixture: string | undefined;
  let help = false;
  let json = false;
  let attempt = 1;
  let modelId: string | undefined;
  let phase: Phase = "first";
  let resultDir: string | undefined;
  let sessionId: string | undefined;
  const extraArgs: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--agent") {
      const parsed = valueAfter(args, index, arg);
      agent = parseAgent(parsed.value);
      index = parsed.next;
    } else if (arg === "--fixture") {
      const parsed = valueAfter(args, index, arg);
      fixture = parsed.value;
      index = parsed.next;
    } else if (arg === "--discern-checkout") {
      const parsed = valueAfter(args, index, arg);
      discernCheckout = parsed.value;
      index = parsed.next;
    } else if (arg === "--phase") {
      const parsed = valueAfter(args, index, arg);
      phase = parsePhase(parsed.value);
      index = parsed.next;
    } else if (arg === "--attempt") {
      const parsed = valueAfter(args, index, arg);
      attempt = Number.parseInt(parsed.value, 10);
      if (!Number.isInteger(attempt) || attempt < 1) {
        throw new Error(
          `--attempt must be a positive integer, got "${parsed.value}"`,
        );
      }
      index = parsed.next;
    } else if (arg === "--result-dir") {
      const parsed = valueAfter(args, index, arg);
      resultDir = parsed.value;
      index = parsed.next;
    } else if (arg === "--agent-model") {
      const parsed = valueAfter(args, index, arg);
      agentModel = parsed.value;
      index = parsed.next;
    } else if (arg === "--model-id") {
      const parsed = valueAfter(args, index, arg);
      modelId = parsed.value;
      index = parsed.next;
    } else if (arg === "--session-id") {
      const parsed = valueAfter(args, index, arg);
      sessionId = parsed.value;
      index = parsed.next;
    } else if (arg === "--extra-agent-arg") {
      const parsed = valueAfter(args, index, arg);
      extraArgs.push(parsed.value);
      index = parsed.next;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--") {
      continue;
    } else if (arg === "-h" || arg === "--help") {
      help = true;
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }

  return {
    agent,
    agentModel,
    attempt,
    discernCheckout,
    extraArgs,
    fixture,
    help,
    json,
    modelId,
    phase,
    resultDir,
    sessionId,
  };
}

async function assertDirectory(path: string, label: string): Promise<void> {
  const info = await Deno.stat(path).catch(() => undefined);
  if (info === undefined || !info.isDirectory) {
    throw new Error(`${label} is not a directory: ${path}`);
  }
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const command = new Deno.Command("git", {
    args,
    cwd,
    env: GIT_ENV,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  if (code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed:\n${DECODER.decode(stderr)}`,
    );
  }
  return DECODER.decode(stdout).trim();
}

async function checkoutInfo(
  checkout: string,
): Promise<{ dirty: boolean; sha: string }> {
  const sha = await gitOutput(checkout, ["rev-parse", "--short=12", "HEAD"]);
  const status = await gitOutput(checkout, ["status", "--porcelain"]);
  return { dirty: status.length > 0, sha };
}

function stamp(date: Date): string {
  const withoutMs = date.toISOString().replace(/\.\d{3}Z$/, "Z");
  return withoutMs
    .replaceAll("-", "")
    .replace("T", "-")
    .replaceAll(":", "");
}

function defaultResultDir(agent: Agent, sha: string): string {
  const here = dirname(fromFileUrl(import.meta.url));
  return join(here, "results", `${stamp(new Date())}-${agent}-${sha}`);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function writeShim(resultDir: string, checkout: string): Promise<string> {
  const binDir = join(resultDir, "bin");
  await Deno.mkdir(binDir, { recursive: true });
  const shim = join(binDir, "discern");
  const denoJson = join(checkout, "deno.json");
  const mainTs = join(checkout, "src", "main.ts");
  await Deno.writeTextFile(
    shim,
    `#!/usr/bin/env sh
exec deno run --no-check --config ${shellQuote(denoJson)} -A ${
      shellQuote(mainTs)
    } "$@"
`,
  );
  await Deno.chmod(shim, 0o755);
  return binDir;
}

/**
 * The scripted user turns simulate a PLAUSIBLE NOVICE, nothing more. They must
 * never name a behavior the rubric grades (explaining discern, relaying setup
 * messages, narrating stages, atomic commits, running \`discern setup done\`,
 * the closing summary) — coaching any of those turns the eval into an
 * instruction-following test and erases the very deltas it exists to measure.
 * The one deliberate exception is the first turn's "ask me and then stop"
 * boundary, which headless runs need so phase one ends at the consent
 * conversation; the rubric grades the Wait row as necessary-but-not-sufficient
 * because of it.
 *
 * The resume prompt exists because the turn count is the AGENT's, not the
 * harness's: an agent that honors the brief's discovery batch (or any genuine
 * mid-setup question) ends its turn waiting for answers. The nudge is what a
 * permissive novice says to any such question — it decides nothing and coaches
 * nothing, so needing one is gradeable data, never a harness failure.
 */
function firstPrompt(): string {
  return `Run \`discern setup\` in this project.

If you need anything from me — a decision, a confirmation, an answer — ask me and then stop; I'll reply in my next message.`;
}

function resumePrompt(): string {
  return `Nothing more from me beyond what you've already seen — my earlier answers stand, and anything I didn't specify is your call. Please keep going.`;
}

function continuePrompt(modelId: string | undefined): string {
  const modelAnswer = modelId === undefined || modelId.trim() === ""
    ? "I don't know my exact model id, so skip recording it rather than guessing."
    : `if you need my model id, it is \`${modelId}\`.`;
  return `Yes — here are my answers:

- You are the most capable model I have; ${modelAnswer}
- If you asked anything about my existing docs or where documentation should go: keep my docs untouched, and put discern's map in its default home.
- The default worktree location is fine.
- I'm ready — go ahead and see the whole setup through.`;
}

function phaseStem(phase: Phase, attempt: number): string {
  if (phase === "first") {
    return "01-first";
  }
  if (phase === "continue") {
    return "02-continue";
  }
  // Resume turns number onward from the continuation: 03-resume-1, 04-resume-2, …
  return `${String(attempt + 2).padStart(2, "0")}-resume-${attempt}`;
}

async function sessionFromResultDir(
  resultDir: string,
): Promise<string | undefined> {
  const path = join(resultDir, "session-id.txt");
  try {
    return (await Deno.readTextFile(path)).trim();
  } catch {
    return undefined;
  }
}

function buildAgentCommand(params: {
  agent: Agent;
  agentModel: string | undefined;
  extraArgs: string[];
  fixture: string;
  lastMessageFile: string;
  phase: Phase;
  prompt: string;
  sessionId: string | undefined;
}): AgentCommand {
  const modelArgs = params.agentModel === undefined
    ? []
    : ["--model", params.agentModel];
  if (params.agent === "codex") {
    const common = [
      "--json",
      "--output-last-message",
      params.lastMessageFile,
      "--dangerously-bypass-approvals-and-sandbox",
      ...modelArgs,
      ...params.extraArgs,
    ];
    if (params.phase === "first") {
      return {
        args: [
          "exec",
          "--cd",
          params.fixture,
          ...common,
          "-",
        ],
        command: "codex",
        stdin: params.prompt,
      };
    }
    const resumeTarget = params.sessionId === undefined
      ? ["--last"]
      : [params.sessionId];
    return {
      args: [
        "exec",
        "resume",
        ...common,
        ...resumeTarget,
        "-",
      ],
      command: "codex",
      stdin: params.prompt,
    };
  }

  const common = [
    "-p",
    "--output-format=stream-json",
    "--include-partial-messages",
    "--include-hook-events",
    "--permission-mode",
    "bypassPermissions",
    "--verbose",
    ...modelArgs,
    ...params.extraArgs,
  ];
  if (params.phase === "first") {
    if (params.sessionId === undefined) {
      throw new Error("Claude first phase requires a session id");
    }
    return {
      args: [
        ...common,
        "--session-id",
        params.sessionId,
        params.prompt,
      ],
      command: "claude",
      stdin: undefined,
    };
  }
  if (params.sessionId === undefined) {
    throw new Error(
      "Claude continue phase needs --session-id or a session-id.txt from phase one",
    );
  }
  return {
    args: [
      ...common,
      "--resume",
      params.sessionId,
      params.prompt,
    ],
    command: "claude",
    stdin: undefined,
  };
}

async function writeStream(
  stream: ReadableStream<Uint8Array>,
  path: string,
): Promise<number> {
  const file = await Deno.open(path, {
    create: true,
    truncate: true,
    write: true,
  });
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      bytes += chunk.byteLength;
      await file.write(chunk);
    }
  } finally {
    file.close();
  }
  return bytes;
}

async function writeInput(
  child: Deno.ChildProcess,
  text: string,
): Promise<void> {
  const writer = child.stdin.getWriter();
  await writer.write(ENCODER.encode(text));
  await writer.close();
}

async function runCaptured(params: {
  command: AgentCommand;
  cwd: string;
  env: Record<string, string>;
  stderrFile: string;
  stdoutFile: string;
}): Promise<{
  elapsedMs: number;
  endedAt: Date;
  exitCode: number;
  startedAt: Date;
  stderrBytes: number;
  stdoutBytes: number;
}> {
  const startedAt = new Date();
  const started = performance.now();
  const command = new Deno.Command(params.command.command, {
    args: params.command.args,
    cwd: params.cwd,
    env: params.env,
    stdin: params.command.stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  const input = params.command.stdin === undefined
    ? Promise.resolve()
    : writeInput(child, params.command.stdin);
  const stdout = writeStream(child.stdout, params.stdoutFile);
  const stderr = writeStream(child.stderr, params.stderrFile);
  await input;
  const [status, stdoutBytes, stderrBytes] = await Promise.all([
    child.status,
    stdout,
    stderr,
  ]);
  const endedAt = new Date();
  return {
    elapsedMs: Math.round(performance.now() - started),
    endedAt,
    exitCode: status.code,
    startedAt,
    stderrBytes,
    stdoutBytes,
  };
}

function commandLine(
  env: Record<string, string>,
  command: AgentCommand,
): string {
  return [
    `PATH=${shellQuote(env.PATH ?? "")}`,
    shellQuote(command.command),
    ...command.args.map(shellQuote),
  ].join(" ");
}

async function writeIndex(resultDir: string, record: RunRecord): Promise<void> {
  const path = join(resultDir, "index.md");
  const block = `## ${record.phase} (${record.agent})

- Started: ${record.startedAt}
- Ended: ${record.endedAt}
- Elapsed: ${record.elapsedMs} ms
- Exit code: ${record.exitCode}
- Fixture: \`${record.fixture}\`
- Discern checkout: \`${record.discernCheckout}\` (${record.discernSha}${
    record.discernDirty ? ", dirty" : ""
  })
- Prompt: \`${record.promptFile}\`
- Stdout transcript: \`${record.stdoutFile}\`
- Stderr transcript: \`${record.stderrFile}\`

`;
  const existing = await Deno.readTextFile(path).catch(() =>
    "# Setup Eval Run\n\n"
  );
  await Deno.writeTextFile(path, existing + block);
}

async function main(): Promise<void> {
  const opts = parseArgs(Deno.args);
  if (opts.help) {
    console.log(usage());
    return;
  }
  if (opts.agent === undefined) {
    throw new Error("--agent is required");
  }
  if (opts.fixture === undefined) {
    throw new Error("--fixture is required");
  }
  if (opts.discernCheckout === undefined) {
    throw new Error("--discern-checkout is required");
  }
  if (opts.phase !== "first" && opts.resultDir === undefined) {
    throw new Error(`--result-dir is required for --phase ${opts.phase}`);
  }
  const fixture = resolve(opts.fixture);
  const checkoutPath = resolve(opts.discernCheckout);
  await assertDirectory(fixture, "fixture");
  await assertDirectory(checkoutPath, "discern checkout");

  const checkout = await checkoutInfo(checkoutPath);
  const resultDir = opts.resultDir === undefined
    ? defaultResultDir(opts.agent, checkout.sha)
    : resolve(opts.resultDir);
  await Deno.mkdir(resultDir, { recursive: true });

  const sessionId = opts.agent === "claude"
    ? opts.sessionId ??
      (opts.phase === "first"
        ? crypto.randomUUID()
        : await sessionFromResultDir(resultDir))
    : opts.sessionId;
  if (opts.agent === "claude" && sessionId !== undefined) {
    await Deno.writeTextFile(
      join(resultDir, "session-id.txt"),
      `${sessionId}\n`,
    );
  }

  const stem = phaseStem(opts.phase, opts.attempt);
  const prompt = opts.phase === "first"
    ? firstPrompt()
    : opts.phase === "continue"
    ? continuePrompt(opts.modelId)
    : resumePrompt();
  const promptFile = join(resultDir, `prompt-${stem}.md`);
  const stdoutFile = join(resultDir, `transcript-${stem}.stdout.jsonl`);
  const stderrFile = join(resultDir, `transcript-${stem}.stderr.log`);
  const commandFile = join(resultDir, `command-${stem}.sh`);
  const metadataFile = join(resultDir, `metadata-${stem}.json`);
  const lastMessageFile = join(resultDir, `last-message-${stem}.md`);
  await Deno.writeTextFile(promptFile, prompt);

  const shim = await writeShim(resultDir, checkoutPath);
  const env: Record<string, string> = {
    NO_COLOR: "1",
    PATH: `${shim}:${Deno.env.get("PATH") ?? ""}`,
    ...GIT_ENV,
  };
  const command = buildAgentCommand({
    agent: opts.agent,
    agentModel: opts.agentModel,
    extraArgs: opts.extraArgs,
    fixture,
    lastMessageFile,
    phase: opts.phase,
    prompt,
    sessionId,
  });
  await Deno.writeTextFile(
    commandFile,
    `#!/usr/bin/env sh
cd ${shellQuote(fixture)}
${commandLine(env, command)}
`,
  );
  await Deno.chmod(commandFile, 0o755);

  const timing = await runCaptured({
    command,
    cwd: fixture,
    env,
    stderrFile,
    stdoutFile,
  });

  const record: RunRecord = {
    agent: opts.agent,
    command: [command.command, ...command.args],
    cwd: fixture,
    discernCheckout: checkoutPath,
    discernDirty: checkout.dirty,
    discernSha: checkout.sha,
    elapsedMs: timing.elapsedMs,
    endedAt: timing.endedAt.toISOString(),
    exitCode: timing.exitCode,
    fixture,
    phase: opts.phase,
    promptFile,
    resultDir,
    sessionId: sessionId ?? null,
    startedAt: timing.startedAt.toISOString(),
    stderrBytes: timing.stderrBytes,
    stderrFile,
    stdoutBytes: timing.stdoutBytes,
    stdoutFile,
  };
  await Deno.writeTextFile(
    metadataFile,
    `${JSON.stringify(record, null, 2)}\n`,
  );
  await writeIndex(resultDir, record);

  if (opts.json) {
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  console.log(`Saved ${opts.agent} ${opts.phase} transcript:
  ${stdoutFile}

Result directory:
  ${resultDir}

Exit code: ${timing.exitCode}
Elapsed: ${timing.elapsedMs} ms`);
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
