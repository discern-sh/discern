/**
 * The shipped built-in checkpoint set (`src/shared/checkpoints.ts`), proven
 * end to end: every seed resolves through the real resolver against a
 * representative NON-DEFAULT config (so selectors demonstrably track
 * configuration, not defaults), and every trigger fires — and refuses to fire
 * — where the tuned thresholds say. The false-positive guards are the point:
 * a rename is not a deletion-heavy change, a moved file is not a parallel
 * implementation, and regenerated agent files alone never read as docs drift.
 *
 * The composition tests pin the shipped contract deliberately (double-entry
 * against the registry): changing an id, a mode, or a threshold must fail
 * here so it happens as a conscious decision, never as drift.
 *
 * Guards: boundary:project-owned-quality
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { BUILT_IN_CHECKPOINTS } from "../src/shared/checkpoints.ts";
import { questionById } from "../src/shared/questions.ts";
import { resolveCheckpoints } from "../src/engine/checkpoints/policy.ts";
import { evaluateStructuralTrigger } from "../src/engine/checkpoints/triggers.ts";
import type {
  EffortChangeKind,
  EffortDiff,
  EffortFileChange,
  ResolvedCheckpoint,
} from "../src/engine/checkpoints/types.ts";
import type { TriggerVeto } from "../src/shared/checkpoints.ts";
import { assertNamedCases } from "./assert_cases.ts";

// ── fixtures ────────────────────────────────────────────────────────────────

/** One changed file with small, non-dominant line churn unless stated. */
function file(
  path: string,
  kind: EffortChangeKind = "modified",
  insertions = 5,
  deletions = 2,
): EffortFileChange {
  return { path, generated: false, kind, insertions, deletions, binary: false };
}

/** An effort diff over `files`, with an optional merge-base tree listing. */
function diff(
  files: readonly EffortFileChange[],
  baseFiles: readonly string[] = [],
): EffortDiff {
  return {
    files: [...files],
    baseFiles: baseFiles.map((path) => ({ path, generated: false })),
  };
}

/** `count` modified source files, `src/mod0.ext` … — whole-diff filler. */
function sourceFiles(count: number): EffortFileChange[] {
  return Array.from({ length: count }, (_, i) => file(`src/mod${i}.ext`));
}

/** A representative project pointing every consulted path AWAY from the
 * defaults, with every built-in enabled by bare reference — the exact spelling
 * a fresh `[checkpoints]` table uses. The deliberately broad instructions
 * scope includes skills; the instruction source authority does not. */
const CONFIG = parseConfigOrThrow([
  "[project]",
  'gotchas_doc = "notes/gate-traps.md"',
  "",
  "[instructions]",
  'sources = ["agent-instructions.md", "guidance/**/*.md"]',
  "",
  "[map]",
  'dir = "guide/"',
  "",
  "[skills]",
  'dir = "playbooks"',
  "",
  "[scopes.instructions]",
  'paths = ["agent-instructions.md", "guidance/**", "playbooks/**"]',
  "",
  ...Object.keys(BUILT_IN_CHECKPOINTS).map((id) => `[checkpoints.${id}]`),
  "",
].join("\n"));

const RESOLUTION = resolveCheckpoints(CONFIG);

/** The resolved definition for one shipped id, or a loud broken-test error. */
function resolved(id: string): ResolvedCheckpoint {
  const def = RESOLUTION.checkpoints.find((c) => c.id === id);
  if (def === undefined) {
    throw new Error(`built-in '${id}' did not resolve against the fixture`);
  }
  return def;
}

// ── composition: the shipped contract, pinned ───────────────────────────────

