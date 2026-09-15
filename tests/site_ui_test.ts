/** Markup is discoverable as TSX and the shared UI delegates package anatomy. */
import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { Node, Project, SyntaxKind } from "ts-morph";
import { packageManifest } from "discern-design-system";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));
const OWNED_CLASSES = new Set(
  packageManifest.components.flatMap((component) => component.ownedClasses),
);

/** Inspect executable syntax rather than comments or a copied list of renderer names. */
function markupViolations(path: string, text: string): string[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { noLib: true },
    skipAddingFilesFromTsConfig: true,
  });
  const source = project.createSourceFile(path, text);
  const violations: string[] = [];
  for (const node of source.getDescendants()) {
    if (
      !path.endsWith(".tsx") &&
      node.getFirstAncestorByKind(SyntaxKind.ThrowStatement) === undefined &&
      (Node.isStringLiteral(node) ||
        Node.isNoSubstitutionTemplateLiteral(node) ||
        node.isKind(SyntaxKind.TemplateHead) ||
        node.isKind(SyntaxKind.TemplateMiddle) ||
        node.isKind(SyntaxKind.TemplateTail)) &&
      /<\/?[a-z][a-z0-9-]*(?:\s|>)/i.test(node.getText())
    ) {
      violations.push(
        `${path}:${node.getStartLineNumber()}: HTML-producing modules use .tsx`,
      );
    }
    if (!path.startsWith("site/ui/")) continue;
    if (
      Node.isJsxAttribute(node) &&
      node.getNameNode().getText() === "dangerouslySetInnerHTML" &&
      path !== "site/ui/components/HtmlFragment.tsx"
    ) {
      violations.push(`${path}: raw HTML must pass through HtmlFragment`);
    }
    if (
      Node.isJsxAttribute(node) && node.getNameNode().getText() === "className"
    ) {
      const value = node.getInitializer()?.getText() ?? "";
      for (const token of value.split(/[^a-zA-Z0-9_-]+/)) {
        if (OWNED_CLASSES.has(token)) {
          violations.push(
            `${path}: import the design-system component owning ${token}`,
          );
        }
      }
    }
    if (Node.isImportSpecifier(node) && node.getName() === "semanticClass") {
      violations.push(
        `${path}: use the package React component instead of rebuilding semantic classes`,
      );
    }
    if (
      (Node.isStringLiteral(node) ||
        Node.isNoSubstitutionTemplateLiteral(node) ||
        node.isKind(SyntaxKind.TemplateHead)) &&
      /<[a-z][a-z0-9-]*(?:\s|>)/i.test(node.getText())
    ) {
      violations.push(
        `${path}: compose HTML with JSX instead of a markup string`,
      );
    }
  }
  return violations;
}

Deno.test("new site renderers and copied package classes enroll in the TSX boundary", () => {
  assert(
    markupViolations(
      "site/future.ts",
      'export const render=()=>"<article>Hello</article>";',
    ).length > 0,
  );
  const token = [...OWNED_CLASSES][0];
  assert(token);
  assert(
    markupViolations(
      "site/ui/pages/Future.tsx",
      `const Page=()=> <div className="${token}" />;`,
    ).length > 0,
  );
  assert(
    markupViolations(
      "site/ui/pages/Future.tsx",
      'const Page=()=>"<header>Hello</header>";',
    ).length > 0,
  );
  assert(
    markupViolations(
      "site/ui/pages/Future.tsx",
      "const Page=()=> <div dangerouslySetInnerHTML={{__html:source}} />;",
    ).length > 0,
  );
  assertEquals(
    markupViolations(
      "site/parser.ts",
      'throw new Error("expected <semver>.md");',
    ),
    [],
  );
  assertEquals(
    markupViolations(
      "site/ui/pages/Future.tsx",
      'import { Card } from "discern-design-system/react"; const Page=()=> <Card className="future-card">Hello</Card>;',
    ),
    [],
  );
});

Deno.test("site markup sources use TSX and shared UI consumes package components", async () => {
  const paths = await structuralGuardScope({
    guard: "tests/site_ui_test.ts#site-markup",
    universe: "authored-ts",
    narrow: {
      reason:
        "The website's HTML authoring convention applies to site modules; binary and tooling output have separate contracts.",
      include: (path) => path.startsWith("site/"),
    },
  });
  const violations = (await Promise.all(
    paths.map(async (path) =>
      markupViolations(path, await Deno.readTextFile(join(ROOT, path)))
    ),
  )).flat();
  assertEquals(violations, []);
});
