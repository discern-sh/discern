/** Pure release subjects shared by observation and effectful registration. */
import {
  type EnvironmentDeclaration,
  EnvironmentDeclarationSchema,
} from "../../shared/config_schema.ts";
import type { ExecutionEnvironment } from "../completion/environment.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import type { WorkspaceSnapshot } from "./snapshot_schema.ts";

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

/** Release binds checkout state and ownership independently of candidate selection. */
export async function releasedSubject(
  environment: ExecutionEnvironment,
  snapshot: WorkspaceSnapshot,
): Promise<string> {
  return await sha256Hex(
    JSON.stringify({
      path: environment.path,
      declaration: environment.declaration,
      ownership: environment.ownership,
      snapshot: snapshot.digest,
    }),
  );
}
