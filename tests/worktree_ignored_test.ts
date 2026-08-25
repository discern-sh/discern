/**
 * Class guard for ignored-file drift snapshots.
 *
 * The scanner's inspection boundary and its human presentation boundary have
 * independent jobs: inspect the exact ignored members cheaply, then collapse
 * only the changed labels for a quiet report. These tests use unrelated root
 * names so a future scanner/container with the same pre-collapse or byte-read
 * mechanism enrols through the public snapshot behaviour, not an `app/` case.
 */

import { assert, assertEquals } from "@std/assert";
import { z } from "@zod/zod";
import { dirname, join } from "@std/path";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import {
  inspectIgnoredFileChanges,
  recordIgnoredFileBaseline,
} from "../src/engine/worktree/ignored.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { decodeWith } from "./decode_cli_result.ts";

interface BaselineRoot {
  path: string;
  kind: "file" | "dir" | "symlink" | "other" | "missing";
  mode: "content" | "metadata";
  digest: string;
  files: number;
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
    mode: z.enum(["content", "metadata"]),
    digest: z.string(),
    files: z.number().int().nonnegative(),
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

Deno.test("ignored drift inspects exact roots but collapses only changed labels", async () => {
  await withTempDir(async (dir) => {
    await initIgnoredRepo(
      dir,
      "workspace/generated/",
      { "workspace/generated/result.txt": "before\n" },
    );
    await recordIgnoredFileBaseline(dir, true);

    const baseline = await readBaseline(dir);
    assertEquals(baseline.roots.map((root) => root.path), [
      "workspace/generated/",
    ]);

    await Deno.writeTextFile(
      join(dir, "workspace/generated/result.txt"),
      "after\n",
    );
    const changed = await inspectIgnoredFileChanges(dir, true);
    assertEquals(changed.changed_roots, ["workspace/"]);
  });
});

Deno.test("large ignored directory drift is metadata-based rather than payload-based", async () => {
  await withTempDir(async (dir) => {
    const payload = join(dir, "cache/payload.bin");
    await initIgnoredRepo(dir, "cache/", { "cache/payload.bin": "" });
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

Deno.test({
  name:
    "recording reuses a valid ignored baseline without reading payloads again",
  ignore: Deno.build.os === "windows",
  async fn(): Promise<void> {
    await withTempDir(async (dir) => {
      const payload = join(dir, "cache/payload.bin");
      await initIgnoredRepo(dir, "cache/", { "cache/payload.bin": "value\n" });
      await recordIgnoredFileBaseline(dir, true);
      await Deno.chmod(payload, 0o000);

      await recordIgnoredFileBaseline(dir, true);
    });
  },
});

Deno.test("recording replaces unreadable, malformed, and older ignored baselines", async () => {
  await withTempDir(async (dir) => {
    await initIgnoredRepo(dir, "cache/", { "cache/payload.bin": "value\n" });
    const path = await baselinePath(dir);
    await Deno.mkdir(dirname(path), { recursive: true });
    for (
      const raw of [
        "not json\n",
        '{"version":1,"roots":[]}\n',
        '{"version":2,"roots":[{"path":"cache/","kind":"dir","mode":"metadata","digest":"x","files":"one","bytes":1}]}\n',
      ]
    ) {
      await Deno.writeTextFile(path, raw);
      await recordIgnoredFileBaseline(dir, true);

      const baseline = await readBaseline(dir);
      assertEquals(baseline.version, 2);
      assertEquals(baseline.roots.map((root) => root.path), ["cache/"]);
    }
  });
});

Deno.test("content fingerprints share one aggregate byte budget", async () => {
  await withTempDir(async (dir) => {
    const files = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`root-${index}.cache`, ""]),
    );
    await initIgnoredRepo(dir, "*.cache", files);
    for (const path of Object.keys(files)) {
      await Deno.truncate(join(dir, path), 1024 * 1024);
    }

    await recordIgnoredFileBaseline(dir, true);

    const roots = (await readBaseline(dir)).roots;
    assertEquals(
      roots.filter((root) => root.mode === "content").reduce(
        (total, root) => total + root.bytes,
        0,
      ),
      16 * 1024 * 1024,
    );
    assertEquals(
      roots.filter((root) => root.mode === "metadata").length,
      1,
    );
  });
});

Deno.test("large member counts cannot evade the content fingerprint budget", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, ".gitignore"), "generated/\n");
    await Deno.mkdir(join(dir, "generated"));
    for (let index = 0; index < 2_049; index++) {
      await Deno.writeTextFile(join(dir, "generated", `${index}.txt`), "");
    }
    await gitInit(dir);

    await recordIgnoredFileBaseline(dir, true);

    const baseline = await readBaseline(dir);
    assertEquals(baseline.roots.length, 1);
    assertEquals(baseline.roots[0]?.path, "generated/");
    assertEquals(baseline.roots[0]?.kind, "dir");
    assertEquals(baseline.roots[0]?.mode, "metadata");
    assertEquals(baseline.roots[0]?.files, 2_049);
    assertEquals(baseline.roots[0]?.bytes, 0);
  });
});
