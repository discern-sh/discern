/** Discern may invoke local Git, but may neither choose transport nor own hooks. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, SyntaxKind } from "ts-morph";
import { DISCERN_FORBIDDEN_GIT_TRANSPORT_SUBCOMMANDS } from "../src/shared/subprocess.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const TRANSPORT = new Set<string>(DISCERN_FORBIDDEN_GIT_TRANSPORT_SUBCOMMANDS);

/** Extract a literal string without treating templates or identifiers as proof. */
function literalText(node: Node | undefined): string | undefined {
  return node !== undefined &&
      (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
    ? node.getLiteralText()
    : undefined;
}

/** Find transport argv and Git-hook mutation spellings in one TypeScript source. */
function gitBoundaryViolations(source: string, path: string): string[] {
  const project = new Project({
    compilerOptions: { noLib: true },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const file = project.createSourceFile(path, source);
  const violations: string[] = [];
  for (
    const array of file.getDescendantsOfKind(
      SyntaxKind.ArrayLiteralExpression,
    )
  ) {
    const values = array.getElements().map(literalText);
    const first = values[0];
    if (first !== undefined && TRANSPORT.has(first)) {
      violations.push(`${path}: Git transport argv starts with ${first}`);
    }
    if (first === "remote" && values.includes("update")) {
      violations.push(`${path}: git remote update initiates transport`);
    }
    if (
      first === "archive" &&
      values.some((value) =>
        value === "--remote" || value?.startsWith("--remote=")
      )
    ) {
      violations.push(`${path}: git archive --remote initiates transport`);
    }
  }
  for (const literal of file.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const value = literal.getLiteralText();
    const lower = value.toLowerCase();
    if (lower === "core.hookspath") {
      violations.push(`${path}: core.hooksPath mutation surface`);
    }
    if (/(?:^|\/)\.git\/hooks(?:\/|$)/u.test(value)) {
      violations.push(`${path}: direct .git/hooks path`);
    }
    if (lower === "hooks") {
      const call = literal.getFirstAncestorByKind(SyntaxKind.CallExpression);
      if (
        call !== undefined && /\b(?:git|common).*dir\b/iu.test(call.getText())
      ) {
        violations.push(`${path}: Git-directory hooks path construction`);
      }
    }
  }
  return [...new Set(violations)].sort();
}

Deno.test("the shipped source chooses no Git transport and mutates no Git hook path", async () => {
  const files = await structuralGuardScope({
    guard: "tests/git_transport_boundary_test.ts#local-git-only",
    universe: "authored-ts",
    narrow: {
      reason:
        "The local-Git product boundary governs shipped source; repository tooling and test harnesses are owner-invoked programs.",
      include: (path) =>
        path.startsWith("src/") && path !== "src/shared/subprocess.ts",
    },
  });
  const violations: string[] = [];
  for (const path of files) {
    violations.push(...gitBoundaryViolations(
      await Deno.readTextFile(join(REPO_ROOT, path)),
      path,
    ));
  }
  assertEquals(violations.sort(), []);
});

Deno.test("the local-Git guard detects transport verbs and both hook mutation forms", () => {
  assertEquals(
    gitBoundaryViolations(
      [
        'runGit(["push", "origin", "main"], { cwd });',
        'runGit(["remote", "update"], { cwd });',
        'runGit(["archive", "--remote=origin", "HEAD"], { cwd });',
        'runGit(["config", "core.hooksPath", "x"], { cwd });',
        'join(commonGitDir, "hooks", "pre-commit");',
        'const direct = ".git/hooks/post-checkout";',
      ].join("\n"),
      "fixture.ts",
    ),
    [
      "fixture.ts: Git transport argv starts with push",
      "fixture.ts: Git-directory hooks path construction",
      "fixture.ts: core.hooksPath mutation surface",
      "fixture.ts: direct .git/hooks path",
      "fixture.ts: git archive --remote initiates transport",
      "fixture.ts: git remote update initiates transport",
    ],
  );
});
