/**
 * End-to-end worktree environment plumbing. `[worktree].env_files` names the
 * ordered read/write set, declared inheritance may create its first file,
 * `.env.local` supplies the higher-precedence default, fleet rows derive
 * identity when nothing is recorded, an unreadable env file marks its
 * checkout in every status view and refuses identity and inheritance by name,
 * and a newly minted port avoids live siblings.
 *
 * Guards: boundary:provider-security-boundary
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { z } from "@zod/zod";
import { basename, join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { HINTS } from "../src/shared/hints.ts";
import type { StatusWireData } from "../src/shared/result_schemas.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import {
  addWorktree,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import {
  lifecycleContext,
  livePortsInUse,
  mintFreeWorktree,
} from "../src/engine/worktree/lifecycle.ts";
import {
  loadIdentitySettings,
  portForId,
} from "../src/engine/worktree/identity.ts";
import type { MintedWorktreeId } from "../src/engine/worktree/identity.ts";
import {
  formatEnvValue,
  readEnvFileAt,
  readEnvFilesAt,
  stripQuotes,
  writeEnvVar,
} from "../src/engine/worktree/env_file.ts";
import { Logger } from "../src/lib/log.ts";
import {
  assertResultDataKey,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";

const SettingsWithoutPermissionsSchema = z.object({
  permissions: z.never().optional(),
});

const INHERIT_CONFIG =
  '[project]\nslug = "engine-test"\n\n[repository]\ntrunk = "main"\n\n' +
  '[worktree]\ninherit_env = ["APP_KEY"]\n';

Deno.test("inherit_env: a declared value arrives in a FRESH worktree with no env file (end to end)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, INHERIT_CONFIG);
    await gitInit(dir);
    // The secret lives only in main's untracked .env — a fresh worktree never
    // carries it via git.
    await Deno.writeTextFile(join(dir, ".env"), "APP_KEY=s3cret\n");

    const wt = await addWorktree(dir, "env-fresh");
    assertEquals(
      await targetExists(join(wt, ".env")),
      false,
      "fresh = no env file",
    );
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);

    const env = await Deno.readTextFile(join(wt, ".env"));
    assertStringIncludes(
      env,
      "APP_KEY=s3cret",
      "the declared value must ARRIVE — created file and all",
    );
  });
});

Deno.test("inherit_env: .env.local overrides .env when reading main's values", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, INHERIT_CONFIG);
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, ".env"), "APP_KEY=base\n");
    await Deno.writeTextFile(join(dir, ".env.local"), "APP_KEY=local-wins\n");

    const wt = await addWorktree(dir, "env-local");
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);
    assertStringIncludes(
      await Deno.readTextFile(join(wt, ".env")),
      "APP_KEY=local-wins",
      ".env.local is the dominant convention — it must win",
    );
  });
});

Deno.test("inherit_env: a worktree-specific value is never clobbered", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, INHERIT_CONFIG);
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, ".env"), "APP_KEY=mains\n");

    const wt = await addWorktree(dir, "env-custom");
    await Deno.writeTextFile(join(wt, ".env"), "APP_KEY=my-own\n");
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);
    assertStringIncludes(
      await Deno.readTextFile(join(wt, ".env")),
      "APP_KEY=my-own",
    );
  });
});

Deno.test("fleet rows derive id and port when the project has no env file", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      '[project]\nslug = "engine-test"\n\n[repository]\ntrunk = "main"\n\n[worktree]\nexport_port = true\n',
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "no-env-here");

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const result = decodeCliResult(r.stdout, "status");
    assertResultDataKey(result, "fleet");
    assert(result.data.fleet !== undefined);
    const row = result.data.fleet.find((e) => e.path.endsWith("no-env-here"));
    assert(row !== undefined, JSON.stringify(result.data.fleet));
    assertEquals(row.id, basename(wt), "id derives without any env file");
    assertEquals(
      typeof row.port,
      "number",
      "port derives without any env file",
    );
  });
});

Deno.test("status keeps a stale fleet row instead of crashing on its missing root", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, INHERIT_CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "stale-env-root");

    // Leave Git's worktree registration behind, as an out-of-band deletion does.
    await Deno.remove(wt, { recursive: true });

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const result = decodeCliResult(r.stdout, "status");
    assertResultDataKey(result, "fleet");
    assert(result.data.fleet !== undefined);
    const row = result.data.fleet.find((entry) =>
      entry.path.endsWith("stale-env-root")
    );
    assert(row !== undefined, JSON.stringify(result.data.fleet));
    assertEquals(row.broken, true);
  });
});

Deno.test("status reads a contained symlinked env file in a fleet member", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, INHERIT_CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "linked-env-status");
    await Deno.writeTextFile(
      join(wt, ".env.real"),
      "DISCERN_WORKTREE_ID=recorded-through-link\n",
    );
    await Deno.symlink(".env.real", join(wt, ".env"));

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const result = decodeCliResult(r.stdout, "status");
    assertResultDataKey(result, "fleet");
    assert(result.data.fleet !== undefined);
    const row = result.data.fleet.find((entry) =>
      entry.path.endsWith("linked-env-status")
    );
    assert(row !== undefined, JSON.stringify(result.data.fleet));
    assertEquals(row.id, "recorded-through-link");
  });
});

Deno.test("inherit_env reads main's contained symlink through the shared snapshot", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, INHERIT_CONFIG);
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, ".env.real"), "APP_KEY=s3cret\n");
    await Deno.symlink(".env.real", join(dir, ".env"));

    const wt = await addWorktree(dir, "env-linked-main");
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);
    assertStringIncludes(
      await Deno.readTextFile(join(wt, ".env")),
      "APP_KEY=s3cret",
    );
  });
});

Deno.test("env reads ignore a symbolic link whose target leaves the project", async () => {
  await withTempDir(async (dir) => {
    const root = join(dir, "project");
    await Deno.mkdir(root);
    const outside = join(dir, "outside.env");
    await Deno.writeTextFile(outside, "APP_KEY=outside\n");
    await Deno.symlink(outside, join(root, ".env"));

    assertEquals(await readEnvFileAt(root, ".env"), { state: "absent" });
  });
});

/** Each way a configured env file can exist yet refuse its read. */
const UNREADABLE_ENV_ENTRIES = [
  {
    name: "a mode-000 file",
    usesPermissionBits: true,
    plant: async (path: string): Promise<void> => {
      await Deno.writeTextFile(path, "DISCERN_WORKTREE_ID=hidden-override\n");
      await Deno.chmod(path, 0o000);
    },
  },
  {
    name: "a directory at the env-file path",
    usesPermissionBits: false,
    plant: async (path: string): Promise<void> => {
      await Deno.mkdir(path);
    },
  },
] as const;

