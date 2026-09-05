/** Read-only projection of canonical environment records for detached identity. */
import { join } from "@std/path";
import { z } from "@zod/zod";
import { EnvironmentSchema } from "../completion/environment.ts";
import { RecordIdSchema } from "../completion/identity.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { inspectOnDiskJsonVersion } from "../../shared/on_disk_formats.ts";

// This conservative projection supplies presence and identity, never write authority.
// Claims still read the full canonical envelope through the completion store.
const EnvironmentProjectionSchema = z.object({
  kind: z.literal("environment"),
  id: RecordIdSchema,
  data: EnvironmentSchema,
});

/** Use the frozen family layout and schema without importing the store's writer. */
export async function enrolledEnvironments(
  root: string,
): Promise<z.infer<typeof EnvironmentProjectionSchema>[]> {
  const directory = await gitAdminStatePath(root, "completionRecords");
  if (directory === undefined) {
    throw new Error("Common environment storage is unavailable.");
  }
  const records: z.infer<typeof EnvironmentProjectionSchema>[] = [];
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(join(directory, "environment"))) {
      entries.push(entry);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return records;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.name.endsWith(".json")) continue;
    if (!entry.isFile || entry.isSymlink) {
      throw new Error(
        `Environment record is not a regular file: ${entry.name}. Preserve it for reconciliation.`,
      );
    }
    const raw = await Deno.readTextFile(
      join(directory, "environment", entry.name),
    );
    if (
      inspectOnDiskJsonVersion("completionRecord", raw).status !== "current"
    ) {
      throw new Error(
        `Environment ${entry.name} has no supported current version; preserve its record for reconciliation.`,
      );
    }
    const record = EnvironmentProjectionSchema.parse(JSON.parse(raw));
    if (entry.name !== `${record.id}.json`) {
      throw new Error(
        "Environment record disagrees with its canonical coordinate. Preserve it for reconciliation.",
      );
    }
    records.push(record);
  }
  return records;
}
