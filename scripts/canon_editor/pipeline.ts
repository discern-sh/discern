/**
 * The save-and-prove loop. A save patches the registry in memory, formats it
 * the way the repo would, swaps it into place, re-renders every projection in
 * a fresh subprocess, rewrites the committed canon pages to the exact bytes
 * the generator would produce, holds the rewritten pages to the gate's own
 * prose command, and runs the registry's own guard files — and if any step
 * past the swap fails, every written byte is restored, so a save that cannot
 * be proven leaves the tree exactly as it was. `discern done` stays the final
 * authority; Canon Editor moves the same judgment earlier.
 */

import { join } from "@std/path";
import { stripAnnotationMarkers } from "./annotation.ts";
import { patchRegistrySource, type PatchRequest } from "./patch.ts";
import { fieldSpecFor, PLAIN_TWIN } from "./fields.ts";
import { type GuardRunReport, metricProbe, runGuardFiles } from "./guards.ts";
import type { Snapshot } from "./snapshot.ts";
import { decodeValeReport, type ValeReport } from "../prose_lib.ts";

/** Where a refused save stopped. */
export type SaveStage = "patch" | "format" | "render" | "prose" | "guards";

/** One page the save rewrote (or would rewrite). */
export interface PageChange {
  readonly id: string;
  readonly rel: string;
}

/** The save verdict. */
export type SaveReport =
  | {
    readonly ok: true;
    readonly applied: boolean;
    readonly pages: readonly PageChange[];
    /** Whether the formatted patch differs from the file (preview mode). */
    readonly registryChanged?: boolean;
    readonly guards?: GuardRunReport;
    readonly snapshot?: Snapshot;
    /** The plain twin's field path, when the edited field has one. */
    readonly twin?: string;
    /** The corpus reading grade after the save, when it was re-measured. */
    readonly grade?: number;
  }
  | {
    readonly ok: false;
    readonly stage: SaveStage;
    readonly issue: string;
    readonly guards?: GuardRunReport;
    /** True when the loop had written files and restored every held byte. */
    readonly restored?: boolean;
    /** The source literal differs from the value the editor opened. */
    readonly conflict?: true;
  };

/** What the pipeline needs from its host. */
export interface SaveContext {
  readonly root: string;
  /** The live typed-list choices observed before this save began. */
  readonly pickers?: Snapshot["pickers"];
  /** The registry's guard files, from the meta-registry roster. */
  readonly guardsFor: (registry: string) => readonly string[];
  /** A fresh evaluation of the registries — normally the subprocess. */
  readonly buildSnapshot: () => Promise<Snapshot>;
  /** Progress callback for the editor's stage chips. */
  readonly onStage?: (stage: string) => void;
  /** False previews the patch and format without touching the tree. */
  readonly apply?: boolean;
}

/**
 * Evaluate the registries in a fresh subprocess — the only way a just-written
 * patch is re-imported from disk instead of served from this process's module
 * cache. A crash in registry evaluation costs one snapshot run, not the host.
 */
export async function spawnSnapshot(root: string): Promise<Snapshot> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      join("scripts", "canon_editor", "snapshot.ts"),
    ],
    cwd: root,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr).slice(-2000));
  }
  return JSON.parse(new TextDecoder().decode(output.stdout)) as Snapshot;
}

/** Format TypeScript text exactly as the repo's formatter would. */
async function formatTs(
  root: string,
  text: string,
): Promise<{ ok: true; text: string } | { ok: false; issue: string }> {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["fmt", "--ext", "ts", "-"],
    cwd: root,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(text));
  await writer.close();
  const output = await child.output();
  if (!output.success) {
    return {
      ok: false,
      issue: new TextDecoder().decode(output.stderr).slice(-1200),
    };
  }
  return { ok: true, text: new TextDecoder().decode(output.stdout) };
}

/** One path's exact state before the pipeline touched it. */
type HeldFile =
  | { readonly existed: true; readonly bytes: string }
  | { readonly existed: false };

/** Read one path's exact state, distinguishing absence from empty content. */
async function holdFile(path: string): Promise<HeldFile> {
  try {
    return { existed: true, bytes: await Deno.readTextFile(path) };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return { existed: false };
    throw error;
  }
}