Deno.test("every way an env file can refuse its read reads as unreadable", async (t) => {
  // Each read site classifies through readEnvFileAt, so the engine cases
  // below plant only the directory, which refuses every user on every OS.
  for (const entry of UNREADABLE_ENV_ENTRIES) {
    await t.step(entry.name, async (step) => {
      if (entry.usesPermissionBits && Deno.build.os === "windows") {
        await step.step({
          name: "mode 0o000 cannot refuse a read on Windows",
          ignore: true,
          fn: () => {},
        });
        return;
      }
      await withTempDir(async (root) => {
        const path = join(root, ".env.local");
        await entry.plant(path);
        const refused = await Deno.readTextFile(path).then(
          () => false,
          () => true,
        );
        if (!refused) {
          await step.step({
            name:
              "the current user reads mode-0o000 files, so the refusal cannot be simulated",
            ignore: true,
            fn: () => {},
          });
          return;
        }
        const read = await readEnvFileAt(root, ".env.local");
        assert(read.state === "unreadable", JSON.stringify(read));
        assertEquals(read.file, ".env.local");
        assertEquals(read.path, path);
      });
    });
  }
});

Deno.test("env reads keep absent, text, and unreadable files distinct", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, ".env"), "APP_KEY=base\n");
    await Deno.mkdir(join(root, ".env.local"));

    assertEquals(await readEnvFileAt(root, ".env"), {
      state: "text",
      text: "APP_KEY=base\n",
    });
    assertEquals(await readEnvFileAt(root, ".env.missing"), {
      state: "absent",
    });
    const unreadable = await readEnvFileAt(root, ".env.local");
    assert(unreadable.state === "unreadable", JSON.stringify(unreadable));
    assertEquals(unreadable.file, ".env.local");
    assertEquals(unreadable.path, join(root, ".env.local"));
    // Last definition wins, so a readable earlier file cannot answer for a
    // later one that could override it.
    assertEquals(
      await readEnvFilesAt(root, [".env", ".env.local"]),
      unreadable,
    );
    await assertRejects(
      () => writeEnvVar(root, "APP_KEY", "next", [".env", ".env.local"]),
      Error,
      join(root, ".env.local"),
    );
    assertEquals(
      await Deno.readTextFile(join(root, ".env")),
      "APP_KEY=base\n",
      "a refused write changes no file",
    );
  });
});

