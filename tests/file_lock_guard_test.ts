/** Native advisory-lock primitives stay behind one release-owning abstraction. */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ts } from "ts-morph";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const NATIVE_METHODS = new Set(
  Object.getOwnPropertyNames(Deno.FsFile.prototype).filter((name) =>
    /lock/i.test(name)
  ),
);

/** Locate direct and literal-indexed calls, ignoring comments and fixture text. */
function nativeLockCalls(source: string): string[] {
  const file = ts.createSourceFile(
    "source.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const findings: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isElementAccessExpression(callee) &&
            ts.isStringLiteral(callee.argumentExpression)
        ? callee.argumentExpression.text
        : undefined;
      if (name !== undefined && NATIVE_METHODS.has(name)) findings.push(name);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

Deno.test("native file locks enroll in explicit ownership release", async () => {
  const findings: string[] = [];
  for (
    const file of await structuralGuardScope({
      guard: "tests/file_lock_guard_test.ts#native-lock-ownership",
      universe: "authored-ts",
      narrow: {
        reason:
          "Production lock users share the owner; test fixtures may exercise the native primitives directly.",
        include: (path) =>
          path !== "src/shared/file_lock.ts" && !path.startsWith("tests/"),
      },
    })
  ) {
    for (
      const method of nativeLockCalls(
        await Deno.readTextFile(join(REPO_ROOT, file)),
      )
    ) {
      findings.push(
        `${file}: ${method}; use FileLock so closing explicitly releases ownership`,
      );
    }
  }
  assertEquals(findings, []);
});

Deno.test("file-lock enrollment covers every native locking entry point", () => {
  for (const method of NATIVE_METHODS) {
    assertEquals(nativeLockCalls(`await file.${method}(true);`), [method]);
    assertEquals(nativeLockCalls(`await file["${method}"](true);`), [method]);
    assertEquals(
      nativeLockCalls(`// file.${method}();\nconst text = 'file.${method}()';`),
      [],
    );
  }
  assertEquals(nativeLockCalls("await file.tryAcquire(); file.close();"), []);
});
