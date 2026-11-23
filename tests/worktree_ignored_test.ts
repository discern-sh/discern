/**
 * Class guard for ignored-file drift snapshots.
 *
 * The scanner's inspection boundary is the list of roots Git reports. A
 * directory ignored as a whole is one opaque entry whose contents are never
 * listed or read, so its cost cannot follow its size. An individually ignored
 * file is compared by bounded content or by its own metadata. Presentation is
 * a separate job: only changed labels collapse to a top-level name. These
 * tests use unrelated root names so a future scanner with the same
 * descend-or-read mechanism enrols through the public snapshot behaviour, not
 * through one remembered directory name.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { z } from "@zod/zod";
import { dirname, join } from "@std/path";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import {
  hasIgnoredFileChanges,
  ignoredFileDriftDisabled,
  ignoredRemovalFingerprint,
  inspectIgnoredFileChanges,
  recordIgnoredFileBaseline,
} from "../src/engine/worktree/ignored.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { decodeWith } from "./decode_cli_result.ts";

const CURRENT_VERSION = ON_DISK_FORMATS.ignoredBaseline.version;

interface BaselineRoot {
  path: string;
  kind: "file" | "dir" | "symlink" | "other" | "missing";
  mode: "content" | "metadata" | "presence";
  digest: string;
  bytes: number;
}

interface BaselineFile {
  version: number;
  roots: BaselineRoot[];
}
const BaselineFileSchema: z.ZodType<BaselineFile> = z.object({
  version: z.number().int().nonnegative(),
  roots: z.array(z.object({
    path: z.string(),
    kind: z.enum(["file", "dir", "symlink", "other", "missing"]),
    mode: z.enum(["content", "metadata", "presence"]),
    digest: z.string(),
    bytes: z.number().int().nonnegative(),
  })),
});

/** Create ignored fixture data under one rule before initializing the repository. */
async function initIgnoredRepo(
  dir: string,
  rule: string,
  files: Record<string, string>,
): Promise<void> {
  await Deno.writeTextFile(join(dir, ".gitignore"), `${rule}\n`);
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(dir, path);
    await Deno.mkdir(dirname(absolute), { recursive: true });
    await Deno.writeTextFile(absolute, contents);
  }
  await gitInit(dir);
}

/** Resolve the ignored-file baseline through the production Git-admin registry. */
async function baselinePath(dir: string): Promise<string> {
  const path = await gitAdminStatePath(dir, "ignoredBaseline");
  assert(path !== undefined, "ignored baseline path must resolve inside Git");
  return path;
}

/** Decode the persisted ignored-root fingerprints written by setup-time capture. */
async function readBaseline(dir: string): Promise<BaselineFile> {
  return decodeWith(
    BaselineFileSchema,
    await Deno.readTextFile(await baselinePath(dir)),
  );
}

Deno.test("disabled ignored-file drift remains inert without repository state", async () => {
  await withTempDir(async (dir) => {
    const disabled = ignoredFileDriftDisabled();
    assertEquals(await inspectIgnoredFileChanges(dir, false), disabled);
    await recordIgnoredFileBaseline(dir, false);
    assertEquals(hasIgnoredFileChanges(disabled), false);
    assertEquals(
      hasIgnoredFileChanges({
        status: "changed",
        changed_roots: ["cache/"],
        changed_total: 1,
        truncated: false,
      }),
      true,
    );
  });
});

Deno.test("ignored drift inspects exact roots but collapses only changed labels", async () => {
  await withTempDir(async (dir) => {
    await initIgnoredRepo(
      dir,
      "workspace/generated/*.txt",
      { "workspace/generated/result.txt": "before\n" },
    );
    await recordIgnoredFileBaseline(dir, true);

    const baseline = await readBaseline(dir);
    assertEquals(baseline.roots.map((root) => root.path), [
      "workspace/generated/result.txt",
    ]);

    await Deno.writeTextFile(
      join(dir, "workspace/generated/result.txt"),
      "after\n",
    );
    const changed = await inspectIgnoredFileChanges(dir, true);
    assertEquals(changed.changed_roots, ["workspace/"]);
  });
});

Deno.test("an ignored directory is one opaque root whatever changes beneath it", async () => {
  await withTempDir(async (dir) => {
    await initIgnoredRepo(dir, "deps/", {
      "deps/package/lib/module.js": "before\n",
      "deps/package/manifest.json": "{}\n",
      "deps/removed-later.txt": "value\n",
    });
    await recordIgnoredFileBaseline(dir, true);

    assertEquals(
      (await readBaseline(dir)).roots.map(({ path, kind, mode, bytes }) => ({
        path,
        kind,
        mode,
        bytes,
      })),
      [{ path: "deps/", kind: "dir", mode: "presence", bytes: 0 }],
    );
    const reviewed = await ignoredRemovalFingerprint(dir);

    await Deno.writeTextFile(
      join(dir, "deps/package/lib/module.js"),
      "after, and longer\n",
    );
    await Deno.remove(join(dir, "deps/removed-later.txt"));
    await Deno.mkdir(join(dir, "deps/added/nested"), { recursive: true });
    await Deno.writeTextFile(join(dir, "deps/added/nested/new.js"), "new\n");

    const inspected = await inspectIgnoredFileChanges(dir, true);
    assertEquals(inspected.status, "unchanged");
    assertEquals(inspected.changed_roots, []);
    assertEquals(await ignoredRemovalFingerprint(dir), reviewed);
  });
});

