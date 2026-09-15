/** Clone-local evidence of adoption and release handoff; never evidence of a fetch. */
import { dirname } from "@std/path";
import { z } from "@zod/zod";
import { atomicReplaceJson } from "./atomic_write.ts";
import { gitAdminStatePath } from "./git_admin_state.ts";
import { ON_DISK_FORMATS } from "./on_disk_formats.ts";
import { inspectOnDiskJsonFile, type OnDiskJsonRead } from "./on_disk_json.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "./clock.ts";
import { parseVersion, tryParseVersion } from "./semver.ts";

export const RELEASE_REMINDER_DAYS = 14;
export const RELEASE_REMINDER =
  `It has been at least ${RELEASE_REMINDER_DAYS} calendar days since this clone's adoption or last release handoff. You can check the release notes.`;
const timestamp = z.iso.datetime();
export const ReleaseCheckSchema = z.strictObject({
  schema_version: z.literal(ON_DISK_FORMATS.releaseCheck.version),
  first_seen_at: timestamp,
  last_handoff_at: timestamp.optional(),
  version_when_handed_off: z.string().refine((value) =>
    tryParseVersion(value) !== undefined
  ).optional(),
}).refine((value) =>
  (value.last_handoff_at === undefined) ===
    (value.version_when_handed_off === undefined)
);
export type ReleaseCheck = z.infer<typeof ReleaseCheckSchema>;
export type ReleaseCheckRead = OnDiskJsonRead<ReleaseCheck>;
export type ReleaseCheckWrite = {
  readonly status: "saved" | "unchanged" | "unavailable" | "newer" | "skipped";
  readonly reason?: string;
};

/** Count UTC date boundaries, including midnight on the fourteenth day. */
export function releaseReminderDue(
  read: ReleaseCheckRead,
  now: number,
): boolean {
  if (read.status !== "recorded" || !Number.isFinite(now)) return false;
  const parsed = ReleaseCheckSchema.safeParse(read.value);
  if (!parsed.success) return false;
  const first = Date.parse(parsed.data.first_seen_at);
  const reference = Date.parse(
    parsed.data.last_handoff_at ?? parsed.data.first_seen_at,
  );
  if (first > now || reference > now || reference < first) return false;
  const utcDay = (instant: number): number => Math.floor(instant / 86_400_000);
  return utcDay(now) - utcDay(reference) >= RELEASE_REMINDER_DAYS;
}

/** Read the registered record while preserving forward-schema evidence. */
export async function inspectReleaseCheck(
  root: string,
): Promise<ReleaseCheckRead> {
  try {
    return await inspectOnDiskJsonFile(
      "releaseCheck",
      await gitAdminStatePath(root, "releaseCheck"),
      (raw) => {
        const parsed = ReleaseCheckSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
      },
    );
  } catch (error) {
    return { status: "unavailable", reason: String(error) };
  }
}

/** Seed only an absent clock, or record an applied handoff, with best-effort persistence. */
export async function writeReleaseCheck(
  root: string,
  handoffVersion?: string,
  now: number = SYSTEM_CLOCK.wallNow(),
): Promise<ReleaseCheckWrite> {
  try {
    if (handoffVersion !== undefined) parseVersion(handoffVersion);
    const path = await gitAdminStatePath(root, "releaseCheck");
    if (path === undefined) {
      return {
        status: "unavailable",
        reason: "No repository state directory.",
      };
    }
    const read = await inspectReleaseCheck(root);
    if (read.status === "newer" || read.status === "unavailable") return read;
    if (read.status === "recorded" && handoffVersion === undefined) {
      return { status: "unchanged" };
    }
    const at = wallTimeIso(now);
    const record: ReleaseCheck = {
      schema_version: ON_DISK_FORMATS.releaseCheck.version,
      first_seen_at: read.status === "recorded" ? read.value.first_seen_at : at,
      ...(handoffVersion === undefined
        ? {}
        : { last_handoff_at: at, version_when_handed_off: handoffVersion }),
    };
    await Deno.mkdir(dirname(path), { recursive: true });
    await atomicReplaceJson(path, record, {
      mode: 0o600,
      sync: false,
      space: 2,
      trailingNewline: true,
    });
    return { status: "saved" };
  } catch (error) {
    return { status: "unavailable", reason: String(error) };
  }
}
