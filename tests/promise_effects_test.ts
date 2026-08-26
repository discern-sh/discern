/** Focused proof that the promise-effect detector uses resolved TypeScript types. */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  createPromiseEffectsProject,
  detachedPromiseBoundaryFindings,
  productionPromiseEffectFiles,
  promiseEffectFindingsInFiles,
  validateDetachedPromiseBoundaries,
  validatePromiseEffects,
} from "../scripts/promise_effects.ts";
import {
  type DetachedPromiseBoundary,
  detachedPromiseBoundaryCount,
  detachPromise,
} from "../src/shared/promise_effects.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const FIXTURE_ROOT = join(REPO_ROOT, "tests", "fixtures", "promise_effects");

Deno.test("the actual Deno project resolves imported and generic promise-like expressions", async () => {
  const project = await createPromiseEffectsProject();
  const imported = project.addSourceFileAtPath(
    join(FIXTURE_ROOT, "imported.ts"),
  );
  const consumer = project.addSourceFileAtPath(
    join(FIXTURE_ROOT, "consumer.ts"),
  );
  project.resolveSourceFileDependencies();

  const options = project.getCompilerOptions();
  assertEquals(options.strict, true);
  assertEquals(options.noUncheckedIndexedAccess, true);
  assertEquals(options.exactOptionalPropertyTypes, true);

  const findings = promiseEffectFindingsInFiles(
    [imported, consumer],
  );
  assertEquals(
    findings.map((finding) => [
      finding.expression,
      finding.reason,
    ]),
    [
      ["promisedEffect()", "ignored-promise"],
      ["thenableEffect()", "ignored-promise"],
      ["unionEffect()", "ignored-promise"],
      ['overloadedEffect("async")', "ignored-promise"],
      ["genericEffect(Promise.resolve(1))", "ignored-promise"],
      ['ensureDir("fixture")', "ignored-promise"],
      ["void promisedEffect()", "naked-void"],
      ["void void promisedEffect()", "naked-void"],
      ["promisedEffect()", "ignored-promise"],
      [
        "promisedEffect().then(() => undefined, () => undefined)",
        "ignored-promise",
      ],
    ],
  );
});

/** Build one complete synthetic deliberate-detachment registry row. */
function boundary(
  overrides: Partial<DetachedPromiseBoundary> = {},
): DetachedPromiseBoundary {
  return {
    path: "src/future.ts",
    enclosingFunction: "startFuture",
    operation: "run one planted future background effect",
    lifecycleOwner: "the planted future service lifecycle",
    rejectionPolicy: {
      kind: "report",
      authority: "globalThis.reportError",
    },
    cancellationOwnership:
      "the planted future service closes the effect during its shutdown sequence",
    reason:
      "the caller must continue while the planted future service owns completion",
    ...overrides,
  };
}

/** One synthetic production module at the shared promise authority's sibling. */
function futureSource(source: string): {
  readonly path: string;
  readonly source: string;
}[] {
  return [{ path: "src/future.ts", source }];
}

Deno.test("detached promise calls and registry entries bind in both directions", () => {
  const source = futureSource(`
import { detachPromise } from "./shared/promise_effects.ts";
export function startFuture(): void {
  detachPromise(
    "future-background",
    () => Promise.resolve(),
    globalThis.reportError,
  );
}
`);
  assertEquals(
    detachedPromiseBoundaryFindings(source, {
      "future-background": boundary(),
    }),
    [],
  );
});

Deno.test("unknown, duplicate, moved, and stale detachment entries fail", () => {
  const source = futureSource(`
import { detachPromise } from "./shared/promise_effects.ts";
export function startFuture(): void {
  detachPromise("unknown-background", () => Promise.resolve(), globalThis.reportError);
}
`);
  assert(
    detachedPromiseBoundaryFindings(source, {}).some((finding) =>
      finding.includes("unknown detached promise boundary")
    ),
  );
  assertEquals(
    detachedPromiseBoundaryFindings([], {
      "future-background": boundary(),
    }).includes("stale detached promise boundary 'future-background'"),
    true,
  );

  const duplicate = futureSource(`
import { detachPromise } from "./shared/promise_effects.ts";
export function startFuture(): void {
  detachPromise("future-background", () => Promise.resolve(), globalThis.reportError);
  detachPromise("future-background", () => Promise.resolve(), globalThis.reportError);
}
`);
  assert(
    detachedPromiseBoundaryFindings(duplicate, {
      "future-background": boundary(),
    }).some((finding) => finding.includes("has 2 live sites")),
  );

  assert(
    detachedPromiseBoundaryFindings(source, {
      "unknown-background": boundary({ path: "src/moved.ts" }),
    }).some((finding) => finding.includes("moved:")),
  );
});