Deno.test({
  name: "nothing beneath an ignored directory is listed or read",
  // An unreadable member is the proof: any listing or read beneath the root
  // would fail on it. A superuser bypasses permission bits, so the proof needs
  // an ordinary account.
  ignore: Deno.build.os === "windows" || Deno.uid() === 0,
  async fn(): Promise<void> {
    await withTempDir(async (dir) => {
      await initIgnoredRepo(dir, "deps/", {
        "deps/readable.txt": "value\n",
        "deps/sealed/inner/payload.bin": "value\n",
      });
      const sealed = join(dir, "deps/sealed");
      await Deno.chmod(sealed, 0o000);
      try {
        await recordIgnoredFileBaseline(dir, true);
        assertEquals(
          (await readBaseline(dir)).roots.map((root) => root.path),
          ["deps/"],
        );
        assertEquals(
          (await inspectIgnoredFileChanges(dir, true)).status,
          "unchanged",
        );
        assert(await ignoredRemovalFingerprint(dir) !== undefined);
      } finally {
        await Deno.chmod(sealed, 0o755);
      }
    });
  },
});

Deno.test("an ignored directory that appears after setup is reported", async () => {
  await withTempDir(async (dir) => {
    await initIgnoredRepo(dir, "output/", {});
    await recordIgnoredFileBaseline(dir, true);
    assertEquals((await readBaseline(dir)).roots, []);
    const reviewed = await ignoredRemovalFingerprint(dir);

    await Deno.mkdir(join(dir, "output/reports"), { recursive: true });
    await Deno.writeTextFile(join(dir, "output/reports/run.txt"), "value\n");

    const changed = await inspectIgnoredFileChanges(dir, true);
    assertEquals(changed.status, "changed");
    assertEquals(changed.changed_roots, ["output/"]);
    assertNotEquals(await ignoredRemovalFingerprint(dir), reviewed);
  });
});

Deno.test("ignored drift reports roots removed since the baseline", async () => {
  await withTempDir(async (dir) => {
    await initIgnoredRepo(
      dir,
      "workspace/generated/",
      { "workspace/generated/result.txt": "value\n" },
    );
    await recordIgnoredFileBaseline(dir, true);

    await Deno.remove(join(dir, "workspace/generated"), { recursive: true });
    const changed = await inspectIgnoredFileChanges(dir, true);
    assertEquals(changed.status, "changed");
    assertEquals(changed.changed_roots, ["workspace/"]);
  });
});

Deno.test("a large ignored file is compared by metadata rather than payload", async () => {
  await withTempDir(async (dir) => {
    const payload = join(dir, "payload.bin");
    await initIgnoredRepo(dir, "payload.bin", { "payload.bin": "" });
    await Deno.truncate(payload, 17 * 1024 * 1024);
    const original = await Deno.stat(payload);
    await recordIgnoredFileBaseline(dir, true);
    const baseline = await readBaseline(dir);
    assertEquals(baseline.roots[0]?.mode, "metadata");
    assertEquals(baseline.roots[0]?.bytes, 17 * 1024 * 1024);

    const file = await Deno.open(payload, { write: true });
    try {
      await file.write(new Uint8Array([1]));
    } finally {
      file.close();
    }
    await Deno.utime(
      payload,
      original.atime ?? new Date(0),
      original.mtime ?? new Date(0),
    );

    const changed = await inspectIgnoredFileChanges(dir, true);
    assertEquals(changed.status, "unchanged");
    assertEquals(changed.changed_roots, []);
  });
});

Deno.test("standalone ignored files retain content-sensitive drift detection", async () => {
  await withTempDir(async (dir) => {
    const payload = join(dir, ".local-secret");
    await initIgnoredRepo(dir, ".local-secret", { ".local-secret": "before" });
    const original = await Deno.stat(payload);
    await recordIgnoredFileBaseline(dir, true);
    assertEquals((await readBaseline(dir)).roots[0]?.mode, "content");

    await Deno.writeTextFile(payload, "after!");
    await Deno.utime(
      payload,
      original.atime ?? new Date(0),
      original.mtime ?? new Date(0),
    );

    const changed = await inspectIgnoredFileChanges(dir, true);
    assertEquals(changed.status, "changed");
    assertEquals(changed.changed_roots, [".local-secret"]);
  });
});

