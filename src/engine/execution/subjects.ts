import { RECOVERY_MANIFEST_FORMAT } from "./snapshot_schema.ts";
import { RELEASE_OBSERVATION_FORMAT } from "./snapshot_schema.ts";
/** Pure release subjects shared by observation and effectful registration. */
import {
  type EnvironmentDeclaration,
  EnvironmentDeclarationSchema,
} from "../../shared/config_schema.ts";
import type { ExecutionEnvironment } from "../completion/environment.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import type { WorkspaceSnapshot } from "./snapshot_schema.ts";
import { WorkspaceStateSchema } from "./workspace_state.ts";

/** Freeze normalized declaration bytes, retaining the distinct source-tip case. */
export async function declarationIdentity(
  declaration: EnvironmentDeclaration | null,
): Promise<string> {
  return await sha256Hex(
    JSON.stringify(
      declaration === null
        ? "source-tip"
        : EnvironmentDeclarationSchema.parse(declaration),
    ),
  );
}

/** Resolve the recorded contract, including source execution without borrowing. */
export async function enrolledDeclaration(
  environment: ExecutionEnvironment,
  declarations: readonly EnvironmentDeclaration[],
): Promise<EnvironmentDeclaration | null> {
  for (const declaration of [null, ...declarations]) {
    if (environment.declaration === await declarationIdentity(declaration)) {
      return declaration;
    }
  }
  throw new Error(
    "The enrolled execution declaration is unavailable. Preserve its frozen recovery contract and reconcile the intended declaration before release or cleanup.",
  );
}

/** Release binds checkout state and ownership independently of candidate selection. */
export async function releasedSubject(
  environment: ExecutionEnvironment,
  snapshot: WorkspaceSnapshot,
): Promise<string> {
  const state = WorkspaceStateSchema.safeParse(snapshot.value);
  let identity = snapshot.digest;
  if (state.success && state.data.git !== null) {
    // Recovery keeps exact index bytes. Release identity uses the captured
    // entries, staged patch and complete files; native capture rejects index
    // flags and layouts whose semantics those observations cannot preserve.
    const { index: _index, ...captured } = state.data.git;
    const git = captured.format === RECOVERY_MANIFEST_FORMAT ||
        captured.format === RELEASE_OBSERVATION_FORMAT
      ? { ...captured, format: RELEASE_OBSERVATION_FORMAT }
      : captured;
    identity = await sha256Hex(JSON.stringify({ ...state.data, git }));
  }
  return await releaseDigest(environment, identity);
}

/** Existing exact-byte releases remain usable only while their exact subject matches. */
export async function releaseMatchesSnapshot(
  environment: ExecutionEnvironment,
  snapshot: WorkspaceSnapshot,
): Promise<boolean> {
  return environment.release.kind === "released" &&
    (environment.release.subject ===
        await releasedSubject(environment, snapshot) ||
      environment.release.subject ===
        await releaseDigest(environment, snapshot.digest));
}

/** Bind the state identity to this exact ownership and declaration. */
async function releaseDigest(
  environment: ExecutionEnvironment,
  snapshot: string,
): Promise<string> {
  return await sha256Hex(
    JSON.stringify({
      path: environment.path,
      declaration: environment.declaration,
      ownership: environment.ownership,
      snapshot,
    }),
  );
}