// ── an unreadable env file: status marks its checkout, commands refuse ──────

/** The env file each case makes unreadable. The readable `.env` beside it
 * records values the unreadable file could override. */
const UNREADABLE_ENV_FILE = ".env.local";
const OVERRIDABLE_RECORD = "DISCERN_WORKTREE_ID=recorded-override\n" +
  "DISCERN_WORKTREE_PORT=1\nDISCERN_RESOURCE_CACHE=recorded-cache\n";
const PORT_CONFIG =
  '[project]\nslug = "engine-test"\n\n[repository]\ntrunk = "main"\n\n' +
  "[worktree]\nexport_port = true\n";
const RESOURCE_CONFIG = `${PORT_CONFIG}\n[worktree.resources.cache]\n` +
  'create = "true"\ndestroy = "true"\n';

/** Which checkouts carry the unreadable file, under which config. */
interface UnreadableEnvPlacement {
  readonly name: string;
  readonly main: boolean;
  readonly worktree: boolean;
  readonly config: string;
}

/** Every status read site. A declared resource adds the handle reads each
 * view performs, so that case plants the file in both checkouts. */
const UNREADABLE_ENV_PLACEMENTS: readonly UnreadableEnvPlacement[] = [
  { name: "in a worktree", main: false, worktree: true, config: PORT_CONFIG },
  {
    name: "in the main checkout",
    main: true,
    worktree: false,
    config: PORT_CONFIG,
  },
  {
    name: "under a resource key",
    main: true,
    worktree: true,
    config: RESOURCE_CONFIG,
  },
];

/** Build a project whose placed checkouts carry an unreadable env file: a
 * directory at its path, which refuses the read for every user. */
async function unreadableEnvProject(
  dir: string,
  placement: UnreadableEnvPlacement,
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, placement.config);
  await gitInit(dir);
  const worktree = await addWorktree(dir, "env-unreadable");
  const roots = [
    ...(placement.main ? [dir] : []),
    ...(placement.worktree ? [worktree] : []),
  ];
  for (const root of roots) {
    await Deno.writeTextFile(join(root, ".env"), OVERRIDABLE_RECORD);
    await Deno.mkdir(join(root, UNREADABLE_ENV_FILE));
  }
  return worktree;
}

type StatusFleetRow = NonNullable<StatusWireData["fleet"]>[number];

/** One status view's decoded result. A crash or refusal fails the case here. */
async function statusView(
  cwd: string,
  flags: readonly string[],
): Promise<{ data: StatusWireData; hints?: string[] }> {
  const run = await runAgent(cwd, ["status", ...flags, "--json"]);
  assertEquals(run.code, 0, run.output);
  const result = decodeCliResult(run.stdout, "status");
  const data = result.data;
  assert(data !== undefined && "location" in data, run.stdout);
  return result.hints === undefined ? { data } : { data, hints: result.hints };
}