/** Restore a set of files to their held bytes or prior absence. */
async function restore(written: Map<string, HeldFile>): Promise<void> {
  for (const [path, held] of written) {
    if (held.existed) {
      await Deno.writeTextFile(path, held.bytes);
      continue;
    }
    try {
      await Deno.remove(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
}

/** One Vale alert as the prose command's JSON output carries it. */
/** Flatten the prose command's findings into panel-ready lines. */
function proseIssueLines(findings: ValeReport): string[] {
  const lines: string[] = [];
  for (const [file, alerts] of Object.entries(findings)) {
    for (const alert of alerts) {
      lines.push(
        `${file}:${alert.Line ?? "?"} ${alert.Check ?? "?"} — ${
          alert.Message ?? "?"
        }`,
      );
    }
  }
  return lines;
}

/**
 * Hold the rewritten pages to the gate's own prose command — the identical
 * judgment (`--custom-zero`, error-level blockers plus the authored voice),
 * moved from `discern done` to save time so a save can never leave a tree
 * the gate's prose job refuses.
 */
async function proseGate(
  root: string,
  pages: readonly string[],
): Promise<{ ok: true } | { ok: false; issue: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      join("scripts", "prose_check.ts"),
      "project/map/",
      "--custom-zero",
      ...pages,
    ],
    cwd: root,
    env: { NO_COLOR: "1", CI: "1", TERM: "dumb" },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  if (output.success) return { ok: true };
  const stdout = new TextDecoder().decode(output.stdout);
  let lines: string[] = [];
  let decodeIssue: string | undefined;
  try {
    lines = proseIssueLines(
      decodeValeReport(stdout, "Canon Editor prose-gate output"),
    );
  } catch (error) {
    // Unparseable output still refuses; the raw tail is the evidence.
    decodeIssue = error instanceof Error ? error.message : String(error);
  }
  const detail = lines.length > 0 ? lines.join("\n") : decodeIssue ??
    (stdout + new TextDecoder().decode(output.stderr)).trim().slice(-1200);
  return {
    ok: false,
    issue:
      `the gate's prose check refuses the rewritten page(s) — the save was rolled back\n\n${detail}`,
  };
}

/**
 * Run one save through the whole loop. On a red verdict nothing of the save
 * survives on disk; on green the registry, the regenerated pages, and the
 * fresh snapshot all agree.
 */
export async function saveField(
  request: PatchRequest,
  context: SaveContext,
): Promise<SaveReport> {
  const stage = (name: string): void => context.onStage?.(name);

  stage("patch");
  const patched = patchRegistrySource(
    context.root,
    request,
    context.pickers === undefined ? {} : { pickers: context.pickers },
  );
  if (!patched.ok) {
    return {
      ok: false,
      stage: "patch",
      issue: patched.issue,
      ...(patched.conflict === true ? { conflict: true } : {}),
    };
  }

  stage("format");
  const formatted = await formatTs(context.root, patched.text);
  if (!formatted.ok) {
    return { ok: false, stage: "format", issue: formatted.issue };
  }

  const registryPath = join(context.root, patched.file);
  const registryBefore = await Deno.readTextFile(registryPath);
  if (context.apply === false) {
    return {
      ok: true,
      applied: false,
      pages: [],
      registryChanged: formatted.text !== registryBefore,
    };
  }

  const held = new Map<string, HeldFile>([[
    registryPath,
    { existed: true, bytes: registryBefore },
  ]]);
  await Deno.writeTextFile(registryPath, formatted.text);

  stage("render");
  let snapshot: Snapshot;
  try {
    snapshot = await context.buildSnapshot();
  } catch (error) {
    await restore(held);
    return {
      ok: false,
      stage: "render",
      issue: error instanceof Error ? error.message : String(error),
      restored: true,
    };
  }

  const changed: PageChange[] = [];
  for (const page of snapshot.pages) {
    if (!page.annotated) continue;
    if (!page.rel.startsWith("project/map/")) continue;
    const path = join(context.root, page.rel);
    const expected = stripAnnotationMarkers(page.full);
    const before = await holdFile(path);
    const current = before.existed ? before.bytes : "";
    if (current === expected) continue;
    held.set(path, before);
    await Deno.writeTextFile(path, expected);
    changed.push({ id: page.id, rel: page.rel });
  }

  if (changed.length > 0) {
    stage("prose");
    const prose = await proseGate(
      context.root,
      changed.map((page) => page.rel),
    );
    if (!prose.ok) {
      await restore(held);
      return { ok: false, stage: "prose", issue: prose.issue, restored: true };
    }
  }

  stage("guards");
  const guards = await runGuardFiles(
    request.registry,
    context.guardsFor(request.registry),
    context.root,
  );
  if (!guards.ok) {
    await restore(held);
    const failed = guards.results.filter((result) => !result.ok);
    return {
      ok: false,
      stage: "guards",
      issue: `${failed.length} guard file(s) red — the save was rolled back`,
      guards,
      restored: true,
    };
  }

  const spec = fieldSpecFor(request.registry, "node", request.field);
  const grade = request.mode === "prose" && spec?.edit === "prose" &&
      spec.register === "plain" &&
      request.registry === "feature"
    ? await metricProbe(
      join("scripts", "plain_reading_grade.ts"),
      "plain_reading_grade",
      context.root,
    )
    : undefined;

  const twin = request.mode === "prose" && request.registry === "feature"
    ? PLAIN_TWIN[request.field]
    : undefined;
  return {
    ok: true,
    applied: true,
    pages: changed,
    guards,
    snapshot,
    ...(twin === undefined ? {} : { twin }),
    ...(grade === undefined ? {} : { grade }),
  };
}