Deno.test("checkpoints builtins: contracts", () => {
  assertNamedCases({
    "the shipped set is four stop members on the knowledge surfaces and six advise members on the change":
      () => {
        const stop = RESOLUTION.checkpoints.filter((c) => c.mode === "stop")
          .map((c) => c.id).sort();
        const advise = RESOLUTION.checkpoints.filter((c) => c.mode === "advise")
          .map((c) => c.id).sort();
        assertEquals(stop, [
          "gotchas-playbook",
          "instruction-economy",
          "map-focus",
          "skills-playbook",
        ]);
        assertEquals(advise, [
          "commit-story",
          "deletion-heavy-change",
          "effort-sprawl",
          "map-drift",
          "new-binary-asset",
          "parallel-implementation",
        ]);
      },
    "every built-in resolves by bare reference and serves its canonical question verbatim":
      () => {
        assertEquals(RESOLUTION.drops, []);
        for (const [id, seed] of Object.entries(BUILT_IN_CHECKPOINTS)) {
          const def = resolved(id);
          const canonical = questionById(seed.question);
          assert(canonical !== undefined, id);
          assertEquals(def.question, canonical.question, id);
          assertEquals(def.teach, canonical.teach, id);
        }
      },
    "the v1 built-in ids and canonical question ids are frozen together":
      () => {
        assertEquals(
          Object.fromEntries(
            Object.entries(BUILT_IN_CHECKPOINTS).map(([id, seed]) => [
              id,
              seed.question,
            ]),
          ),
          {
            "map-focus": "map.focus",
            "instruction-economy": "instructions.economy",
            "skills-playbook": "skills.executable",
            "gotchas-playbook": "setup.failure-memory",
            "deletion-heavy-change": "change.deletion-safety",
            "parallel-implementation": "change.parallel-implementation",
            "new-binary-asset": "change.binary-asset",
            "effort-sprawl": "change.effort-scope",
            "map-drift": "map.current",
            "commit-story": "change.commit-story",
          },
        );
      },
    "the retired docs-drift spelling is not a built-in alias": () => {
      assertThrows(
        () => parseConfigOrThrow("[checkpoints.docs-drift]\n"),
        Error,
        "names no shipped checkpoint",
      );
    },
    "map-focus fires on a broad documentation change under the CONFIGURED map dir":
      () => {
        const pages = [
          file("guide/a.md", "modified", 80, 2),
          file("guide/b.md"),
          file("guide/sub/c.md"),
        ];
        const outcome = evaluateStructuralTrigger(
          resolved("map-focus"),
          diff(pages),
        );
        assert(outcome.holds);
        assertEquals(outcome.matched, [
          "guide/a.md",
          "guide/b.md",
          "guide/sub/c.md",
        ]);
      },
    "map-focus stays quiet for a touch-up, and off-map files never count toward its threshold":
      () => {
        const touchUp = evaluateStructuralTrigger(
          resolved("map-focus"),
          diff([file("guide/a.md"), file("guide/b.md")]),
        );
        assertEquals(touchUp, { holds: false, vetoedBy: "min_changed_lines" });
        const padded = evaluateStructuralTrigger(
          resolved("map-focus"),
          diff([file("guide/a.md"), file("guide/b.md"), ...sourceFiles(5)]),
        );
        assertEquals(padded, { holds: false, vetoedBy: "min_changed_lines" });
      },
    "instruction-economy enrolls every configured instruction source glob":
      () => {
        assertEquals(resolved("instruction-economy").selector?.globs, [
          "agent-instructions.md",
          "guidance/**/*.md",
        ]);
        const outcome = evaluateStructuralTrigger(
          resolved("instruction-economy"),
          diff([file("guidance/team/review.md")]),
        );
        assert(outcome.holds);
        assertEquals(outcome.matched, ["guidance/team/review.md"]);
      },
    "an authored skill fires skills-playbook without borrowing the broad instructions scope":
      () => {
        const changed = diff([file("playbooks/review/SKILL.md")]);
        assert(
          evaluateStructuralTrigger(resolved("skills-playbook"), changed).holds,
        );
        assertEquals(
          evaluateStructuralTrigger(resolved("instruction-economy"), changed),
          { holds: false, vetoedBy: "empty_matched_set" },
        );
      },
    "an absent instruction source stays quiet without a missing-scope advisory":
      () => {
        const config = parseConfigOrThrow([
          "[instructions]",
          'sources = ["not-created/**/*.md"]',
          "",
          "[checkpoints.instruction-economy]",
          "",
        ].join("\n"));
        const { checkpoints, drops } = resolveCheckpoints(config);
        assertEquals(drops, []);
        const definition = checkpoints[0];
        assert(definition !== undefined);
        assertEquals(definition.selector?.globs, ["not-created/**/*.md"]);
        assertEquals(
          evaluateStructuralTrigger(definition, diff([file("src/mod0.ext")])),
          { holds: false, vetoedBy: "empty_matched_set" },
        );
      },
    "a project-authored selector overrides instruction-economy's configured-source default":
      () => {
        const config = parseConfigOrThrow([
          "[instructions]",
          'sources = ["agent-instructions.md"]',
          "",
          "[checkpoints.instruction-economy]",
          'paths = ["reviewed-guidance/**"]',
          "",
        ].join("\n"));
        const { checkpoints, drops } = resolveCheckpoints(config);
        assertEquals(drops, []);
        assertEquals(checkpoints[0]?.selector?.globs, ["reviewed-guidance/**"]);
      },
    "skills-playbook fires on a change under the CONFIGURED skills dir": () => {
      const outcome = evaluateStructuralTrigger(
        resolved("skills-playbook"),
        diff([file("playbooks/release-dance/SKILL.md", "added")]),
      );
      assert(outcome.holds);
      assertEquals(outcome.matched, ["playbooks/release-dance/SKILL.md"]);
    },
    "gotchas-playbook fires on the CONFIGURED gotchas doc and nothing else":
      () => {
        const onDoc = evaluateStructuralTrigger(
          resolved("gotchas-playbook"),
          diff([file("notes/gate-traps.md")]),
        );
        assert(onDoc.holds);
        assertEquals(onDoc.matched, ["notes/gate-traps.md"]);
        const elsewhere = evaluateStructuralTrigger(
          resolved("gotchas-playbook"),
          diff([file("notes/other.md"), ...sourceFiles(3)]),
        );
        assertEquals(elsewhere, {
          holds: false,
          vetoedBy: "empty_matched_set",
        });
      },
    "gotchas-playbook stays quiet in a project that never configured a gotchas doc":
      () => {
        const noDoc = parseConfigOrThrow("[checkpoints.gotchas-playbook]\n");
        const { checkpoints, drops } = resolveCheckpoints(noDoc);
        assertEquals(drops, []);
        const def = checkpoints[0];
        assert(
          def !== undefined,
          "the checkpoint still governs — it just never fires",
        );
        assertEquals(def.selector?.globs, [""]);
        const outcome = evaluateStructuralTrigger(
          def,
          diff([file("anything.md"), ...sourceFiles(10)]),
        );
        assertEquals(outcome, { holds: false, vetoedBy: "empty_matched_set" });
      },
    "deletion-heavy-change fires on a substantial, deletion-dominant cut":
      () => {
        const outcome = evaluateStructuralTrigger(
          resolved("deletion-heavy-change"),
          diff([
            file("src/legacy.ext", "deleted", 0, 110),
            file("src/mod.ext"),
          ]),
        );
        assert(outcome.holds);
      },
    "a rename is not a deletion-heavy change: balanced churn fails the ratio":
      () => {
        // Rename detection is off, so a rename reads as one deletion plus one
        // addition of similar size — deletions ≈ insertions, nowhere near 2×.
        const outcome = evaluateStructuralTrigger(
          resolved("deletion-heavy-change"),
          diff([
            file("src/old-name.ext", "deleted", 0, 80),
            file("src/new-name.ext", "added", 80, 0),
          ]),
        );
        assertEquals(outcome, { holds: false, vetoedBy: "deletion_dominant" });
      },
    "a small cleanup is not a deletion-heavy change: the absolute floor holds":
      () => {
        const outcome = evaluateStructuralTrigger(
          resolved("deletion-heavy-change"),
          diff([file("src/tidy.ext", "modified", 3, 40)]),
        );
        assertEquals(outcome, { holds: false, vetoedBy: "deletion_dominant" });
      },
    "parallel-implementation fires when a decorated sibling grows beside a surviving original":
      () => {
        const outcome = evaluateStructuralTrigger(
          resolved("parallel-implementation"),
          diff(
            [file("src/service_v2.ext", "added", 120, 0)],
            ["src/service.ext", "src/other.ext"],
          ),
        );
        assert(outcome.holds);
        assertEquals(outcome.related, [
          {
            kind: "similar_existing",
            forPath: "src/service_v2.ext",
            path: "src/service.ext",
          },
        ]);
      },
    "a moved file is not a parallel implementation: a different directory is no sibling":
      () => {
        const outcome = evaluateStructuralTrigger(
          resolved("parallel-implementation"),
          diff(
            [
              file("lib/service.ext", "added", 80, 0),
              file("src/service.ext", "deleted", 0, 80),
            ],
            ["src/service.ext"],
          ),
        );
        assertEquals(outcome, { holds: false, vetoedBy: "similar_new_file" });
      },
    "a rename in place is not a parallel implementation: the vanished original is no sibling":
      () => {
        const outcome = evaluateStructuralTrigger(
          resolved("parallel-implementation"),
          diff(
            [
              file("src/service_v2.ext", "added", 80, 0),
              file("src/service.ext", "deleted", 0, 80),
            ],
            ["src/service.ext"],
          ),
        );
        assertEquals(outcome, { holds: false, vetoedBy: "similar_new_file" });
      },
    "an unrelated map edit cannot veto map-drift": () => {
      const outcome = evaluateStructuralTrigger(
        resolved("map-drift"),
        diff([...sourceFiles(5), file("guide/page.md")]),
      );
      assert(outcome.holds);
      assertEquals(outcome.matched, sourceFiles(5).map((file) => file.path));
    },
    "regenerated agent files alone stay under the map-drift threshold": () => {
      // The closed menu cannot name 'generated files'; the threshold is the
      // guard — a compile of every agent file plus a small touch never reaches
      // five changed files on its own.
      const outcome = evaluateStructuralTrigger(
        resolved("map-drift"),
        diff([
          file("CLAUDE.md"),
          file("AGENTS.md"),
          file("GEMINI.md"),
          file("src/mod.ext"),
        ]),
      );
      assertEquals(outcome, { holds: false, vetoedBy: "min_changed_files" });
    },
    "every built-in proves it fires and stays quiet — a new seed fails until its fixtures exist":
      () => {
        assertEquals(
          Object.keys(TRIGGER_FIXTURES).sort(),
          Object.keys(BUILT_IN_CHECKPOINTS).sort(),
          "the fixture table must cover exactly the registry",
        );
        const { checkpoints, drops } = resolveCheckpoints(CONFIG);
        assertEquals(drops, []);
        assertEquals(
          checkpoints.length,
          Object.keys(BUILT_IN_CHECKPOINTS).length,
        );
        for (const def of checkpoints) {
          const fixtures = TRIGGER_FIXTURES[def.id];
          assert(fixtures !== undefined, def.id);
          const firing = evaluateStructuralTrigger(def, fixtures.firing);
          assert(firing.holds, `${def.id} must fire on its firing fixture`);
          if (fixtures.firingMatched !== undefined) {
            assertEquals(firing.matched, fixtures.firingMatched, def.id);
          }
          const quiet = evaluateStructuralTrigger(def, fixtures.quiet);
          assertEquals(
            quiet.holds,
            false,
            `${def.id} must stay quiet on its quiet fixture`,
          );
          if (fixtures.quietVeto !== undefined) {
            assertEquals(
              quiet,
              { holds: false, vetoedBy: fixtures.quietVeto },
              def.id,
            );
          }
          for (const extra of fixtures.additionalQuiet ?? []) {
            assertEquals(
              evaluateStructuralTrigger(def, extra.diff),
              { holds: false, vetoedBy: extra.vetoedBy },
              `${def.id}: ${extra.name}`,
            );
          }
        }
      },
    "map-focus reviews a single new explanation but excludes history, private and generated pages":
      () => {
        const def = resolved("map-focus");
        assert(
          evaluateStructuralTrigger(
            def,
            diff([file("guide/runtime/README.md", "added")]),
          ).holds,
        );
        for (
          const path of ["guide/_adr/0002-choice.md", "guide/_private/notes.md"]
        ) {
          assert(
            !evaluateStructuralTrigger(def, diff([file(path, "added")])).holds,
          );
        }
        assert(
          !evaluateStructuralTrigger(
            def,
            diff([{ ...file("guide/inventory.md", "added"), generated: true }]),
          ).holds,
        );
      },
    "map-drift relates one changed source to its explanation, even when the page also changes":
      () => {
        const evidence: EffortDiff = {
          ...diff([
            file("src/mod0.ext"),
            file("guide/runtime/README.md"),
            file("guide/other.md"),
          ]),
          mapSources: {
            complete: true,
            pages: [{
              path: "guide/runtime/README.md",
              sources: ["src/mod0.ext"],
            }],
          },
        };
        const outcome = evaluateStructuralTrigger(
          resolved("map-drift"),
          evidence,
        );
        assert(outcome.holds);
        assertEquals(outcome.matched, ["src/mod0.ext"]);
        assertEquals(outcome.related, [{
          kind: "map_explanation",
          forPath: "src/mod0.ext",
          path: "guide/runtime/README.md",
        }]);
      },
  });
});
Deno.test("the public guide inventory follows the built-in registry", async () => {
  const guide = await Deno.readTextFile(
    new URL("../project/map/20-quality-gate/checkpoints.md", import.meta.url),
  );
  const count = /activates (\d+) built-ins/.exec(guide)?.[1];
  assertEquals(Number(count), Object.keys(BUILT_IN_CHECKPOINTS).length);
  for (const id of Object.keys(BUILT_IN_CHECKPOINTS)) {
    assert(
      guide.includes(`\`${id}\``),
      `the public guide must inventory built-in '${id}'`,
    );
  }
});

