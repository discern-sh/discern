/**
 * The checkpoint **observation boundary** — the architectural guard that keeps
 * the advisory line structural: the checkpoint INTERLOCK (everything that can
 * refuse `done` or hold a landing) runs on gate-owned open-question state only, and
 * no Logbook reader — economics, detectors, the stream — can ever steer it.
 *
 * The class this guards: "a Logbook reader gates a command". A wrong advisory
 * costs a glance; a wrong refusal wedges an effort — so the separation must be
 * impossible to cross silently, not merely uncrossed today. The guard walks
 * the static module graph from every checkpoint decision module (the whole
 * `src/engine/checkpoints/` package, `report.ts` excepted, plus the acceptance
 * interlock) and fails if any path reaches `src/engine/logbook/`. A NEW
 * checkpoint module auto-enrols by existing in the package; a new Logbook
 * reader auto-enrols by living in the logbook directory.
 *
 * `report.ts` is excepted with its reason: it is the read verb's always-ok
 * result core — the one sanctioned consumer of observed economics — and its
 * result cannot refuse, so a reader feeding it cannot gate anything. The
 * exception is enforced as an exact set, so a second exception is a reviewed
 * decision, not drift. Recording is deliberately absent from both sides: the
 * pre-flight OBSERVES through the shared process-local accumulator
 * (`shared/result_capture.ts`), and only the Logbook recorder — outside every
 * decision path — drains it.
 *
 * Guards: boundary:worker-neutral-measurement
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, relative, resolve } from "@std/path";
import { importSpecifiers } from "./logbook_no_network_test.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const CHECKPOINT_MODULE_FILES = await structuralGuardScope({
  guard:
    "tests/checkpoint_observation_boundary_test.ts#checkpoint-package-modules",
  universe: "authored-ts",
  narrow: {
    reason:
      "The observation boundary enrolls direct TypeScript modules in the production checkpoint package.",
    include: (path) =>
      path.startsWith("src/engine/checkpoints/") &&
      path.slice("src/engine/checkpoints/".length).split("/").length === 1,
  },
});

/** The one checkpoint-package module allowed to consume Logbook readers, with
 * the reason enforced beside it (see the module doc). */
const READ_SURFACE_EXCEPTIONS = new Set(["report.ts"]);

/** Every checkpoint decision module: the package minus the read-surface
 * exceptions, plus the acceptance interlock. Derived from the filesystem so a
 * new module auto-enrols. */
function interlockEntryFiles(): string[] {
  const out = CHECKPOINT_MODULE_FILES.filter((rel) =>
    !READ_SURFACE_EXCEPTIONS.has(rel.slice(rel.lastIndexOf("/") + 1))
  ).map((rel) => join(REPO_ROOT, rel));
  assert(out.length > 0, "the checkpoint package has no modules to guard");
  out.push(
    join(REPO_ROOT, "src", "engine", "worktree", "acceptance_checkpoints.ts"),
  );
  return out.sort();
}

/** Drop full-line and block comments so prose mentioning "import (" cannot
 * read as an unwalkable dynamic import. Real import statements never live in
 * comments, so the walk loses nothing. */
function withoutCommentLines(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") &&
        !trimmed.startsWith("/*");
    })
    .join("\n");
}

/** Walk the static module graph from the interlock entries. */
async function walkInterlockGraph(): Promise<{
  files: string[];
  dynamicOffenders: string[];
}> {
  const queue = interlockEntryFiles();
  const files = new Set<string>();
  const dynamicOffenders: string[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const path = queue.pop();
    if (path === undefined || seen.has(path)) {
      continue;
    }
    seen.add(path);
    const source = await Deno.readTextFile(path);
    const rel = relative(REPO_ROOT, path);
    files.add(rel);
    const { specifiers, unwalkableDynamicImport } = importSpecifiers(
      withoutCommentLines(source),
    );
    if (unwalkableDynamicImport) {
      dynamicOffenders.push(rel);
    }
    for (const spec of specifiers) {
      if (spec.startsWith(".")) {
        queue.push(resolve(dirname(path), spec));
      }
    }
  }
  return { files: [...files].sort(), dynamicOffenders };
}

Deno.test("checkpoint interlock: its module graph reaches no Logbook module", async () => {
  const { files, dynamicOffenders } = await walkInterlockGraph();
  assertEquals(
    dynamicOffenders,
    [],
    "a non-literal dynamic import cannot be walked; the interlock graph must stay statically checkable",
  );
  // Sanity: the walk covered the real decision modules, not an empty set.
  for (
    const expected of [
      join("src", "engine", "checkpoints", "preflight.ts"),
      join("src", "engine", "checkpoints", "open_questions.ts"),
      join("src", "engine", "worktree", "acceptance_checkpoints.ts"),
    ]
  ) {
    assert(files.includes(expected), `the walk missed ${expected}`);
  }
  const logbookPrefix = join("src", "engine", "logbook") + "/";
  // The one sanctioned reach: the invocation-id seam. It holds a process-local
  // id for attributing spawned children (`when` commands run through the job
  // spawner) — pure state, no recorded history, nothing to steer a decision
  // with. Exact set: any new reach into the Logbook fails until reviewed.
  const sanctioned = new Set([
    join("src", "engine", "logbook", "invocation_context.ts"),
  ]);
  const breaches = files.filter((file) =>
    file.startsWith(logbookPrefix) && !sanctioned.has(file)
  );
  assertEquals(
    breaches,
    [],
    "a checkpoint decision module reaches the Logbook — advisory readers " +
      "never gate, so the interlock must run on gate-owned open-question state " +
      "only (observed history may inform the owner, never a refusal)",
  );
});

Deno.test("checkpoint read-surface exceptions stay an exact, reviewed set", () => {
  // The exception list must describe reality in both directions: every named
  // file exists (a rename cannot silently widen the guard), and report.ts —
  // the always-ok read verb — is the only member.
  const names = CHECKPOINT_MODULE_FILES.map((rel) =>
    rel.slice(rel.lastIndexOf("/") + 1)
  );
  for (const exception of READ_SURFACE_EXCEPTIONS) {
    assert(
      names.includes(exception),
      `${exception} is excepted from the interlock guard but does not exist`,
    );
  }
  assertEquals([...READ_SURFACE_EXCEPTIONS], ["report.ts"]);
});
