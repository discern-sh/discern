/** One coherent, built-from-source cold setup through activation and first worktree. */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { decodeBase64 } from "@std/encoding/base64";
import { join } from "@std/path";
import { TomlEditor, tomlString } from "../src/lib/toml_edit.ts";
import { writeDiscernToml } from "../src/lib/tidy_format.ts";
import {
  SETUP_PAGE_REGISTRY,
  SETUP_RESULT_MAX_CHARS,
} from "../src/shared/setup_pages.ts";
import { SETUP_BRANCH } from "../src/shared/setup_state.ts";
import { conventionalSetupGotchasDoc } from "../src/shared/setup_checks.ts";
import { providerFor } from "../src/lib/providers.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import {
  ProofNotePayloadSchema,
  ProofNoteSchema,
} from "../src/shared/result_schemas.ts";
import { withTempDir } from "./helpers.ts";
import {
  assertResultDataKey,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";
import { git, gitOut } from "./engine_helpers.ts";
import {
  ColdSetupHarness,
  coldShellQuote,
  countedColdJob,
} from "./fixtures/cold_setup_harness.ts";

/** Count one value in a command-order log. */
function occurrences(items: readonly string[], value: string): number {
  return items.filter((item) => item === value).length;
}

/** Assert each first/second formatter pair retained declared order. */
function assertFormatterOrder(items: readonly string[]): void {
  const formatEntries = items.filter((item) => item.startsWith("format-"));
  assertEquals(formatEntries.length % 2, 0);
  for (let index = 0; index < formatEntries.length; index += 2) {
    assertEquals(formatEntries.slice(index, index + 2), [
      "format-project",
      "format-discern",
    ]);
  }
}

/** Read the canonical presentation line from a durable landed Proof note. */
function landedProofLine(note: string): string {
  const envelope = decodeWith(ProofNoteSchema, note);
  const payloadText = new TextDecoder().decode(decodeBase64(envelope.payload));
  return decodeWith(ProofNotePayloadSchema, payloadText).presentation.line;
}

Deno.test("cold setup composes consent, authoring, Proof replay, landing, activation, and a first effort", async () => {
  await withTempDir(async (root) => {
    await withTempDir(async (externalRoot) => {
      await withTempDir(async (resourceRoot) => {
        const externalSecret = join(externalRoot, "owner-data.txt");
        await Deno.writeTextFile(externalSecret, "outside-private-content\n");
        const harness = new ColdSetupHarness(root, resourceRoot);
        await harness.initialize(externalSecret);
        const initial = await harness.snapshot();
        const aggregate = await Deno.readTextFile(join(root, "deno.json"));

        const welcome = await harness.run(["setup", "--json"]);
        assertEquals(welcome.code, 0, welcome.output);
        const welcomeResult = decodeCliResult(welcome.stdout, "setup");
        assertResultDataKey(welcomeResult, "phase");
        assertEquals(welcomeResult.data.phase, "fresh");
        assertEquals(await harness.snapshot(), initial);

        const verify = await harness.run(["setup", "verify", "--json"]);
        assertEquals(verify.code, 0, verify.output);
        const verifyResult = decodeCliResult(verify.stdout, "setup verify");
        assertResultDataKey(verifyResult, "phase");
        assertEquals(verifyResult.data.phase, "fresh");
        assertEquals(
          verifyResult.data.findings?.project_identity.proposed_name,
          "Atlas",
        );
        assertEquals(
          verifyResult.data.findings?.project_identity.requires_confirmation,
          true,
        );
        assertStringIncludes(verifyResult.data.next_action, "--name 'Atlas'");
        assertStringIncludes(verifyResult.data.next_action, "--confirmed");
        assertEquals(await harness.snapshot(), initial);

        const unconfirmed = await harness.run([
          "setup",
          "begin",
          "--name",
          "Atlas",
          "--model",
          "unreported",
          "--agents",
          "codex",
          "--json",
        ]);
        assertEquals(unconfirmed.code, 1, unconfirmed.output);
        assertEquals(
          decodeCliResult(unconfirmed.stdout, "setup begin").error,
          "awaiting_consent",
        );
        assertEquals(await harness.snapshot(), initial);

        const begun = await harness.run([
          "setup",
          "begin",
          "--name",
          "Atlas",
          "--model",
          "unreported",
          "--agents",
          "codex",
          "--confirmed",
          "--json",
        ]);
        assertEquals(begun.code, 0, begun.output);
        const beginResult = decodeCliResult(begun.stdout, "setup begin");
        assertResultDataKey(beginResult, "complete");
        assertEquals(beginResult.data.complete, false);
        assertEquals(beginResult.data.branch, SETUP_BRANCH);
        assertEquals(beginResult.data.page?.step, SETUP_PAGE_REGISTRY[0]?.step);
        assert(
          !beginResult.data.instructions?.includes("## Step 1 —"),
          "begin must serve only the current page",
        );
        const begunConfig = parseConfigOrThrow(
          await Deno.readTextFile(join(root, "discern.toml")),
        );
        assertEquals(begunConfig.project.name, "Atlas");
        assertEquals(begunConfig.meta.setup_model, "unreported");

        for (const page of SETUP_PAGE_REGISTRY.slice(1)) {
          const step = await harness.run([
            "setup",
            "step",
            String(page.step),
            "--json",
          ]);
          assertEquals(step.code, 0, step.output);
          const result = decodeCliResult(step.stdout, "setup step");
          assertResultDataKey(result, "step");
          assertEquals(result.data.step, page.step);
          assertEquals(result.data.spine.next_action, page.nextCommand);
        }

        const mapRoot = join(root, "discern", "map");
        for await (const entry of Deno.readDir(mapRoot)) {
          if (entry.name !== "_internal") {
            await Deno.remove(join(mapRoot, entry.name), { recursive: true });
          }
        }
        await Deno.writeTextFile(
          join(mapRoot, "README.md"),
          "# Atlas map\n\nStart with [Runtime](10-runtime/README.md), then read " +
            "[Storage](20-storage/README.md) and [Interface](30-interface/README.md).\n",
        );
        const regions = [
          [
            "10-runtime",
            "Runtime",
            "Begin at `main.ts` and `main_test.ts`.",
            "The runtime owns command execution and exit status.",
            "Every command returns the child process status.",
          ],
          [
            "20-storage",
            "Storage",
            "Begin at `fixtures/tracked.db` and `runtime.sqlite`.",
            "Tracked fixture data is distinct from ignored local runtime data.",
            "Setup never copies ignored database content into committed files.",
          ],
          [
            "30-interface",
            "Interface",
            "Begin at `README.md` and `deno.json`.",
            "The command-line surface owns the public project workflow.",
            "The existing aggregate check remains the project's authority.",
          ],
        ] as const;
        for (const [slug, title, start, boundary, invariant] of regions) {
          await Deno.mkdir(join(mapRoot, slug), { recursive: true });
          await Deno.writeTextFile(
            join(mapRoot, slug, "README.md"),
            `# ${title}\n\n## Start here\n\n${start}\n\n` +
              `## Boundary\n\n${boundary}\n\n` +
              `## Non-obvious invariant\n\n${invariant}\n`,
          );
        }
        await Deno.mkdir(join(mapRoot, "development"), { recursive: true });
        await Deno.writeTextFile(
          join(mapRoot, "development", "done-gate-gotchas.md"),
          "# Gate gotchas\n\nThe local fixture is offline. Follow the first Gate diagnostic.\n",
        );
        await Deno.writeTextFile(
          join(root, "discern", "instructions.md"),
          "# Atlas project instructions\n\nAtlas is a small offline command-line fixture. " +
            "Read the [runtime map](map/10-runtime/README.md) before changing execution.\n\n" +
            "## Conventions\n\nPreserve the existing aggregate task and keep every test hermetic.\n",
        );
        await Deno.writeTextFile(
          join(root, "discern", "TODO.md"),
          "# Open work\n\n- [ ] **Exercise a second project type.** Evidence: the owner-run cold-setup matrix.\n",
        );
        await Deno.writeTextFile(
          join(root, "main_test.ts"),
          'import { answer } from "./main.ts";\n\nDeno.test("answer", () => {\n  if (answer.value !== 42) throw new Error("wrong answer");\n});\n',
        );
        await Deno.writeTextFile(
          join(root, "smoke.ts"),
          'import { answer } from "./main.ts";\nif (answer.value !== 42) throw new Error("smoke failed");\n',
        );

        const jobCommands: readonly [string, readonly string[]][] = [
          [
            "format",
            [
              countedColdJob(
                "format-project",
                "deno fmt main.ts main_test.ts smoke.ts",
              ),
              countedColdJob("format-discern", "discern tidy"),
            ],
          ],
          ["lint", [
            countedColdJob("lint", "deno lint main.ts main_test.ts smoke.ts"),
          ]],
          [
            "typecheck",
            [
              countedColdJob(
                "typecheck",
                "deno check main.ts main_test.ts smoke.ts",
              ),
            ],
          ],
          ["test", [countedColdJob("test", "deno test main_test.ts")]],
          ["smoke", [countedColdJob("smoke", "deno run smoke.ts")]],
        ];
        for (const [name, commands] of jobCommands) {
          const configured = await harness.run([
            "config",
            "set-job",
            name,
            ...commands.flatMap((command) => ["--run", command]),
            "--json",
          ]);
          assertEquals(configured.code, 0, configured.output);
        }
        const inapplicable = await harness.run([
          "config",
          "set-job",
          "build",
          "--not-applicable",
          "--json",
        ]);
        assertEquals(inapplicable.code, 0, inapplicable.output);
        const gotchasDoc = conventionalSetupGotchasDoc("discern/map");
        const gotchas = await harness.run([
          "config",
          "set",
          "project.gotchas_doc",
          gotchasDoc,
          "--json",
        ]);
        assertEquals(gotchas.code, 0, gotchas.output);

        const configPath = join(root, "discern.toml");
        const editor = new TomlEditor(await Deno.readTextFile(configPath));
        editor.setStringArray("worktree.inherit_env", ["COLD_TOKEN"]);
        const create = `mkdir -p ${coldShellQuote(resourceRoot)} && touch ${
          coldShellQuote(join(resourceRoot, "@resource@.live"))
        }`;
        const destroy = `rm -f ${
          coldShellQuote(join(resourceRoot, "@resource@.live"))
        }`;
        const configuredText = editor.toString().split("\n").filter((line) =>
          !/^#\s+(build|lint|typecheck|test|smoke)\s*=/.test(line)
        ).join("\n");
        await writeDiscernToml(
          configPath,
          `${configuredText}\n[worktree.resources.cold_db]\n` +
            `create = ${tomlString(create)}\n` +
            `destroy = ${tomlString(destroy)}\n`,
        );
        const refreshed = await harness.run(["refresh", "--json"]);
        assertEquals(refreshed.code, 0, refreshed.output);

        const doctor = await harness.run(["doctor", "--json"]);
        assertEquals(doctor.code, 0, doctor.output);
        const beforePrepare = await harness.jobLog();
        const prepared = await harness.run(["prepare", "--json"]);
        assertEquals(prepared.code, 0, prepared.output);
        const afterPrepare = await harness.jobLog();
        assert(afterPrepare.length > beforePrepare.length);
        assertEquals(
          await Deno.readTextFile(join(root, "main.ts")),
          "export const answer = { value: 42 };\n",
        );
        assertFormatterOrder(afterPrepare.slice(beforePrepare.length));
        await git(root, "add", "-A");
        await git(
          root,
          "commit",
          "-q",
          "-m",
          "Author substantive discern setup",
          "--no-gpg-sign",
        );

        const beforeDone = await harness.snapshot();
        const done = await harness.run(["setup", "done", "--json"]);
        assertEquals(done.code, 0, done.output);
        const doneResult = decodeCliResult(done.stdout, "setup done");
        assertResultDataKey(doneResult, "bootstrapped");
        assertEquals(doneResult.data.completion, "created");
        assertExists(doneResult.data.proof_line);
        assertEquals(doneResult.data.assurance.total, 5);
        assertEquals(doneResult.data.assurance.enforced, 5);
        assertEquals(doneResult.data.assurance.not_applicable, 1);
        assertEquals(doneResult.data.inventory.map_regions.items, [
          "10-runtime",
          "20-storage",
          "30-interface",
          "development",
        ]);
        const completed = await harness.snapshot();
        assert(completed.config?.includes("bootstrapped = true"));
        assertEquals(completed.head, doneResult.data.proof?.head);
        assertEquals(doneResult.data.proof?.status, "honored");
        assertStringIncludes(completed.proof ?? "", completed.head);
        assertEquals(completed.resourceResidue, []);
        const doneJobs = completed.jobLog.slice(beforeDone.jobLog.length);
        for (
          const name of [
            "format-project",
            "format-discern",
            "lint",
            "typecheck",
            "test",
            "smoke",
          ]
        ) {
          assertEquals(occurrences(doneJobs, name), 2, `${name} Gate count`);
        }
        assertFormatterOrder(doneJobs);

        const deliberatelyTruncated = done.stdout.slice(0, 160);
        assertThrows(
          () => decodeCliResult(deliberatelyTruncated, "setup done"),
          Error,
          "Could not decode",
        );
        const replay = await harness.run(["setup", "done", "--json"]);
        assertEquals(replay.code, 0, replay.output);
        const replayResult = decodeCliResult(replay.stdout, "setup done");
        assertResultDataKey(replayResult, "bootstrapped");
        assertEquals(replayResult.data.completion, "replayed");
        assertEquals(replayResult.data.effects_performed, false);
        assertEquals(replayResult.data.gate_ran, false);
        assertEquals(replayResult.data.proof_line, doneResult.data.proof_line);
        assertEquals(replayResult.data.inventory, doneResult.data.inventory);
        assertEquals(replayResult.data.landing, doneResult.data.landing);
        assertEquals(await harness.snapshot(), completed);

        const accepted = await harness.run(["setup", "accept", "--json"]);
        assertEquals(accepted.code, 0, accepted.output);
        const acceptedResult = decodeCliResult(accepted.stdout, "setup accept");
        assertResultDataKey(acceptedResult, "landed");
        assertEquals(acceptedResult.data.landed, true);
        assertEquals(
          acceptedResult.data.proof_line,
          doneResult.data.proof_line,
        );
        assertEquals(acceptedResult.data.validated_commit, completed.head);
        assertEquals(await gitOut(root, "branch", "--show-current"), "main");
        const landed = await harness.snapshot();
        assertExists(landed.proofNote);
        assertEquals(
          landedProofLine(landed.proofNote),
          doneResult.data.proof_line,
        );
        assertEquals(landed.resourceResidue, []);

        const codex = providerFor("codex");
        assertExists(codex);
        const activation = acceptedResult.data.reactivation?.per_agent.find(
          (entry: { agent: string }) => entry.agent === "codex",
        );
        assertExists(activation);
        assertEquals(activation.check, codex.activation.callable);
        const prefix = "mcp__discern__";
        assert(activation.check.startsWith(prefix));
        const localTool = activation.check.slice(prefix.length);
        const fresh = await harness.callFreshMcp(localTool);
        assert(fresh.tools.includes(localTool));
        assertEquals(fresh.structuredContent.ok, true);
        assertEquals(fresh.structuredContent.verb, "status");

        const status = await harness.run(["status", "--json"]);
        assertEquals(status.code, 0, status.output);
        const statusResult = decodeCliResult(status.stdout, "status");
        assertResultDataKey(statusResult, "location");
        assertEquals(statusResult.data.pending_tracked_refresh, undefined);
        assertEquals(
          await Deno.readTextFile(join(root, "deno.json")),
          aggregate,
        );
        assertEquals(await gitOut(root, "diff", "--check"), "");
        assertEquals(await gitOut(root, "status", "--porcelain=v1"), "");
        assertEquals(
          await gitOut(root, "rev-parse", "foreign/keep"),
          initial.head,
        );
        const generated = await Deno.readTextFile(join(root, "AGENTS.md"));
        assertStringIncludes(generated, "discern/map/10-runtime/README.md");
        assert(await targetExists(join(root, "discern", "map", "_internal")));
        assert(
          await targetExists(
            join(root, "discern", "map", "_internal", "scopes", "_template.md"),
          ),
        );
        assertEquals(
          (await Deno.readTextFile(configPath)).includes(
            '# smoke = "your-app --version"',
          ),
          false,
        );

        const tracked = (await gitOut(root, "ls-files", "-z")).split("\0")
          .filter(Boolean);
        for (const path of tracked) {
          const bytes = await Deno.readFile(join(root, path));
          const text = new TextDecoder().decode(bytes);
          assert(
            !text.includes("fixture-private-value"),
            `${path} leaked .env`,
          );
          assert(
            !text.includes("outside-private-content"),
            `${path} leaked external data`,
          );
        }
        assertEquals(
          await Deno.readTextFile(externalSecret),
          "outside-private-content\n",
        );

        const started = await harness.run([
          "start",
          "--name",
          "first-effort",
          "--json",
        ]);
        assertEquals(started.code, 0, started.output);
        const startedResult = decodeCliResult(started.stdout, "start");
        assertResultDataKey(startedResult, "path");
        const effortPath = startedResult.data.path;
        assert(await targetExists(effortPath));
        const effortDone = await harness.runAt(effortPath, ["done", "--json"]);
        assertEquals(effortDone.code, 0, effortDone.output);
        const effortDoneResult = decodeCliResult(effortDone.stdout, "done");
        assertEquals(effortDoneResult.ok, true);
        assertResultDataKey(effortDoneResult, "failed_stage");
        assertEquals(effortDoneResult.data.failed_stage, null);
        assertEquals(effortDoneResult.data.gate_ran, true);
        const dropped = await harness.run([
          "worktree",
          "drop",
          startedResult.data.id,
          "--json",
        ]);
        assertEquals(dropped.code, 0, dropped.output);
        assertEquals(await targetExists(effortPath), false);
        const finalStatus = await harness.run(["status", "--json"]);
        assertEquals(finalStatus.code, 0, finalStatus.output);
        assertEquals(await gitOut(root, "status", "--porcelain=v1"), "");
        assertEquals((await harness.snapshot()).resourceResidue, []);
        const outputBytes = harness.invocations.reduce(
          (total, invocation) =>
            total + invocation.stdoutBytes + invocation.stderrBytes,
          0,
        );
        const largestOutputBytes = Math.max(
          ...harness.invocations.map((invocation) =>
            invocation.stdoutBytes + invocation.stderrBytes
          ),
        );
        assert(
          outputBytes <= SETUP_RESULT_MAX_CHARS * 8,
          `cold journey emitted ${outputBytes} bytes across ${harness.invocations.length} calls: ${
            JSON.stringify(harness.invocations)
          }`,
        );
        assert(
          largestOutputBytes <= SETUP_RESULT_MAX_CHARS,
          `largest cold-journey result was ${largestOutputBytes} bytes`,
        );
      });
    });
  });
});
