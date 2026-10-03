/** Every Desk effect boundary declares its executor; new runtime members must classify. */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, SyntaxKind } from "ts-morph";
import type { DeskRuntime } from "../src/engine/desk/desk.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

// Null members observe, present, or persist presentation preferences; they do not operate on tasks.
const BOUNDARIES = {
  manual: null,
  canInteract: null,
  inDeskSession: null,
  findRoot: null,
  loadConfig: null,
  status: null,
  probe: null,
  mainRepoPath: null,
  releaseCheck: null,
  grantEffortPlan: null,
  grantEffort: "executeDeskOperation",
  clearEffortGrantPlan: null,
  clearEffortGrant: "executeDeskOperation",
  makeOut: null,
  error: null,
  application: null,
  terminations: null,
  raise: null,
  pause: null,
  lifecycle: null,
  done: "executeDeskOperation",
  donePlan: null,
  acceptPlan: null,
  accept: "executeDeskOperation",
  submit: "executeDeskOperation",
  update: "executeDeskOperation",
  updatePlan: null,
  setup: "executeDeskOperation",
  setupPlan: null,
  drop: "executeDeskOperation",
  dropPlan: null,
  park: "executeDeskOperation",
  parkPlan: null,
  reclaim: "executeDeskOperation",
  reclaimPlan: null,
  git: null,
  proof: null,
  landedProof: null,
  operationRecord: null,
  pager: null,
  editor: null,
  openEditor: "runDeskInteractiveChild",
  interactive: "runDeskInteractiveChild",
  detectAgents: null,
  startPlan: null,
  start: "executeDeskOperation",
  renamePlan: null,
  rename: "executeDeskOperation",
  scripts: null,
  runScript: "runDeskProjectScript",
  openBrowser: null,
  fileDigest: null,
  now: null,
  scheduler: null,
  readTipState: null,
  writeTipState: null,
  readPreferences: null,
  writePreferences: null,
  recordTipShown: null,
} satisfies Record<keyof DeskRuntime, string | null>;

Deno.test("Desk task effects cross shared execution and never acquire direct operation locks", async () => {
  const files = await structuralGuardScope({
    guard: "tests/engine_desk_execution_guard_test.ts#shared-execution",
    universe: "authored-ts",
    narrow: {
      reason:
        "Desk is the human invocation surface whose effects must enter the shared executor.",
      include: (path) => path.startsWith("src/engine/desk/"),
    },
  });
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { noLib: true },
    skipAddingFilesFromTsConfig: true,
  });
  for (const file of files) {
    const source = project.createSourceFile(
      file,
      await Deno.readTextFile(join(REPO_ROOT, file)),
    );
    assertEquals(
      source.getDescendantsOfKind(SyntaxKind.Identifier).filter((node) =>
        node.getText() === "withOperationLock"
      ).length,
      0,
      file,
    );
  }
  const source = project.getSourceFileOrThrow("src/engine/desk/desk.ts");
  const defaults = source.getVariableDeclarationOrThrow("DEFAULT_DESK_RUNTIME")
    .getInitializerOrThrow();
  assert(Node.isObjectLiteralExpression(defaults));
  // A runtime member spread in from another Desk module, such as the
  // landing flow's permission seams, is classified where it is written.
  const literals = [
    defaults,
    ...defaults.getProperties().filter(Node.isSpreadAssignment).map(
      (spread) => {
        const name = spread.getExpression().getText();
        const initializer = project.getSourceFiles().flatMap((file) =>
          file.getVariableDeclarations()
        ).find((declaration) => declaration.getName() === name)
          ?.getInitializer();
        assert(
          Node.isObjectLiteralExpression(initializer),
          `${name} must be an object literal in a Desk module`,
        );
        return initializer;
      },
    ),
  ];
  for (const [method, executor] of Object.entries(BOUNDARIES)) {
    if (executor === null) continue;
    const property = literals.map((literal) => literal.getProperty(method))
      .find((candidate) => candidate !== undefined);
    assert(property !== undefined, `${method} has no default runtime`);
    assert(
      property.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) =>
        call.getExpression().getText() === executor
      ),
      `${method} must enter ${executor}`,
    );
  }
  const execution = project.getSourceFileOrThrow(
    "src/engine/desk/execution.ts",
  );
  for (const helper of ["runDeskInteractiveChild", "runDeskProjectScript"]) {
    assert(
      execution.getFunctionOrThrow(helper).getDescendantsOfKind(
        SyntaxKind.CallExpression,
      ).some((call) =>
        call.getExpression().getText() === "executeDeskOperation"
      ),
      helper,
    );
  }
  assert(
    execution.getFunctionOrThrow("executeDeskOperation").getDescendantsOfKind(
      SyntaxKind.CallExpression,
    ).some((call) => call.getExpression().getText() === "executeOperation"),
  );
});