// ── map-focus ───────────────────────────────────────────────────────────────
// ── instruction-economy ─────────────────────────────────────────────────────
// ── skills-playbook ─────────────────────────────────────────────────────────
// ── gotchas-playbook ────────────────────────────────────────────────────────
// ── deletion-heavy-change ───────────────────────────────────────────────────
// ── parallel-implementation ─────────────────────────────────────────────────
// ── map-drift ───────────────────────────────────────────────────────────────
// ── the completeness forcing function ───────────────────────────────────────

/** One firing and one quiet diff per built-in, keyed by the registry: a new
 * seed fails the table-completeness assertion below until it proves both
 * halves of its trigger here. Focused expectations retain exact matched paths
 * and veto reasons, with additional quiet boundaries where needed. */
const TRIGGER_FIXTURES: Readonly<
  Record<string, {
    firing: EffortDiff;
    firingMatched?: readonly string[];
    quiet: EffortDiff;
    quietVeto?: TriggerVeto;
    additionalQuiet?: readonly {
      name: string;
      diff: EffortDiff;
      vetoedBy: TriggerVeto;
    }[];
  }>
> = {
  "map-focus": {
    firing: diff([file("guide/a.md", "added")]),
    quiet: diff([file("guide/a.md")]),
  },
  "instruction-economy": {
    firing: diff([file("agent-instructions.md")]),
    firingMatched: ["agent-instructions.md"],
    quiet: diff([file("src/mod0.ext")]),
  },
  "skills-playbook": {
    firing: diff([file("playbooks/review/SKILL.md")]),
    quiet: diff([file("src/mod0.ext")]),
  },
  "gotchas-playbook": {
    firing: diff([file("notes/gate-traps.md")]),
    quiet: diff([file("notes/other.md")]),
  },
  "deletion-heavy-change": {
    firing: diff([file("src/dead.ext", "deleted", 0, 400)]),
    quiet: diff([file("src/mod0.ext")]),
  },
  "parallel-implementation": {
    firing: diff(
      [file("src/service_v2.ext", "added")],
      ["src/service.ext"],
    ),
    quiet: diff([file("src/service.ext")], ["src/service.ext"]),
  },
  "new-binary-asset": {
    firing: diff([{
      ...file("assets/reference.bin", "added"),
      binary: true,
    }]),
    firingMatched: ["assets/reference.bin"],
    quiet: diff([{ ...file("assets/reference.bin"), binary: true }]),
    quietVeto: "kinds",
    additionalQuiet: [{
      name: "newly added text asset",
      diff: diff([file("assets/reference.txt", "added")]),
      vetoedBy: "binary",
    }],
  },
  "effort-sprawl": {
    firing: diff(sourceFiles(25)),
    quiet: diff(sourceFiles(24)),
    quietVeto: "min_changed_files",
  },
  "map-drift": {
    firing: diff(sourceFiles(5)),
    quiet: diff([...sourceFiles(4), file("guide/a.md")]),
  },
  "commit-story": {
    firing: diff(sourceFiles(15)),
    quiet: diff(sourceFiles(14)),
    quietVeto: "min_changed_files",
  },
};
