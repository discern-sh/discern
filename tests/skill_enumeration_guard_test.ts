/**
 * Architectural guard: the authored-skill enumeration has one owner.
 *
 * Which entries under `[skills].dir` are skills — real directories, followed
 * links, refused links — is decided once, in `src/lib/skills.ts`
 * (`scanAuthoredSkills`). A reader that lists the directory itself would
 * re-decide it and silently drop linked skills. So outside that module, a
 * `resolveSkillsDir(...)` result may only be read for its configured `rel`
 * spelling (display text); the absolute path stays with the owner.
 */

import { assertEquals } from "@std/assert";
import { Node, Project, SyntaxKind } from "ts-morph";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import {
  readScopedSources,
  structuralGuardScope,
} from "./structural_guard_scope.ts";
import { assertNamedCases } from "./assert_cases.ts";

const ENUMERATION_OWNER = "src/lib/skills.ts";

/** Whether one `resolveSkillsDir(...)` call is read only for its `rel`. */
function readsOnlyRel(call: Node): boolean {
  const parent = call.getParent();
  if (
    Node.isPropertyAccessExpression(parent) && parent.getExpression() === call
  ) {
    return parent.getName() === "rel";
  }
  if (Node.isVariableDeclaration(parent)) {
    const binding = parent.getNameNode();
    return Node.isObjectBindingPattern(binding) &&
      binding.getElements().every((element) =>
        (element.getPropertyNameNode()?.getText() ?? element.getName()) ===
          "rel"
      );
  }
  return false;
}

/** Each `resolveSkillsDir(...)` call in `source` that exposes the absolute path. */
function skillsDirAbsoluteReads(path: string, source: string): string[] {
  const file = new Project({
    compilerOptions: { noLib: true },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  }).createSourceFile(path, source, { overwrite: true });
  return file.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) =>
      call.getExpression().getText() === "resolveSkillsDir" &&
      !readsOnlyRel(call)
    )
    .map((call) => `${path}:${call.getStartLineNumber()}`);
}

Deno.test("only the skills module enumerates [skills].dir", async () => {
  const files = await structuralGuardScope({
    guard: "tests/skill_enumeration_guard_test.ts#single-enumeration",
    universe: "authored-ts",
    narrow: {
      reason:
        "The owner implements the enumeration; tests resolve the directory to build fixtures, never to decide which entries ship.",
      include: (path) =>
        path !== ENUMERATION_OWNER && !path.startsWith("tests/"),
    },
  });
  const findings = (await readScopedSources(REPO_ROOT, files))
    .flatMap(({ path, source }) => skillsDirAbsoluteReads(path, source));
  assertEquals(
    findings,
    [],
    "enumerate authored skills through scanAuthoredSkills (or ask " +
      "src/lib/skills.ts for the paths you need) so linked skills and " +
      "refused links are handled the same everywhere",
  );
});

Deno.test("skill enumeration guard: skillsDirAbsoluteReads cases", () => {
  assertNamedCases({
    "a display read of rel passes": () => {
      assertEquals(
        skillsDirAbsoluteReads(
          "src/a.ts",
          "const label = resolveSkillsDir(root, config).rel;\n",
        ),
        [],
      );
      assertEquals(
        skillsDirAbsoluteReads(
          "src/a.ts",
          "const { rel } = resolveSkillsDir(root, config);\n",
        ),
        [],
      );
    },
    "reading abs is a finding": () => {
      assertEquals(
        skillsDirAbsoluteReads(
          "src/a.ts",
          "const dir = resolveSkillsDir(root, config).abs;\n",
        ),
        ["src/a.ts:1"],
      );
    },
    "destructuring abs is a finding": () => {
      assertEquals(
        skillsDirAbsoluteReads(
          "src/a.ts",
          "const { rel, abs } = resolveSkillsDir(root, config);\n",
        ),
        ["src/a.ts:1"],
      );
    },
    "keeping the whole result is a finding": () => {
      assertEquals(
        skillsDirAbsoluteReads(
          "src/a.ts",
          "const resolved = resolveSkillsDir(root, config);\n" +
            "list(resolved);\n",
        ),
        ["src/a.ts:1"],
      );
    },
  });
});