/** The fleet row a view reports for one checkout. */
function fleetRow(
  data: StatusWireData,
  matches: (row: StatusFleetRow) => boolean,
): StatusFleetRow {
  const row = data.fleet?.find(matches);
  assert(row !== undefined, JSON.stringify(data.fleet));
  return row;
}

Deno.test("an unreadable env file marks its checkout in every status view", async (t) => {
  for (const placement of UNREADABLE_ENV_PLACEMENTS) {
    await t.step(placement.name, async () => {
      await withTempDir(async (dir) => {
        const worktree = await unreadableEnvProject(dir, placement);
        const id = basename(worktree);
        const [fromMain, fromWorktree, fromAll] = await Promise.all([
          statusView(dir, ["--verbose"]),
          statusView(worktree, []),
          statusView(worktree, ["--all"]),
        ]);

        // The main checkout's own block and its fleet row. A main row never
        // takes an id from its env files, so the override stays out.
        const mainMark = placement.main ? UNREADABLE_ENV_FILE : undefined;
        assertEquals(fromMain.data.worktree?.read_failure?.file, mainMark);
        assertEquals(fromMain.data.worktree?.id, "main");
        assertEquals(fromMain.data.worktree?.resources, {});
        for (const view of [fromMain, fromAll]) {
          const row = fleetRow(view.data, (candidate) => candidate.is_main);
          assertEquals(row.read_failure?.file, mainMark);
          assertEquals(row.id, undefined);
        }

        // The worktree's local blocks and fleet rows keep their derived
        // id and port; the recorded override and handle stay unknown.
        const worktreeMark = placement.worktree
          ? UNREADABLE_ENV_FILE
          : undefined;
        for (const view of [fromWorktree, fromAll]) {
          const block = view.data.worktree;
          assertEquals(block?.read_failure?.file, worktreeMark);
          assertEquals(block?.id, id);
          assertEquals(block?.port, portForId(id));
          assertEquals(block?.resources, {});
        }
        for (const view of [fromMain, fromAll]) {
          const row = fleetRow(view.data, (candidate) => !candidate.is_main);
          assertEquals(row.read_failure?.file, worktreeMark);
          assertEquals(row.id, id);
          assertEquals(row.port, portForId(id));
        }
        const fullRow = fleetRow(
          fromMain.data,
          (candidate) => !candidate.is_main,
        );
        assertEquals(
          fullRow.resources,
          placement.worktree ? undefined : {},
        );
        const unreadableHint = [HINTS["status-fleet-member-unreadable"], {
          total: 1,
          names: [id],
        }] as const;
        if (placement.worktree) {
          assertHasHint(fromMain, ...unreadableHint);
        } else {
          assertLacksHint(fromMain, ...unreadableHint);
        }
      });
    });
  }
});

Deno.test("the dashboard marks an unreadable env file where it sits", async () => {
  await withTempDir(async (dir) => {
    const everywhere = UNREADABLE_ENV_PLACEMENTS[2];
    assert(everywhere !== undefined);
    const worktree = await unreadableEnvProject(dir, everywhere);

    const fleet = await runAgent(dir, ["status", "--verbose"]);
    assertEquals(fleet.code, 0, fleet.output);
    assertTerminalTextIncludes(
      fleet.output,
      "agent/env-unreadable: Unreadable",
    );
    assertTerminalTextIncludes(
      fleet.output,
      "discern could not read the env file `.env.local` in this checkout. Choose Show recovery steps in `discern desk`.",
    );
    assertTerminalTextIncludes(fleet.output, "Unreadable: .env.local");

    const local = await runAgent(worktree, ["status", "--verbose"]);
    assertEquals(local.code, 0, local.output);
    assertTerminalTextIncludes(
      local.output,
      "env-unreadable: Unreadable",
    );
    assertTerminalTextIncludes(
      local.output,
      "env-unreadable is this worktree's derived identity.",
    );
  });
});