Deno.test("dynamic IDs, forwarding, re-exports, and reporter drift cannot bypass detachment", () => {
  const findings = detachedPromiseBoundaryFindings(
    futureSource(`
import { detachPromise } from "./shared/promise_effects.ts";
export { detachPromise as forwardedDetach } from "./shared/promise_effects.ts";
export function startFuture(id: "future-background"): void {
  const forwarded = detachPromise;
  detachPromise(id, () => Promise.resolve(), globalThis.reportError);
  detachPromise("future-background", () => Promise.resolve(), async (error) => {
    globalThis.reportError(error);
  });
  forwarded;
}
`),
    { "future-background": boundary() },
  );
  assert(findings.some((finding) => finding.includes("re-exports")));
  assert(findings.some((finding) => finding.includes("string literal")));
  assert(findings.some((finding) => finding.includes("forwarded or aliased")));
  assert(
    findings.some((finding) =>
      finding.includes("must handle rejection through globalThis.reportError")
    ),
  );
});

Deno.test("a new authored source root auto-enrols in typed promise detection", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, "future-source"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "deno.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noUncheckedIndexedAccess: true,
          exactOptionalPropertyTypes: true,
        },
        imports: {},
      }),
    );
    await Deno.writeTextFile(
      join(root, "future-source", "effects.ts"),
      `
export interface Thenable<T> {
  then(onfulfilled: (value: T) => unknown, onrejected?: (reason: unknown) => unknown): PromiseLike<unknown>;
}
export declare function promised(): Promise<number>;
export declare function thenable(): Thenable<string>;
export declare function maybe(): void | Promise<number>;
export declare function generic<T>(value: T): T;
export declare function synchronous(): void;
`,
    );
    await Deno.writeTextFile(
      join(root, "future-source", "consumer.ts"),
      `
import { generic, maybe, promised, synchronous, thenable } from "./effects.ts";
promised();
thenable();
maybe();
generic(Promise.resolve(1));
synchronous();
await promised();
const owned = promised();
`,
    );
    await gitInit(root);

    assertEquals(await productionPromiseEffectFiles(root), [
      "future-source/consumer.ts",
      "future-source/effects.ts",
    ]);
    assertEquals(
      (await validatePromiseEffects(root)).map((finding) => finding.expression),
      [
        "promised()",
        "thenable()",
        "maybe()",
        "generic(Promise.resolve(1))",
      ],
    );
  });
});

Deno.test("detachPromise starts immediately but leaves completion to its lifecycle owner", async () => {
  let started = false;
  let finished = false;
  let resolveEffect: () => void = () => undefined;
  const effect = new Promise<void>((resolve) => {
    resolveEffect = resolve;
  });
  detachPromise(
    "canon-editor-guard-run",
    () => {
      started = true;
      return effect.then(() => {
        finished = true;
      });
    },
    () => undefined,
  );
  assertEquals(started, true);
  assertEquals(finished, false);
  resolveEffect();
  await effect;
  await Promise.resolve();
  assertEquals(finished, true);
});

Deno.test("detachPromise catches thunk failures and never emits an unhandled rejection", async () => {
  const thunkError = new Error("thunk failed");
  let reported: unknown;
  detachPromise(
    "canon-editor-guard-run",
    () => {
      throw thunkError;
    },
    (error) => {
      reported = error;
    },
  );
  assertEquals(reported, thunkError);

  let rejectEffect: (reason?: unknown) => void = () => undefined;
  const rejection = new Error("detached rejection");
  const effect = new Promise<void>((_resolve, reject) => {
    rejectEffect = reject;
  });
  let unhandled = 0;
  const sentinel = (event: PromiseRejectionEvent): void => {
    unhandled++;
    event.preventDefault();
  };
  globalThis.addEventListener("unhandledrejection", sentinel);
  try {
    detachPromise(
      "canon-editor-guard-run",
      effect,
      (error) => {
        reported = error;
      },
    );
    rejectEffect(rejection);
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(reported, rejection);
    assertEquals(unhandled, 0);
  } finally {
    globalThis.removeEventListener("unhandledrejection", sentinel);
  }

  let started = false;
  assertThrows(
    () =>
      Reflect.apply(detachPromise, undefined, [
        "unknown-detachment",
        () => {
          started = true;
          return Promise.resolve();
        },
        () => undefined,
      ]),
    TypeError,
    "unknown detached promise boundary",
  );
  assertEquals(started, false);
});

Deno.test("the live typed population and detachment registry match exactly", async () => {
  assertEquals(
    await validateDetachedPromiseBoundaries(),
    detachedPromiseBoundaryCount(),
  );
});
