import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import { requireKnownExecutionArtifact } from "./artifact_contracts.ts";
import {
  completionPublicationPath,
  invalidateCompletionPublication,
  readCompletionPublication,
} from "../completion/publication_witness.ts";
import { readBoundedExecutionDocument } from "./artifact_read.ts";
import {
  type ArtifactReferences,
  executionArtifactReferences,
  planRecoveryReclamation,
  type RecoveryArtifactNode,
  type RecoveryReclamationPlan,
  verifySnapshotDigests,
} from "./reclamation_graph.ts";
export {
  type ArtifactReferences,
  executionArtifactReferences,
  planRecoveryReclamation,
  type RecoveryArtifactNode,
  type RecoveryReclamationPlan,
} from "./reclamation_graph.ts";
/** Reclamation follows every durable reference; uncertainty never grants deletion. */
import {
  isAtomicReplaceTempName,
  removeIfExists,
} from "../../shared/atomic_write.ts";
import { dirname, join } from "@std/path";
import {
  COMPLETION_FAMILIES,
  type CompletionRecord,
} from "../completion/records.ts";
import { RecordIdSchema } from "../completion/identity.ts";
import {
  GIT_ADMIN_STATE,
  gitAdminStatePath,
} from "../../shared/git_admin_state.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { parseCompletionRecord } from "../completion/store.ts";
import { resolveCommonGitDir } from "../worktree/git.ts";
import { withCompletionPublication } from "../operation_lock.ts";
import { openArtifactPaths } from "../completion/artifact_paths.ts";
import { EXECUTION_DOCUMENT_BYTES } from "./artifacts.ts";
import { encodeExecutionDocument } from "./document_encoding.ts";
import { recoveryPayloadPath } from "./payloads.ts";
import {
  recoveryStoragePath,
  withRecoveryStorage,
} from "./storage_lifetime.ts";

const RECOVERY_INVENTORY_ENTRIES = 100_000;

/** Bound each directory observation before building its immutable comparison stamp. */
async function fingerprint(path: string): Promise<string> {
  const stat = await Deno.lstat(path);
  if (stat.isSymlink) throw new Error("Symlink storage prevents reclamation.");
  const names = [];
  if (stat.isDirectory) {
    for await (const entry of Deno.readDir(path)) {
      if (names.length >= RECOVERY_INVENTORY_ENTRIES) {
        throw new Error(
          "Recovery directory inventory exceeds its entry bound; preserve all artifacts.",
        );
      }
      names.push(entry.name);
    }
  }
  return await sha256Hex(encodeExecutionDocument([
    path,
    stat.dev,
    stat.ino,
    stat.size,
    stat.mtime,
    stat.ctime,
    names.sort(),
  ]));
}

/** Consume the full repository graph and delete only named finished attempts' unreferenced recovery manifests.
 * Retirement calls this after its environment is disposed. Writers must use withRecoveryStorage from
 * observation through publication; the native executor already does. Every retained record revision remains intact.
 */