Deno.test("identity and env inheritance refuse an unreadable env file by name", async (t) => {
  const cases = [
    {
      name: "the worktree's own file",
      placement: UNREADABLE_ENV_PLACEMENTS[0],
      commands: [["identity", "--json"], ["worktree", "setup", "--json"]],
      error: "identity_failed",
    },
    {
      name: "the main checkout's inherited file",
      placement: {
        name: "in the main checkout with inheritance",
        main: true,
        worktree: false,
        config: INHERIT_CONFIG,
      },
      commands: [["worktree", "setup", "--json"]],
      error: "precondition_failed",
    },
  ] as const;
  for (const testCase of cases) {
    await t.step(testCase.name, async () => {
      await withTempDir(async (dir) => {
        assert(testCase.placement !== undefined);
        const worktree = await unreadableEnvProject(
          dir,
          testCase.placement,
        );
        const unreadable = join(
          await Deno.realPath(testCase.placement.main ? dir : worktree),
          UNREADABLE_ENV_FILE,
        );
        for (const command of testCase.commands) {
          const run = await runAgent(worktree, [...command]);
          assertEquals(run.code, 1, run.output);
          const refusal = decodeCliResult(
            run.stdout,
            command.filter((word) => word !== "--json").join(" "),
          );
          assertEquals(refusal.ok, false, run.stdout);
          assertEquals(refusal.error, testCase.error, run.stdout);
          assertStringIncludes(refusal.message ?? "", unreadable);
        }
      });
    });
  }
});

Deno.test("worktree setup reports a symlinked env write refusal as a result", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, INHERIT_CONFIG);
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, ".env"), "APP_KEY=s3cret\n");

    const wt = await addWorktree(dir, "env-linked-write");
    const real = join(wt, ".env.real");
    await Deno.writeTextFile(real, "");
    await Deno.symlink(".env.real", join(wt, ".env"));

    const setup = await runAgent(wt, ["worktree", "setup", "--json"]);
    assertEquals(setup.code, 1, setup.output);
    const result = decodeCliResult(setup.stdout, "worktree setup");
    assertEquals(result.ok, false);
    assertEquals(result.error, "precondition_failed");
    assertStringIncludes(result.message ?? "", "remove the symbolic link");
    assertEquals(await Deno.readTextFile(real), "");
  });
});

Deno.test("the shipped settings template carries no deny rule", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const settings = decodeWith(
      SettingsWithoutPermissionsSchema,
      await Deno.readTextFile(join(dir, ".claude/settings.json")),
    );
    assertEquals(
      settings.permissions,
      undefined,
      "discern never restricts what an agent can read — permissions are the user's own decision",
    );
  });
});

Deno.test("inherit_env: values survive a one-shot `cp .env.example .env` setup step", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // The canonical bootstrap step rewrites the env file WHOLESALE after the
    // env writers ran — the inherited secret and the recorded port must land in
    // the FINAL file, not the pre-step one the scaffold replaced.
    await writeConfig(
      dir,
      '[project]\nslug = "engine-test"\n\n[repository]\ntrunk = "main"\n\n' +
        '[worktree]\ninherit_env = ["APP_KEY"]\nexport_port = true\n\n' +
        '[worktree.setup]\nsteps = ["cp .env.example .env"]\n',
    );
    // The example ships in git (the worktree checkout needs it for the cp);
    // main's real secret lives only in its untracked .env.
    await Deno.writeTextFile(
      join(dir, ".env.example"),
      "APP_KEY=placeholder\n",
    );
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, ".env"), "APP_KEY=s3cret\n");

    const wt = await addWorktree(dir, "env-clobber");
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);

    const env = await Deno.readTextFile(join(wt, ".env"));
    assertStringIncludes(
      env,
      "APP_KEY=s3cret",
      `the inherited value must survive the scaffold step\n${env}`,
    );
    assert(
      !env.includes("APP_KEY=placeholder"),
      `the placeholder must not win\n${env}`,
    );
    assertStringIncludes(
      env,
      "DISCERN_WORKTREE_PORT=",
      `the recorded port must survive the scaffold step\n${env}`,
    );
  });
});