Deno.test({
  name: "an ignored symlink reports a changed target",
  ignore: Deno.build.os === "windows",
  async fn(): Promise<void> {
    await withTempDir(async (dir) => {
      await Deno.writeTextFile(join(dir, ".gitignore"), "current\n");
      const link = join(dir, "current");
      await Deno.symlink("first-target", link);
      await gitInit(dir);
      await recordIgnoredFileBaseline(dir, true);
      assertEquals((await readBaseline(dir)).roots[0]?.kind, "symlink");

      await Deno.remove(link);
      await Deno.symlink("second-target", link);
      const changed = await inspectIgnoredFileChanges(dir, true);
      assertEquals(changed.status, "changed");
      assertEquals(changed.changed_roots, ["current"]);
    });
  },
});

Deno.test("recording keeps a valid ignored baseline instead of snapshotting again", async () => {
  await withTempDir(async (dir) => {
    const payload = join(dir, ".local-secret");
    await initIgnoredRepo(dir, ".local-secret", { ".local-secret": "before" });
    await recordIgnoredFileBaseline(dir, true);
    const recorded = await Deno.readTextFile(await baselinePath(dir));

    await Deno.writeTextFile(payload, "after, and longer");
    await recordIgnoredFileBaseline(dir, true);

    assertEquals(await Deno.readTextFile(await baselinePath(dir)), recorded);
    assertEquals(
      (await inspectIgnoredFileChanges(dir, true)).changed_roots,
      [".local-secret"],
    );
  });
});

Deno.test("recording replaces older, unreadable, and malformed ignored baselines", async () => {
  await withTempDir(async (dir) => {
    await initIgnoredRepo(dir, "cache/", { "cache/payload.bin": "value\n" });
    const path = await baselinePath(dir);
    await Deno.mkdir(dirname(path), { recursive: true });
    for (
      const raw of [
        "not json\n",
        `{"version":${CURRENT_VERSION},"roots":[{"path":"cache/","kind":"dir","mode":"presence","digest":"x","bytes":"one"}]}\n`,
        '{"version":1,"roots":[{"path":"cache/","kind":"dir","mode":"metadata","digest":"x","files":1,"bytes":6}]}\n',
      ]
    ) {
      await Deno.writeTextFile(path, raw);
      await recordIgnoredFileBaseline(dir, true);

      const baseline = await readBaseline(dir);
      assertEquals(baseline.version, CURRENT_VERSION);
      assertEquals(baseline.roots.map((root) => root.path), ["cache/"]);
    }
  });
});

Deno.test("an older ignored baseline reads as missing, never as drift", async () => {
  await withTempDir(async (dir) => {
    await initIgnoredRepo(dir, "cache/", { "cache/payload.bin": "value\n" });
    const path = await baselinePath(dir);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(
      path,
      '{"version":1,"roots":[{"path":"cache/","kind":"dir","mode":"metadata","digest":"x","files":1,"bytes":6}]}\n',
    );

    const inspected = await inspectIgnoredFileChanges(dir, true);

    assertEquals(inspected.status, "baseline_missing");
    assertEquals(inspected.changed_roots, []);
  });
});

Deno.test("a newer ignored baseline is reported and never overwritten", async () => {
  await withTempDir(async (dir) => {
    await initIgnoredRepo(dir, "cache/", { "cache/payload.bin": "value\n" });
    const path = await baselinePath(dir);
    await Deno.mkdir(dirname(path), { recursive: true });
    const raw = `{"version":${CURRENT_VERSION + 1},"roots":[]}\n`;
    await Deno.writeTextFile(path, raw);

    await recordIgnoredFileBaseline(dir, true);

    assertEquals(await Deno.readTextFile(path), raw);
    const inspected = await inspectIgnoredFileChanges(dir, true);
    assertEquals(inspected.status, "newer");
    assert(inspected.reason?.includes("written by a newer discern"));
  });
});

Deno.test("content fingerprints share one aggregate budget of bytes and of files", async () => {
  // Each case offers one member more than its budget admits, so exactly one
  // root stays on metadata.
  for (
    const budget of [
      { extension: "cache", members: 17, bytesEach: 1024 * 1024 },
      { extension: "gen", members: 2_049, bytesEach: 0 },
    ]
  ) {
    await withTempDir(async (dir) => {
      const files = Object.fromEntries(
        Array.from(
          { length: budget.members },
          (_, index) => [`member-${index}.${budget.extension}`, ""],
        ),
      );
      await initIgnoredRepo(dir, `*.${budget.extension}`, files);
      for (const path of Object.keys(files)) {
        await Deno.truncate(join(dir, path), budget.bytesEach);
      }

      await recordIgnoredFileBaseline(dir, true);

      const roots = (await readBaseline(dir)).roots;
      const content = roots.filter((root) => root.mode === "content");
      assertEquals(roots.length, budget.members, budget.extension);
      assertEquals(content.length, budget.members - 1, budget.extension);
      assertEquals(
        content.reduce((total, root) => total + root.bytes, 0),
        (budget.members - 1) * budget.bytesEach,
        budget.extension,
      );
      assertEquals(
        roots.filter((root) => root.mode === "metadata").length,
        1,
        budget.extension,
      );
    });
  }
});
