/** Recovery artifact shape, independent of the adapter's process machinery. */
import { z } from "@zod/zod";
import { NameSchema } from "../completion/identity.ts";
import type { IdentitySettings } from "../worktree/identity.ts";
import { GitSnapshotSchema } from "./snapshot_schema.ts";

export const ExecutionIdentitySettingsSchema = z.strictObject({
  slug: z.string().min(1),
  branchPrefix: z.string(),
  trunk: z.string().optional(),
  envFiles: z.array(z.string()).optional(),
}).transform((settings): IdentitySettings => ({
  slug: settings.slug,
  branchPrefix: settings.branchPrefix,
  ...(settings.trunk === undefined ? {} : { trunk: settings.trunk }),
  ...(settings.envFiles === undefined ? {} : { envFiles: settings.envFiles }),
}));

export const WorkspaceStateSchema = z.strictObject({
  format: z.literal("execution-workspace-state-v1"),
  git: GitSnapshotSchema.nullable(),
  settings: ExecutionIdentitySettingsSchema,
  worktree_id: NameSchema,
  seed: z.number().int(),
  resources: z.record(NameSchema, z.string().min(1)),
  ledger: z.array(z.strictObject({ path: z.string(), raw: z.string() })),
  lifecycle: z.strictObject({
    commands: z.strictObject({
      prepare: z.array(z.string()),
      restore: z.array(z.string()),
      reset: z.array(z.string()),
      dispose: z.array(z.string()),
    }),
    env: z.record(z.string(), z.string()),
    timeout: z.number().finite().positive(),
  }),
});
export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;