Deno.test("env values round-trip through the quote writer and reader", () => {
  // The writer escapes a double quote; the reader must unescape it — the
  // asymmetry made a quote-bearing value compare unequal on every read, so
  // inheritance rewrote it each setup and consumers saw the literal backslash.
  const values = [
    "plain",
    "with space",
    'quo"ted',
    "hash#value",
    "single'quote",
    '"already quoted"',
  ];
  for (const value of values) {
    assertEquals(
      stripQuotes(formatEnvValue(value)),
      value,
      `round-trip must be identity for ${JSON.stringify(value)}`,
    );
  }
});

// ── the port re-roll (D7): a freshly-minted id avoids a live sibling's port ──────

/** Cycle through chosen worktree identifiers so port-collision retries are deterministic. */
function stubGenerator(ids: string[]): (name?: string) => MintedWorktreeId {
  let call = 0;
  return () => {
    const id = ids[call % ids.length] as string;
    call++;
    return { id, source: "codename" };
  };
}

Deno.test("mint re-rolls an id whose derived port collides with a live worktree's", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const ctx = await lifecycleContext(
      dir,
      new Logger({ json: true, noColor: true }),
    );
    const settings = await loadIdentitySettings(dir);

    const colliding = "brisk-otter-a3f9c1";
    const free = "merry-heron-0b12cd";
    const minted = await mintFreeWorktree(
      ctx,
      settings,
      `${dir}.worktrees`,
      undefined,
      {
        usedPorts: new Set([portForId(colliding)]),
        generate: stubGenerator([colliding, free]),
      },
    );
    assertEquals(minted.id, free, "the colliding first roll must be re-rolled");
  });
});

Deno.test("livePortsInUse enumerates the trunk and every sibling's own port", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      '[project]\nslug = "engine-test"\n\n[worktree]\nexport_port = true\n',
    );
    await gitInit(dir);
    const sibling = await addWorktree(dir, "brisk-otter-a3f9c1");
    const ctx = await lifecycleContext(
      dir,
      new Logger({ json: true, noColor: true }),
    );
    const settings = await loadIdentitySettings(dir);
    const ports = await livePortsInUse(ctx, settings);
    assert(
      ports.has(portForId("main")),
      `the trunk's derived port must be enumerated: ${[...ports].join(",")}`,
    );
    assert(
      ports.has(portForId(basename(sibling))),
      `the sibling's derived port must be enumerated: ${[...ports].join(",")}`,
    );
    // One port per checkout: the enumeration reads each row's OWN identity, so
    // it can never collapse the fleet onto a single id (the env-override
    // poisoning defect) — a second sibling must add a second port.
    const other = await addWorktree(dir, "merry-heron-0b12cd");
    const both = await livePortsInUse(ctx, settings);
    assert(both.has(portForId(basename(other))));
    assertEquals(both.size, 3, [...both].join(","));
  });
});

Deno.test("mint accepts a port collision rather than failing when the band is exhausted", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const ctx = await lifecycleContext(
      dir,
      new Logger({ json: true, noColor: true }),
    );
    const settings = await loadIdentitySettings(dir);

    const a = "brisk-otter-a3f9c1";
    const b = "merry-heron-0b12cd";
    const minted = await mintFreeWorktree(
      ctx,
      settings,
      `${dir}.worktrees`,
      undefined,
      {
        usedPorts: new Set([portForId(a), portForId(b)]),
        generate: stubGenerator([a, b]),
      },
    );
    assert(
      minted.id === a || minted.id === b,
      "port uniqueness is best-effort — a crowded band must never fail the start",
    );
  });
});
