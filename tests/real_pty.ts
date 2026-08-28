/** Declared contracts for tests that must cross a real pseudo-terminal. */

import { AsyncLocalStorage } from "async_hooks";

/** The OS-owned properties that deterministic terminal seams cannot create. */
export const REAL_PTY_CONTRACTS = {
  "line-discipline": {
    property: "raw or canonical terminal line discipline and byte delivery",
  },
  "terminal-modes": {
    property: "terminal mode, cursor, and alternate-screen restoration",
  },
  "signal-delivery": {
    property: "signal delivery through the terminal-owned process group",
  },
  "eof-delivery": {
    property: "terminal EOF and hangup delivery",
  },
  "resize-delivery": {
    property: "kernel terminal resize delivery and acknowledgement",
  },
  "control-rendering": {
    property: "actual control-sequence rendering and hardware cell wrapping",
  },
  "process-lifecycle": {
    property: "PTY wrapper, descendant-process, and cleanup lifecycle",
  },
  "platform-transport": {
    property: "BSD and util-linux script(1) transport behavior",
  },
} as const;

export type RealPtyContract = keyof typeof REAL_PTY_CONTRACTS;

export interface RealPtyDeclaration {
  readonly name: string;
  readonly contracts: readonly [RealPtyContract, ...RealPtyContract[]];
  readonly canary: boolean;
}

interface ActiveRealPtyDeclaration extends RealPtyDeclaration {
  uses: number;
  lastProcessEvidence?: string;
}

export interface RealPtyTestOptions extends RealPtyDeclaration {
  readonly ignore?: boolean;
  readonly only?: boolean;
  readonly sanitizeOps?: boolean;
  readonly sanitizeResources?: boolean;
  readonly permissions?: Deno.PermissionOptions;
  readonly fn: (context: Deno.TestContext) => void | Promise<void>;
}

const ACTIVE_REAL_PTY = new AsyncLocalStorage<ActiveRealPtyDeclaration>();

/** Stable failure evidence naming the exercised boundary and host transport. */
export function realPtyEvidence(
  declaration: RealPtyDeclaration,
): string {
  const contracts = declaration.contracts.map((contract) =>
    `${contract}: ${REAL_PTY_CONTRACTS[contract].property}`
  ).join("; ");
  return `real PTY ${JSON.stringify(declaration.name)} on ${Deno.build.os} ` +
    `(canary=${declaration.canary}): ${contracts}`;
}

/** Mark one canonical-driver use and reject undeclared PTY consumers. */
export function claimRealPtyBoundary(): ActiveRealPtyDeclaration {
  const declaration = ACTIVE_REAL_PTY.getStore();
  if (declaration === undefined) {
    throw new Error(
      "real PTY use requires a realPtyTest or withRealPtyBoundary declaration",
    );
  }
  declaration.uses += 1;
  return declaration;
}

/** Retain the most recent successful process evidence for later assertions. */
export function recordRealPtyProcessEvidence(
  declaration: ActiveRealPtyDeclaration,
  evidence: {
    readonly phase: string;
    readonly readiness: readonly string[];
    readonly transcript: string;
  },
): void {
  declaration.lastProcessEvidence = `phase=${
    JSON.stringify(evidence.phase)
  }; readiness=${
    JSON.stringify(evidence.readiness)
  }; raw transcript:\n${evidence.transcript}`;
}

/** Run repository tooling under the same declared boundary as real-PTY tests. */
export async function withRealPtyBoundary<T>(
  declaration: RealPtyDeclaration,
  operation: () => Promise<T>,
): Promise<T> {
  const active: ActiveRealPtyDeclaration = { ...declaration, uses: 0 };
  try {
    const result = await ACTIVE_REAL_PTY.run(active, operation);
    if (active.uses === 0) {
      throw new Error(
        `${realPtyEvidence(declaration)} declared a boundary but opened no PTY`,
      );
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const processEvidence = active.lastProcessEvidence === undefined
      ? ""
      : `\n${active.lastProcessEvidence}`;
    throw new Error(
      `${realPtyEvidence(declaration)}\n${message}${processEvidence}`,
      {
        cause: error,
      },
    );
  }
}

/** Register one test whose successful path must exercise a declared real PTY. */
export function realPtyTest(options: RealPtyTestOptions): void {
  const {
    name,
    contracts,
    canary,
    fn,
    ignore,
    only,
    sanitizeOps,
    sanitizeResources,
    permissions,
  } = options;
  Deno.test({
    name,
    ...(ignore === undefined ? {} : { ignore }),
    ...(only === undefined ? {} : { only }),
    ...(sanitizeOps === undefined ? {} : { sanitizeOps }),
    ...(sanitizeResources === undefined ? {} : { sanitizeResources }),
    ...(permissions === undefined ? {} : { permissions }),
    fn: async (context): Promise<void> => {
      await withRealPtyBoundary({ name, contracts, canary }, async () => {
        await fn(context);
      });
    },
  });
}
