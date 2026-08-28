/**
 * Canonical schemas and validation for human task metadata.
 *
 * The stored record contains only mutable human wording and immutable creation
 * source. Git plus the worktree identity resolver continue to own the stable id
 * and branch; {@link TaskMetadataDataSchema} joins those authorities for results.
 */

import { z } from "@zod/zod";

/** Current on-disk task metadata record format. */
export const TASK_METADATA_SCHEMA_VERSION = 1 as const;

/** Bounded single-line title length, counted as Unicode code points. */
export const TASK_TITLE_MAX_CODE_POINTS = 120;

/** Bounded single-line brief length, counted as Unicode code points. */
export const TASK_BRIEF_MAX_CODE_POINTS = 500;

/** Why a projected title came from stored wording or an identity fallback. */
export const TASK_TITLE_SOURCES = [
  "recorded",
  "identity-fallback",
  "unavailable-fallback",
] as const;
export type TaskTitleSource = (typeof TASK_TITLE_SOURCES)[number];

/** Control and line-separator characters that cannot enter terminal text. */
const UNSAFE_SINGLE_LINE_TEXT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

/** Count Unicode code points without splitting surrogate pairs. */
export function taskTextLength(value: string): number {
  return [...value].length;
}

/** Return the product-facing validation error for one task text value. */
export function taskTextValidationError(
  value: string,
  kind: "title" | "brief",
): string | undefined {
  const label = kind === "title" ? "Task title" : "Task brief";
  const maximum = kind === "title"
    ? TASK_TITLE_MAX_CODE_POINTS
    : TASK_BRIEF_MAX_CODE_POINTS;
  if (value.trim() === "") {
    return `${label} is required.`;
  }
  if (UNSAFE_SINGLE_LINE_TEXT.test(value)) {
    return `${label} must stay on one line and cannot contain control characters.`;
  }
  const length = taskTextLength(value);
  if (length > maximum) {
    return `${label} has ${length} characters. Use ${maximum} or fewer.`;
  }
  return undefined;
}

/** Validate accepted task wording without normalizing its bytes. */
export function validateTaskText(
  value: string,
  kind: "title" | "brief",
): string {
  const error = taskTextValidationError(value, kind);
  if (error !== undefined) {
    throw new TypeError(error);
  }
  return value;
}

/** Immutable creation source recorded when a worktree is created. */
export const TaskCreationSourceSchema = z.strictObject({
  ref: z.string().min(1),
  commit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
});
export type TaskCreationSource = z.infer<typeof TaskCreationSourceSchema>;

const taskTitleSchema = z.string().superRefine((value, context) => {
  const message = taskTextValidationError(value, "title");
  if (message !== undefined) {
    context.addIssue({ code: "custom", message });
  }
});

const taskBriefSchema = z.string().superRefine((value, context) => {
  const message = taskTextValidationError(value, "brief");
  if (message !== undefined) {
    context.addIssue({ code: "custom", message });
  }
});

/** The versioned worktree-admin record. Stable identity is not duplicated. */
export const StoredTaskMetadataSchema = z.strictObject({
  schema_version: z.literal(TASK_METADATA_SCHEMA_VERSION),
  title: taskTitleSchema,
  brief: taskBriefSchema.optional(),
  created_from: TaskCreationSourceSchema.optional(),
});
export type StoredTaskMetadata = z.infer<typeof StoredTaskMetadataSchema>;

/**
 * Public task projection shared by start, status, rename, and the Desk.
 * `unavailable_reason` accompanies only an unreadable-record fallback.
 */
export const TaskMetadataDataSchema = z.strictObject({
  id: z.string(),
  branch: z.string(),
  title: taskTitleSchema,
  title_source: z.enum(TASK_TITLE_SOURCES),
  brief: taskBriefSchema.optional(),
  created_from: TaskCreationSourceSchema.optional(),
  unavailable_reason: z.string().optional(),
});
export type TaskMetadataData = z.infer<typeof TaskMetadataDataSchema>;

/** Join stored task wording to the separately authoritative stable identity. */
export function recordedTaskMetadataData(
  identity: { id: string; branch: string },
  metadata: StoredTaskMetadata,
): TaskMetadataData {
  return {
    ...identity,
    title: metadata.title,
    title_source: "recorded",
    ...(metadata.brief === undefined ? {} : { brief: metadata.brief }),
    ...(metadata.created_from === undefined
      ? {}
      : { created_from: metadata.created_from }),
  };
}

/** Build the supported legacy or unreadable-record title projection. */
export function fallbackTaskMetadataData(
  identity: { id: string; branch: string },
  title: string,
  unavailableReason?: string,
): TaskMetadataData {
  return {
    ...identity,
    title,
    title_source: unavailableReason === undefined
      ? "identity-fallback"
      : "unavailable-fallback",
    ...(unavailableReason === undefined
      ? {}
      : { unavailable_reason: unavailableReason }),
  };
}
