import { RECOVERY_MANIFEST_FORMAT } from "./snapshot_schema.ts";
import { EnvironmentSchema } from "../completion/environment.ts";
/** Pure recovery reference interpretation and bounded closed deletion planning. */
import { ExecutionIntentSchema } from "./intent.ts";
import { WorkspaceStateSchema } from "./workspace_state.ts";
import {
  GitSnapshotSchema,
  PayloadReferenceSchema,
  SnapshotSchema,
} from "./snapshot_schema.ts";
import { ArtifactSchema } from "../completion/evidence.ts";
import { sha256Hex } from "../../shared/sha256.ts";

export interface ArtifactReferences {
  readonly artifacts: readonly string[];
  readonly payloads: readonly string[];
  readonly receipts?: readonly import("./types.ts").EnvironmentArtifact[];
}

/** Reference shapes, not field names or enclosing families, enroll future consumers. */
export function executionArtifactReferences(
  value: unknown,
): ArtifactReferences {
  const artifacts = new Set<string>();
  const payloads = new Set<string>();
  const receipts: import("./types.ts").EnvironmentArtifact[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const artifact = ArtifactSchema.safeParse(node);
    if (artifact.success) {
      artifacts.add(`${artifact.data.attempt_id}/${artifact.data.path}`);
      receipts.push(artifact.data);
      return;
    }
    if ("attempt_id" in node && "path" in node && "digest" in node) {
      throw new Error("An unknown artifact reference prevents reclamation.");
    }
    const environment = EnvironmentSchema.safeParse(node);
    if (environment.success) {
      visit(environment.data.state);
      return;
    }
    if ("format" in node) {
      const workspace = WorkspaceStateSchema.safeParse(node);
      if (workspace.success) {
        visit(workspace.data.git);
        return;
      }
      const git = GitSnapshotSchema.safeParse(node);
      if (git.success) {
        if (
          git.data.format === RECOVERY_MANIFEST_FORMAT
        ) {
          payloads.add(PayloadReferenceSchema.parse(git.data.index));
          for (const file of git.data.files) {
            if (file.kind === "file") {
              payloads.add(PayloadReferenceSchema.parse(file.contents));
            }
          }
        }
        return;
      }
      if (
        ![ExecutionIntentSchema, WorkspaceStateSchema].some((schema) =>
          schema.safeParse(node).success
        )
      ) throw new Error("An unknown recovery format prevents reclamation.");
    }
    Object.values(node).forEach(visit);
  };
  visit(value);
  return { artifacts: [...artifacts], payloads: [...payloads], receipts };
}

export interface RecoveryArtifactNode extends ArtifactReferences {
  readonly coordinate: string;
  readonly bytes: number;
  readonly digest?: string;
}
export interface RecoveryReclamationPlan {
  readonly manifests: readonly string[];
  readonly payloads: readonly string[];
  readonly retained: readonly string[];
  readonly staging?: readonly string[];
  readonly deferred?: readonly ("unfinished-execution" | "batch-limit")[];
}

/** Parent-first deletion leaves a complete graph after every interrupted prefix. */
function deletionOrder(
  nodes: readonly RecoveryArtifactNode[],
  selected: ReadonlySet<string>,
  incoming: ReadonlyMap<string, readonly string[]>,
): string[] {
  const remaining = new Map(
    nodes.filter((node) => selected.has(node.coordinate)).map(
      (node) => [node.coordinate, {
        node,
        incoming: (incoming.get(node.coordinate) ?? []).filter((parent) =>
          selected.has(parent)
        ).length,
      }],
    ),
  );
  const ready = [...remaining.values()].filter((entry) => entry.incoming === 0);
  const ordered: string[] = [];
  for (const entry of ready) {
    ordered.push(entry.node.coordinate);
    for (const reference of entry.node.artifacts) {
      const child = remaining.get(reference);
      if (child !== undefined && --child.incoming === 0) ready.push(child);
    }
  }
  if (ordered.length !== remaining.size) {
    throw new Error(
      "A cyclic recovery artifact graph prevents interruptible reclamation; preserve all artifacts for reconciliation.",
    );
  }
  return ordered;
}

