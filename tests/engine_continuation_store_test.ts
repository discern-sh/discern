/** Repository-local persistence and lifecycle for short continuation handles. */

import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  CONTINUATION_TTL_MS,
  readContinuation,
  removeContinuation,
  saveContinuation,
} from "../src/engine/continuations/store.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { addWorktree, gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { fakeSecureEntropy } from "./fake_secure_entropy.ts";
import type { SecureEntropy } from "../src/shared/entropy.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";

/** Create a deterministic entropy source that fills handles with one chosen byte. */
function entropy(value: number): SecureEntropy {
  return fakeSecureEntropy({ byteFills: [value] });
}

/** Seed and initialize a repository whose continuation store can be shared by worktrees. */
async function initRepo(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
  await gitInit(dir);
}

Deno.test("continuation records persist across sibling worktrees and update in place", async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    const sibling = await addWorktree(dir, "continuation-reader");
    const created = await saveContinuation(
      dir,
      "await",
      { marker: "first" },
      undefined,
      { entropy: entropy(1) },
    );
    assert(created.kind === "saved");

    const fromSibling = await readContinuation(sibling, created.handle);
    assert(fromSibling.kind === "found");
    assertEquals(fromSibling.record, {
      schema_version: 1,
      kind: "await",
      payload: { marker: "first" },
    });

    const updated = await saveContinuation(
      sibling,
      "await",
      { marker: "second" },
      created.handle,
    );
    assertEquals(updated, created);
    const fromMain = await readContinuation(dir, created.handle);
    assert(fromMain.kind === "found");
    assertEquals(fromMain.record.payload, { marker: "second" });
  });
});

Deno.test("continuation creation retries a colliding repository-local identity", async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    const first = await saveContinuation(
      dir,
      "await",
      { value: 1 },
      undefined,
      { entropy: entropy(2) },
    );
    assert(first.kind === "saved");
    let calls = 0;
    const second = await saveContinuation(
      dir,
      "await",
      { value: 2 },
      undefined,
      {
        entropy: {
          uuid: (): string => "12345678-1234-4123-8123-123456789abc",
          fillBytes: (target: Uint8Array): void => {
            calls++;
            target.fill(calls === 1 ? 2 : 3);
          },
        },
      },
    );
    assert(second.kind === "saved");
    assert(second.handle !== first.handle);
    assertEquals(calls, 2);
  });
});

Deno.test("a future continuation kind inherits the same bounded handle store", async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    const saved = await saveContinuation(
      dir,
      "review-session",
      { prompt: "x".repeat(8_000) },
      undefined,
      { entropy: entropy(8) },
    );
    assert(saved.kind === "saved");
    assertEquals(saved.handle.length, 15);
    const read = await readContinuation(dir, saved.handle);
    assert(read.kind === "found");
    assertEquals(read.record.kind, "review-session");
    assertEquals(
      (read.record.payload as { prompt: string }).prompt.length,
      8_000,
    );
  });
});

Deno.test("expired continuation records are removed when addressed", async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    const now = SYSTEM_CLOCK.wallNow();
    const created = await saveContinuation(
      dir,
      "await",
      { value: "old" },
      undefined,
      { entropy: entropy(4), now },
    );
    assert(created.kind === "saved");
    const directory = await gitAdminStatePath(dir, "continuations");
    assert(directory !== undefined);
    const path = join(directory, `${created.handle}.json`);
    const old = new Date(now - CONTINUATION_TTL_MS - 1);
    await Deno.utime(path, old, old);

    assertEquals(
      await readContinuation(dir, created.handle, { now }),
      { kind: "missing" },
    );
    let absent = false;
    try {
      await Deno.stat(path);
    } catch (error) {
      absent = error instanceof Deno.errors.NotFound;
    }
    assert(absent, "addressing an expired handle must reap its state file");
  });
});

Deno.test("continuation creation keeps the repository store within its cap", async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    const created: string[] = [];
    const directory = await gitAdminStatePath(dir, "continuations");
    assert(directory !== undefined);
    const base = SYSTEM_CLOCK.wallNow();
    for (const value of [5, 6, 7]) {
      const saved = await saveContinuation(
        dir,
        "await",
        { value },
        undefined,
        { entropy: entropy(value), maxEntries: 2 },
      );
      assert(saved.kind === "saved");
      created.push(saved.handle);
      const timestamp = new Date(base + value);
      await Deno.utime(
        join(directory, `${saved.handle}.json`),
        timestamp,
        timestamp,
      );
    }
    const first = created[0];
    const second = created[1];
    const third = created[2];
    assert(first !== undefined && second !== undefined && third !== undefined);
    assertEquals(await readContinuation(dir, first), { kind: "missing" });
    assertEquals((await readContinuation(dir, second)).kind, "found");
    assertEquals((await readContinuation(dir, third)).kind, "found");
  });
});

Deno.test("a newer continuation is diagnosed and survives update, expiry, capacity, and removal", async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    const now = SYSTEM_CLOCK.wallNow();
    const created = await saveContinuation(
      dir,
      "await",
      { value: "current" },
      undefined,
      { entropy: entropy(9), now },
    );
    assert(created.kind === "saved");
    const directory = await gitAdminStatePath(dir, "continuations");
    assert(directory !== undefined);
    const path = join(directory, `${created.handle}.json`);
    const future = `${
      JSON.stringify({
        schema_version: ON_DISK_FORMATS.continuationRecord.version + 1,
        kind: "await",
        payload: { value: "future" },
      })
    }\n`;
    await Deno.writeTextFile(path, future);

    const read = await readContinuation(dir, created.handle, { now });
    assert(read.kind === "newer");
    assertStringIncludes(read.reason, "written by a newer discern");

    const replacement = await saveContinuation(
      dir,
      "await",
      { value: "replacement" },
      created.handle,
      { entropy: entropy(10), maxEntries: 1, now },
    );
    assert(replacement.kind === "saved");
    assert(replacement.handle !== created.handle);
    assertEquals(await Deno.readTextFile(path), future);

    const old = new Date(now - CONTINUATION_TTL_MS - 1);
    await Deno.utime(path, old, old);
    const expired = await readContinuation(dir, created.handle, { now });
    assert(expired.kind === "newer");
    await removeContinuation(dir, created.handle);
    assertEquals(await Deno.readTextFile(path), future);
  });
});