export async function reclaimExecutionStorage(
  root: string,
  attemptIds: readonly string[],
  dryRun = false,
): Promise<RecoveryReclamationPlan> {
  const publicationPath = await completionPublicationPath(root);
  const publication = await readCompletionPublication(publicationPath);
  const prepared = await withRecoveryStorage(root, async () => {
    const recordDirectory = await gitAdminStatePath(root, "completionRecords");
    const artifactDirectory = await gitAdminStatePath(
      root,
      "completionArtifacts",
    );
    if (recordDirectory === undefined || artifactDirectory === undefined) {
      throw new Error(
        "Storage inventory is unavailable; preserve recovery artifacts.",
      );
    }
    const artifactPaths = await openArtifactPaths(root);
    const watched: string[] = [];
    const original: string[] = [];
    let documentBytes = 0;
    const charge = (bytes: number): void => {
      documentBytes += bytes;
      if (documentBytes > EXECUTION_DOCUMENT_BYTES) {
        throw new Error(
          "Recovery reference graph exceeds its bounded observation budget; preserve all artifacts.",
        );
      }
    };
    const watch = async (path: string, document = false): Promise<void> => {
      charge(new TextEncoder().encode(path).length + 64);
      if (document) charge((await Deno.lstat(path)).size);
      if (watched.length >= RECOVERY_INVENTORY_ENTRIES) {
        throw new Error(
          "Recovery reference inventory exceeds its entry bound; preserve all artifacts.",
        );
      }
      const stamp = await fingerprint(path);
      watched.push(path);
      original.push(stamp);
    };
    await watch(recordDirectory);
    await watch(artifactDirectory);
    const historical: CompletionRecord[] = [];
    const records: CompletionRecord[] = [];
    const histories = new Map<string, Map<number, string>>();
    const currentStamps = new Map<string, string>();
    const implicitAttempts = new Set<string>();
    const readRecord = async (
      path: string,
      kind: keyof typeof COMPLETION_FAMILIES,
      id: string,
      revision?: number,
    ): Promise<void> => {
      await watch(path, true);
      const raw = await readBoundedExecutionDocument(path);
      const reading = await parseCompletionRecord(raw, { kind, id });
      if (
        reading.kind !== "recorded" ||
        (revision !== undefined && reading.record.revision !== revision)
      ) {
        throw new Error(
          `Completion state is ${reading.kind}; preserve every recovery reference.`,
        );
      }
      const record = reading.record;
      const coordinate = `${kind}/${id}`;
      if (revision === undefined) {
        records.push(record);
        currentStamps.set(coordinate, reading.stamp);
      } else {
        const revisions = histories.get(coordinate) ??
          new Map<number, string>();
        revisions.set(revision, reading.stamp);
        histories.set(coordinate, revisions);
        historical.push(record);
      }
      // Older writers had no successful-capture edge. Their attempts retain all
      // recovery documents until an explicit compatible migration reconciles them.
      const implicit = JSON.parse(raw).version <
        ON_DISK_FORMATS.completionRecord.referenceHistorySince;
      if (implicit && record.kind === "attempt") {
        implicitAttempts.add(record.id);
      }
      if (record.kind === "environment") {
        const state = record.data.state;
        if (
          (implicit &&
            (state.kind === "executing" || state.kind === "recovery")) ||
          (state.kind === "executing" && state.capture === undefined)
        ) implicitAttempts.add(state.attempt_id);
        if (
          implicit && state.kind === "idle" &&
          state.returned_attempt_id !== undefined
        ) implicitAttempts.add(state.returned_attempt_id);
      }
    };
    for (
      const kind of Object.keys(
        COMPLETION_FAMILIES,
      ) as (keyof typeof COMPLETION_FAMILIES)[]
    ) {
      const path = join(recordDirectory, kind);
      const exists = await Deno.lstat(path).catch((error: unknown) => {
        if (error instanceof Deno.errors.NotFound) return undefined;
        throw error;
      });
      if (exists === undefined) continue;
      await watch(path);
      for await (const file of Deno.readDir(path)) {
        const filePath = join(path, file.name);
        if (file.isFile && !file.isSymlink && file.name.endsWith(".json")) {
          const id = RecordIdSchema.parse(file.name.slice(0, -5));
          await readRecord(filePath, kind, id);
          continue;
        }
        if (
          !file.isDirectory || file.isSymlink ||
          !RecordIdSchema.safeParse(file.name).success
        ) {
          throw new Error("Unknown completion record prevents reclamation.");
        }
        await watch(filePath);
        for await (const revision of Deno.readDir(filePath)) {
          if (
            !revision.isFile || revision.isSymlink ||
            !/^[1-9][0-9]*\.json$/u.test(revision.name)
          ) {
            throw new Error(
              "Unknown historical revision prevents reclamation.",
            );
          }
          await readRecord(
            join(filePath, revision.name),
            kind,
            file.name,
            Number(revision.name.slice(0, -5)),
          );
        }
      }
    }
    for await (const entry of Deno.readDir(recordDirectory)) {
      if (
        !entry.isDirectory || entry.isSymlink ||
        !Object.hasOwn(COMPLETION_FAMILIES, entry.name)
      ) {
        throw new Error("Unknown completion storage prevents reclamation.");
      }
    }
    for (const coordinate of histories.keys()) {
      if (!currentStamps.has(coordinate)) {
        throw new Error(
          "A historical record has no current authority; preserve all artifacts.",
        );
      }
    }
    for (const record of records) {
      const coordinate = `${record.kind}/${record.id}`;
      const revisions = histories.get(coordinate) ?? new Map<number, string>();
      if (
        record.revision > RECOVERY_INVENTORY_ENTRIES ||
        revisions.size < record.revision - 1 ||
        [...revisions.keys()].some((revision) => revision > record.revision) ||
        (revisions.has(record.revision) &&
          revisions.get(record.revision) !== currentStamps.get(coordinate))
      ) {
        throw new Error(
          "Completion history is incomplete or inconsistent; preserve all artifacts.",
        );
      }
      for (let revision = 1; revision < record.revision; revision++) {
        if (!revisions.has(revision)) {
          throw new Error(
            "Completion history is incomplete; preserve all artifacts.",
          );
        }
      }
    }
    const selected = new Set(attemptIds.map((id) => RecordIdSchema.parse(id)));
    for (const id of selected) {
      if (
        !records.some((record) =>
          record.kind === "attempt" && record.id === id &&
          record.data.state.kind === "finished"
        )
      ) {
        throw new Error(
          `Attempt ${id} has no finished record; preserve its recovery.`,
        );
      }
    }
    const pinned = new Set<string>(implicitAttempts);
    const rootReferences = [...records, ...historical].map(
      executionArtifactReferences,
    );
    const roots = rootReferences.flatMap((references) => references.artifacts);
    for (const record of records) {
      if (record.kind === "attempt" && record.data.state.kind !== "finished") {
        pinned.add(record.id);
      }
      if (record.kind === "environment") {
        const state = record.data.state;
        if (state.kind === "executing" || state.kind === "recovery") {
          pinned.add(state.attempt_id);
        }
        if (state.kind === "idle" && state.returned_attempt_id !== undefined) {
          pinned.add(state.returned_attempt_id);
        }
      }
    }
    // Unpublished payloads and global staging have no attempt coordinate.
    // An unfinished execution may still need those bytes for reconciliation.
    const unfinished = records.some((record) =>
      (record.kind === "attempt" && record.data.state.kind !== "finished") ||
      (record.kind === "environment" &&
        (record.data.state.kind === "executing" ||
          record.data.state.kind === "recovery"))
    );
    const nodes: RecoveryArtifactNode[] = [];
    const staging: string[] = [];
    const stages = async (directory: string): Promise<void> => {
      try {
        await watch(directory);
        for await (const file of Deno.readDir(directory)) {
          if (
            !file.isFile || file.isSymlink ||
            !(RecordIdSchema.safeParse(file.name).success ||
              isAtomicReplaceTempName(file.name))
          ) throw new Error("Unknown staging entry prevents reclamation.");
          const path = join(directory, file.name);
          await watch(path);
          if (!unfinished) staging.push(path);
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    };
    const eligible = new Set<string>();
    const walk = async (attempt: string, relative: string): Promise<void> => {
      const path = await artifactPaths(attempt, relative);
      await watch(path);
      for await (const entry of Deno.readDir(path)) {
        const child = `${relative}/${entry.name}`;
        if (entry.isDirectory && !entry.isSymlink) {
          await walk(attempt, child);
          continue;
        }
        if (!entry.isFile || entry.isSymlink) {
          throw new Error(
            "Unknown artifact filesystem entry prevents reclamation.",
          );
        }
        const file = await artifactPaths(attempt, child);
        const stat = await Deno.stat(file);
        await watch(file);
        const coordinate = `${attempt}/${child}`;
        let references: ArtifactReferences = { artifacts: [], payloads: [] };
        let digest: string | undefined;
        if (relative === "environment" || relative.startsWith("environment/")) {
          if (
            !entry.name.endsWith(".json") ||
            stat.size > EXECUTION_DOCUMENT_BYTES
          ) {
            throw new Error(
              "Unsupported or oversized recovery document prevents reclamation; preserve it for reconciliation.",
            );
          }
          charge(stat.size);
          const raw = await readBoundedExecutionDocument(file);
          const document: unknown = JSON.parse(raw);
          requireKnownExecutionArtifact(document);
          await verifySnapshotDigests(document);
          references = executionArtifactReferences(document);
          digest = await sha256Hex(raw);
        }
        nodes.push({
          coordinate,
          bytes: stat.size,
          ...references,
          ...(digest === undefined ? {} : { digest }),
        });
        if (
          selected.has(attempt) && !pinned.has(attempt) &&
          child.startsWith("environment/")
        ) eligible.add(coordinate);
        if (nodes.length > RECOVERY_INVENTORY_ENTRIES) {
          throw new Error(
            "Artifact graph observation limit reached; preserve all artifacts.",
          );
        }
      }
    };
    for await (const entry of Deno.readDir(artifactDirectory)) {
      if (entry.name === "recovery-payloads") continue;
      if (
        !entry.isDirectory || entry.isSymlink ||
        !RecordIdSchema.safeParse(entry.name).success
      ) throw new Error("Unknown artifact owner prevents reclamation.");
      const base = join(artifactDirectory, entry.name);
      await watch(base);
      for await (const directory of Deno.readDir(base)) {
        if (!directory.isDirectory || directory.isSymlink) {
          throw new Error(
            "Unknown attempt artifact layout prevents reclamation.",
          );
        }
        if (directory.name === "staging") {
          if (
            roots.some((coordinate) =>
              coordinate.startsWith(`${entry.name}/staging/`)
            )
          ) {
            throw new Error(
              "A published reference into private staging prevents reclamation.",
            );
          }
          await stages(join(base, directory.name));
          continue;
        }
        await walk(entry.name, directory.name);
      }
    }
    const recoveryDirectory = dirname(
      await recoveryStoragePath(root, "lifetime.lock"),
    );
    await watch(recoveryDirectory);
    for await (const entry of Deno.readDir(recoveryDirectory)) {
      const knownDirectory =
        (entry.name === "sha256" || entry.name === "staging") &&
        entry.isDirectory;
      const knownLock = entry.name === "lifetime.lock" && entry.isFile;
      if (entry.isSymlink || (!knownDirectory && !knownLock)) {
        throw new Error(
          "Unknown recovery storage entry prevents reclamation; preserve all artifacts.",
        );
      }
    }
    await stages(await recoveryStoragePath(root, "staging"));
    const byCoordinate = new Map(nodes.map((node) => [node.coordinate, node]));
    for (
      const receipt of [...rootReferences, ...nodes].flatMap((references) =>
        references.receipts ?? []
      )
    ) {
      if (!receipt.path.startsWith("environment/")) continue;
      const document = byCoordinate.get(
        `${receipt.attempt_id}/${receipt.path}`,
      );
      if (
        document === undefined || document.bytes !== receipt.bytes ||
        document.digest !== receipt.digest
      ) {
        throw new Error(
          "A recovery document failed its receipt check; no deletion is authorized.",
        );
      }
    }
    const graphPlan = planRecoveryReclamation(nodes, roots, eligible);
    const retained = new Set(graphPlan.retained);
    const livePayloads = new Set([
      ...[...records, ...historical].flatMap((record) =>
        executionArtifactReferences(record).payloads
      ),
      ...nodes.filter((node) => retained.has(node.coordinate))
        .flatMap((node) => node.payloads),
    ]);
    // A retained byte reference must resolve exactly. A wrong byte count may
    // never turn the same digest coordinate into an apparently orphaned file.
    for (const reference of livePayloads) {
      const path = await recoveryPayloadPath(root, reference);
      const stat = await Deno.lstat(path);
      if (
        !stat.isFile || stat.isSymlink ||
        stat.size !== Number(reference.split(":")[2])
      ) {
        throw new Error(
          "A retained recovery payload is unavailable; preserve every artifact.",
        );
      }
    }
    const payloads = new Set(unfinished ? [] : graphPlan.payloads);
    const payloadDirectory = await recoveryStoragePath(root, "sha256");
    try {
      await watch(payloadDirectory);
      for await (const file of Deno.readDir(payloadDirectory)) {
        if (
          !file.isFile || file.isSymlink || !/^[0-9a-f]{64}$/u.test(file.name)
        ) throw new Error("Unknown recovery payload prevents reclamation.");
        const path = join(payloadDirectory, file.name);
        const reference = `sha256:${file.name}:${(await Deno.stat(path)).size}`;
        if (!unfinished && !livePayloads.has(reference)) {
          payloads.add(reference);
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    const eligiblePayloads = [...payloads].filter((reference) =>
      !livePayloads.has(reference)
    ).sort();
    const selectedPlan = {
      ...graphPlan,
      payloads: eligiblePayloads.slice(0, 128 - graphPlan.manifests.length),
      staging: [] as string[],
    };
    selectedPlan.staging.push(
      ...staging.sort().slice(
        0,
        128 - selectedPlan.manifests.length - selectedPlan.payloads.length,
      ),
    );
    const deferred = new Set(graphPlan.deferred);
    if (unfinished) deferred.add("unfinished-execution");
    if (
      selectedPlan.payloads.length < eligiblePayloads.length ||
      selectedPlan.staging.length < staging.length
    ) {
      deferred.add("batch-limit");
    }
    const plan = {
      ...selectedPlan,
      ...(deferred.size === 0 ? {} : { deferred: [...deferred] }),
    };
    const unchanged = async (): Promise<boolean> => {
      for (const [index, path] of watched.entries()) {
        if (await fingerprint(path) !== original[index]) return false;
      }
      return true;
    };
    if (!await unchanged()) {
      throw new Error(
        "The artifact reference graph changed during observation; no deletion ran.",
      );
    }
    return { plan, artifactDirectory };
  });
  const { plan, artifactDirectory } = prepared;
  if (await readCompletionPublication(publicationPath) !== publication) {
    throw new Error(
      "The artifact reference graph changed during observation; no deletion ran.",
    );
  }
  if (
    dryRun ||
    plan.manifests.length + plan.payloads.length + plan.staging.length === 0
  ) return plan;
  if (publication === null) {
    throw new Error(
      "Storage has no publication witness; preserve all artifacts until compatible reconciliation.",
    );
  }
  return await withRecoveryStorage(root, async () => {
    // The exclusive storage lease keeps payload writers out. The common boundary
    // only checks revisions and unlinks a bounded batch, never hashes payloads.
    await withCompletionPublication(root, async (resolvedCommon) => {
      const common = resolvedCommon ?? await resolveCommonGitDir(root);
      if (
        common === undefined ||
        join(common, GIT_ADMIN_STATE.completionArtifacts.path) !==
          artifactDirectory
      ) {
        throw new Error(
          "Artifact storage moved before reclamation; preserve all artifacts.",
        );
      }
      const publishedPaths = await openArtifactPaths(root, common);
      if (
        await completionPublicationPath(root, common) !== publicationPath ||
        await readCompletionPublication(publicationPath) !== publication
      ) {
        throw new Error(
          "The artifact reference graph changed before reclamation; no deletion ran.",
        );
      }
      await invalidateCompletionPublication(publicationPath);
      for (const path of plan.staging) await removeIfExists(path);
      for (const coordinate of plan.manifests) {
        const slash = coordinate.indexOf("/");
        await Deno.remove(
          await publishedPaths(
            coordinate.slice(0, slash),
            coordinate.slice(slash + 1),
          ),
        );
      }
      for (const reference of plan.payloads) {
        const path = await recoveryPayloadPath(root, reference);
        try {
          await Deno.remove(path);
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
      }
    });
    return plan;
  }, true);
}