/** A closed graph rejects dangling references and protects active roots and retained record revisions. */
export function planRecoveryReclamation(
  nodes: readonly RecoveryArtifactNode[],
  roots: readonly string[],
  eligible: ReadonlySet<string>,
  batchSize = 128,
): RecoveryReclamationPlan {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error("Reclamation requires a positive bounded batch size.");
  }
  const byKey = new Map(nodes.map((node) => [node.coordinate, node]));
  if (byKey.size !== nodes.length) {
    throw new Error("Duplicate artifact coordinates prevent reclamation.");
  }
  for (const node of nodes) {
    for (const reference of node.artifacts) {
      if (!byKey.has(reference)) {
        throw new Error(
          `Unknown artifact reference ${reference} prevents reclamation.`,
        );
      }
    }
  }
  const retained = new Set<string>();
  const pending = [
    ...roots,
    ...nodes.filter((node) => !eligible.has(node.coordinate)).map((node) =>
      node.coordinate
    ),
  ];
  while (pending.length > 0) {
    const key = pending.pop();
    if (key === undefined || retained.has(key)) continue;
    const node = byKey.get(key);
    if (node === undefined) {
      throw new Error(
        `Unknown artifact reference ${key} prevents reclamation.`,
      );
    }
    retained.add(key);
    pending.push(...node.artifacts);
  }
  // Delete a closed batch: an artifact left for a later pass must never
  // reference a document removed now. Include every incoming parent in the batch.
  const incoming = new Map<string, string[]>();
  for (const node of nodes) {
    for (const reference of node.artifacts) {
      const parents = incoming.get(reference) ?? [];
      parents.push(node.coordinate);
      incoming.set(reference, parents);
    }
  }
  const selected = new Set<string>();
  const limit = Math.min(batchSize, 128);
  for (const node of nodes) {
    if (retained.has(node.coordinate) || selected.has(node.coordinate)) {
      continue;
    }
    const closure = new Set<string>();
    const parents = [node.coordinate];
    while (parents.length > 0 && closure.size + selected.size <= limit) {
      const key = parents.pop();
      if (key === undefined || selected.has(key) || closure.has(key)) continue;
      closure.add(key);
      parents.push(...(incoming.get(key) ?? []));
    }
    if (closure.size + selected.size <= limit) {
      for (const key of closure) selected.add(key);
    }
  }
  const deferred = nodes.some((node) =>
    !retained.has(node.coordinate) && !selected.has(node.coordinate)
  );
  if (deferred && selected.size === 0) {
    throw new Error(
      "A closed recovery reference component exceeds the deletion batch; preserve it for reconciliation.",
    );
  }
  for (const node of nodes) {
    if (!selected.has(node.coordinate)) retained.add(node.coordinate);
  }
  const manifests = deletionOrder(nodes, selected, incoming);
  const keepPayloads = new Set(
    nodes.filter((node) => retained.has(node.coordinate)).flatMap((node) =>
      node.payloads
    ),
  );
  const payloads = [
    ...new Set(
      nodes.filter((node) => !retained.has(node.coordinate)).flatMap((
        node,
      ) => node.payloads),
    ),
  ].filter((reference) => !keepPayloads.has(reference));
  return {
    manifests,
    payloads,
    retained: [...retained],
    ...(deferred ? { deferred: ["batch-limit" as const] } : {}),
  };
}

/** A corrupted frozen digest cannot erase an edge from the recovery graph. */
export async function verifySnapshotDigests(value: unknown): Promise<void> {
  if (value === null || typeof value !== "object") return;
  if ("digest" in value && "value" in value) {
    const snapshot = SnapshotSchema.parse(value);
    if (await sha256Hex(JSON.stringify(snapshot.value)) !== snapshot.digest) {
      throw new Error(
        "A frozen snapshot failed its content check; preserve every recovery payload.",
      );
    }
    return;
  }
  for (const nested of Object.values(value)) {
    await verifySnapshotDigests(nested);
  }
}
