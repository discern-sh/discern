/** Offline handoff, request-scoped effects, and direct clone-local reminder evidence. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  applyReleases,
  planReleases,
  type ReleaseInvocation,
  releasesResult,
} from "../src/commands/releases.ts";
import {
  DISCERN_VERSION,
  humanVersion,
  parseVersionOutput,
} from "../src/lib/version.ts";
import {
  parseDiscernVersion,
  versionMismatchHint,
} from "../src/engine/mcp/version_check.ts";
import { browserLaunch, openInBrowser } from "../src/lib/open_browser.ts";
import {
  inspectReleaseCheck,
  type ReleaseCheckRead,
  releaseReminderDue,
  writeReleaseCheck,
} from "../src/shared/release_check.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { fire, HINTS } from "../src/shared/hints.ts";
import { resultPresenterForVerb } from "../src/shared/result_contracts.ts";
import { renderResultReading } from "../src/shared/emit.ts";
import { statusResult } from "../src/engine/status/status.ts";
import { doctorResult } from "../src/commands/doctor.ts";
import { ReleasesOutputSchema } from "../src/shared/result_schemas.ts";
import { serializeResult } from "../src/shared/result_serialization.ts";
import { addWorktree, gitInit, scaffoldEngine } from "./engine_helpers.ts";
import { assertTerminalTextIncludes, runCli, withTempDir } from "./helpers.ts";

const first = Date.parse("2026-08-01T23:59:59Z");
const due = Date.parse("2026-08-15T00:00:00Z");
const record: ReleaseCheckRead = {
  status: "recorded",
  value: { schema_version: 1, first_seen_at: new Date(first).toISOString() },
};

Deno.test("release plans exhaust invocation modes without effects during planning or dry-run", async () => {
  for (const mode of ["cli", "json", "markdown", "desk"] as const) {
    for (const stdinTty of [false, true]) {
      for (const stdoutTty of [false, true]) {
        for (const dryRun of [false, true]) {
          const invocation = { mode, stdinTty, stdoutTty, dryRun };
          const plan = planReleases(invocation, {
            root: "/clone",
            state: record,
          }, { version: "7.8.1-rc.1+local", codename: "星の海" });
          assertEquals(
            new URL(plan.urls.html).searchParams.get("since"),
            "7.8.1-rc.1+local",
          );
          assertEquals(new URL(plan.urls.json).pathname, "/releases.json");
          assertEquals([...new URL(plan.urls.html).searchParams.keys()], [
            "since",
          ]);
          let writes = 0;
          let launches = 0;
          const result = await applyReleases(plan, {
            now: () => due,
            write: (_root, version, now) => {
              assertEquals(version, plan.version);
              assertEquals(now, due);
              writes++;
              return Promise.resolve({ status: "saved" });
            },
            open: async (url) => {
              launches++;
              return await openInBrowser(url, {
                os: "darwin",
                run: () =>
                  Promise.resolve({ success: true, code: 0, stderr: "" }),
              });
            },
          });
          assertEquals(writes, dryRun ? 0 : 1);
          assertEquals(
            launches,
            !dryRun &&
              (mode === "desk" || mode === "cli" && stdinTty && stdoutTty)
              ? 1
              : 0,
          );
          assertEquals(result.data?.network_request, false);
          assertEquals(result.data?.launch_attempted, launches === 1);
          const reading = renderResultReading(
            result,
            resultPresenterForVerb("releases"),
          );
          assertStringIncludes(
            reading,
            dryRun
              ? "Would open this page"
              : launches === 1
              ? "Opening release notes"
              : "See what's changed",
          );
          assert(!reading.includes("Navigation was not verified"));
          assert(
            ReleasesOutputSchema.safeParse(serializeResult(result)).success,
          );
        }
      }
    }
  }
});

Deno.test("UTC calendar interval refuses to invent age from unavailable, future, or invalid evidence", () => {
  assertEquals(releaseReminderDue(record, first), false);
  assertEquals(releaseReminderDue(record, due - 1), false);
  assertEquals(releaseReminderDue(record, due), true);
  assertEquals(releaseReminderDue(record, due + 1), true);
  assertEquals(releaseReminderDue(record, first - 1), false);
  assertEquals(releaseReminderDue(record, NaN), false);
  for (
    const read of [{ status: "missing" }, { status: "malformed" }, {
      status: "newer",
      reason: "future",
    }, { status: "unavailable", reason: "denied" }] as const
  ) assertEquals(releaseReminderDue(read, due), false);
  assert(record.status === "recorded");
  for (
    const first_seen_at of [
      "ancient",
      "2026-02-30T00:00:00Z",
      "2027-01-01T00:00:00Z",
    ]
  ) {
    assertEquals(
      releaseReminderDue({
        status: "recorded",
        value: { ...record.value, first_seen_at },
      }, due),
      false,
    );
  }
  assertEquals(
    releaseReminderDue({
      status: "recorded",
      value: {
        ...record.value,
        last_handoff_at: new Date(due).toISOString(),
        version_when_handed_off: DISCERN_VERSION,
      },
    }, due),
    false,
  );
});

Deno.test("release evidence shares linked checkouts, preserves future schemas, and tolerates corrupt or unwritable state", async () => {
  await withTempDir(async (root) => {
    assertEquals(
      (await writeReleaseCheck(root, undefined, first)).status,
      "unavailable",
    );
    await scaffoldEngine(root, { agents: [] });
    await gitInit(root);
    const path = await gitAdminStatePath(root, "releaseCheck");
    assert(path);
    assertEquals(
      (await writeReleaseCheck(root, undefined, first)).status,
      "saved",
    );
    assertEquals(
      (await writeReleaseCheck(root, undefined, due)).status,
      "unchanged",
    );
    assert(releaseReminderDue(await inspectReleaseCheck(root), due));
    const linked = await addWorktree(root, "release-sharing");
    assertEquals(
      await Deno.realPath(
        (await gitAdminStatePath(linked, "releaseCheck")) ?? "missing",
      ),
      await Deno.realPath(path),
    );
    assertEquals(
      (await writeReleaseCheck(linked, "7.8.1", due)).status,
      "saved",
    );
    assertEquals(
      releaseReminderDue(await inspectReleaseCheck(root), due),
      false,
    );
    const read = await inspectReleaseCheck(root);
    assert(read.status === "recorded");
    assertEquals(read.value.first_seen_at, new Date(first).toISOString());
    assertEquals(read.value.version_when_handed_off, "7.8.1");
    const future = '{"schema_version":999,"unknown":"preserve"}\n';
    await Deno.writeTextFile(path, future);
    for (const version of [undefined, "7.8.1"]) {
      assertEquals(
        (await writeReleaseCheck(root, version, due)).status,
        "newer",
      );
    }
    assertEquals(await Deno.readTextFile(path), future);
    await Deno.writeTextFile(path, "broken");
    assertEquals((await inspectReleaseCheck(root)).status, "malformed");
    assertEquals(
      (await writeReleaseCheck(root, undefined, due)).status,
      "saved",
    );
    assertEquals(
      releaseReminderDue(await inspectReleaseCheck(root), due),
      false,
    );
    await Deno.remove(path);
    await Deno.mkdir(path);
    assertEquals(
      (await writeReleaseCheck(root, "7.8.1", due)).status,
      "unavailable",
    );
    const invocation: ReleaseInvocation = {
      mode: "json",
      stdinTty: true,
      stdoutTty: true,
      dryRun: false,
    };
    const result = await releasesResult(root, invocation);
    assert(result.ok);
    assertEquals(result.data?.state_write.status, "skipped");
    assertStringIncludes(
      renderResultReading(result, resultPresenterForVerb("releases")),
      result.data?.urls.html ?? "missing",
    );
  });
});

Deno.test("launcher failure and missing clone state preserve a usable successful URL handoff", async () => {
  for (const os of ["linux", "windows"] as const) {
    const plan = planReleases({
      mode: "desk",
      stdinTty: false,
      stdoutTty: false,
      dryRun: false,
    }, undefined);
    const result = await applyReleases(plan, {
      open: (url) =>
        openInBrowser(url, {
          os,
          wsl: false,
          run: () => {
            throw new Error("missing launcher");
          },
        }),
    });
    assert(result.ok);
    assertEquals(result.data?.launch_succeeded, false);
    assertEquals(result.data?.launch_attempted, os === "linux");
    const text = renderResultReading(
      result,
      resultPresenterForVerb("releases"),
    );
    assertStringIncludes(text, plan.urls.html);
    assertStringIncludes(text, plan.urls.json);
    assertStringIncludes(text, "Couldn't open your browser");
    assertEquals(result.data?.state_write.status, "skipped");
  }
  let attempted = false;
  const detectionFailure = await openInBrowser("https://example.test", {
    os: "linux",
    run: () => {
      attempted = true;
      return Promise.resolve({ success: true, code: 0, stderr: "" });
    },
  }, {
    get: () => {
      throw new Deno.errors.NotCapable("environment access denied");
    },
  });
  assertEquals(attempted, false);
  assertEquals(detectionFailure.status, "unsupported");
  assert(detectionFailure.status === "unsupported");
  assertStringIncludes(detectionFailure.message, "environment access denied");
  assertEquals(
    browserLaunch("https://discern.sh/releases?since=1.0.0", "linux", true),
    { command: "wslview", args: ["https://discern.sh/releases?since=1.0.0"] },
  );
});

Deno.test("human codenames remain separate from numeric protocol and mismatch identity", () => {
  for (const version of ["7.8.0", "7.8.1", "7.8.2-rc.1+build"]) {
    for (const codename of [undefined, "星の海"]) {
      const output = humanVersion({
        version,
        ...(codename === undefined ? {} : { codename }),
      });
      assertEquals(
        output,
        `discern ${version}${codename === undefined ? "" : ` — ${codename}`}`,
      );
      assertEquals(parseVersionOutput(output), version);
      assertEquals(parseDiscernVersion(output), version);
      assertEquals(
        versionMismatchHint(version, parseDiscernVersion(output)),
        undefined,
      );
    }
  }
  for (
    const raw of [
      "deno 1.0.0",
      "discern 1.2",
      "discern 1.2.3 extra",
      "discern 1.2.3\nextra",
    ]
  ) assertEquals(parseVersionOutput(raw), undefined);
  const plan = planReleases({
    mode: "json",
    stdinTty: false,
    stdoutTty: false,
    dryRun: false,
  }, undefined);
  assertEquals(
    new URL(plan.urls.html).searchParams.get("since"),
    DISCERN_VERSION,
  );
  assert(versionMismatchHint("0.1.0", "7.8.1") !== undefined);
});

Deno.test("status and doctor reminders are read-only and advisory with logbook disabled", async () => {
  await withTempDir(async (root) => {
    await scaffoldEngine(root, { agents: [] });
    const configPath = join(root, "discern.toml");
    await Deno.writeTextFile(
      configPath,
      (await Deno.readTextFile(configPath)).replace(
        /^\[project\]$/m,
        "[project]\nrecord_logbook = false",
      ),
    );
    await gitInit(root);
    await writeReleaseCheck(root, undefined, first);
    const path = await gitAdminStatePath(root, "releaseCheck");
    assert(path);
    const before = await Deno.readTextFile(path);
    const status = await statusResult(root, { all: true, nowMs: due });
    assert(status.ok);
    assert(status.data?.release_reminder);
    assert(status.hints?.includes(fire(HINTS["release-check-sequence"]).text));
    const early = await doctorResult(root, { nowMs: first });
    const later = await doctorResult(root, { nowMs: due });
    assertEquals(later.ok, early.ok);
    assertEquals(later.data?.checks, early.data?.checks);
    assert(later.data?.release_reminder);
    assertEquals(early.data?.release_reminder, undefined);
    assertEquals(await Deno.readTextFile(path), before);
    await writeReleaseCheck(root, DISCERN_VERSION, due);
    assertEquals(
      (await statusResult(root, { all: true, nowMs: due })).data
        ?.release_reminder,
      undefined,
    );
  });
});

Deno.test("release CLI works outside projects, prints each projection, and dry-run preserves missing state", async () => {
  await withTempDir(async (root) => {
    for (
      const flags of [[], ["--json"], ["--markdown"], ["--dry-run", "--json"]]
    ) {
      const result = await runCli(["releases", ...flags], root);
      assertEquals(result.code, 0, result.stderr);
      assertStringIncludes(result.stdout, `since=${DISCERN_VERSION}`);
      if (flags.length > 0) {
        assertStringIncludes(result.stdout, "releases.json");
      } else {
        assertTerminalTextIncludes(result.stdout, "See what's changed");
        assert(!result.stdout.includes("##"));
        assert(!result.stdout.includes("Authority and boundaries"));
        assert(!result.stdout.includes("timestamp"));
        assert(!result.stdout.includes("releases.json"));
        assert(result.stdout.trim().split("\n").length <= 5);
      }
    }
    await scaffoldEngine(root, { agents: [] });
    await gitInit(root);
    const result = await runCli(["releases", "--dry-run", "--json"], root);
    assertEquals(result.code, 0, result.stderr);
    assertEquals((await inspectReleaseCheck(root)).status, "missing");
  });
});

Deno.test("failed timestamp writes remain honest and authorization guidance separates check and install", async () => {
  const result = await applyReleases(
    planReleases({
      mode: "json",
      stdinTty: true,
      stdoutTty: true,
      dryRun: false,
    }, { root: "/clone", state: record }),
    {
      now: () => due,
      write: () =>
        Promise.resolve({ status: "unavailable", reason: "write denied" }),
      open: () => {
        throw new Error("agent output must not launch");
      },
    },
  );
  assert(result.ok);
  assertEquals(result.data?.state_write, {
    status: "unavailable",
    reason: "write denied",
  });
  const reading = renderResultReading(
    result,
    resultPresenterForVerb("releases"),
  );
  assertStringIncludes(reading, result.data?.urls.html ?? "missing");
  assert(!reading.includes("timestamp"));
  const guidance = fire(HINTS["release-check-sequence"]);
  assertEquals(guidance.id, "release-check-sequence");
  for (
    const contract of [
      "fetch the returned JSON URL",
      "Report whether an update is available",
      "Ask before checking if this reminder is the only prompt",
      "If installation was requested",
      "without asking again; otherwise ask before installing",
      "Don't recommend downgrading or treating a prerelease as a stable update",
    ]
  ) assertStringIncludes(guidance.text, contract);
});
