/**
 * Checkout filesystem diagnostic for `discern doctor`.
 *
 * Git and discern make thousands of small file operations per command. On a
 * filesystem reached through a remote file protocol every one of them is a
 * round trip to another machine or host, so each command runs many times
 * slower than on a local disk. Linux names the filesystem type of every mount
 * in its mount table; this probe reads that table and warns when the checkout
 * sits on such a mount. It reports nothing on a local filesystem or on a host
 * without a mount table.
 */

import {
  readTextIfExists,
  realPathIfExists,
} from "../../shared/fs_presence.ts";
import type { DoctorDraftCheck } from "./completion_checks.ts";

/**
 * Filesystem types whose every operation crosses a remote file protocol, with
 * the words that tell the reader what such a mount usually is.
 */
const REMOTE_PROTOCOL_FILESYSTEMS: Readonly<Record<string, string>> = {
  "9p":
    "a folder shared from the host into this Linux environment, such as a Windows drive under WSL 2",
};

/** One mounted filesystem from the Linux mount table. */
export interface MountedFilesystem {
  readonly mountPoint: string;
  readonly type: string;
}

/** Injectable host facts, so the probe is testable on any platform. */
export interface CheckoutFilesystemHost {
  readonly os: typeof Deno.build.os;
  readonly readMountTable: () => Promise<string | undefined>;
  readonly realPath: (path: string) => Promise<string | undefined>;
}

const SYSTEM_HOST: CheckoutFilesystemHost = {
  os: Deno.build.os,
  readMountTable: () => readTextIfExists("/proc/self/mountinfo"),
  realPath: realPathIfExists,
};

/** Decode the octal escapes the mount table uses for spaces and other separators. */
function decodeMountField(field: string): string {
  return field.replace(
    /\\([0-7]{3})/g,
    (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

/**
 * Parse `/proc/self/mountinfo`. Each line names the mount point in its fifth
 * field and the filesystem type in the first field after the ` - ` separator.
 * Lines that do not have that shape are skipped.
 */
export function parseMountTable(table: string): MountedFilesystem[] {
  const mounts: MountedFilesystem[] = [];
  for (const line of table.split("\n")) {
    const separator = line.indexOf(" - ");
    if (separator < 0) continue;
    const mountPoint = line.slice(0, separator).split(" ")[4];
    const type = line.slice(separator + 3).split(" ")[0];
    if (
      mountPoint === undefined || mountPoint === "" || type === undefined ||
      type === ""
    ) {
      continue;
    }
    mounts.push({ mountPoint: decodeMountField(mountPoint), type });
  }
  return mounts;
}

/** True when `path` is the mount point or lies beneath it. */
function mountContains(mountPoint: string, path: string): boolean {
  if (mountPoint === "/") return path.startsWith("/");
  return path === mountPoint || path.startsWith(`${mountPoint}/`);
}

/**
 * The mount that serves `path`: the longest containing mount point, and the
 * latest entry when several share it, because a later mount shadows an earlier
 * one at the same place.
 */
export function mountServing(
  mounts: readonly MountedFilesystem[],
  path: string,
): MountedFilesystem | undefined {
  let serving: MountedFilesystem | undefined;
  for (const mount of mounts) {
    if (!mountContains(mount.mountPoint, path)) continue;
    if (
      serving === undefined ||
      mount.mountPoint.length >= serving.mountPoint.length
    ) {
      serving = mount;
    }
  }
  return serving;
}

/**
 * Warn when the checkout at `root` sits on a remote-protocol filesystem.
 * Returns no check otherwise, so the report stays the same on every host that
 * has nothing to say.
 */
export async function inspectCheckoutFilesystem(
  root: string,
  host: CheckoutFilesystemHost = SYSTEM_HOST,
): Promise<DoctorDraftCheck | undefined> {
  if (host.os !== "linux") return undefined;
  const table = await host.readMountTable();
  if (table === undefined) return undefined;
  const path = await host.realPath(root);
  if (path === undefined) return undefined;
  const mount = mountServing(parseMountTable(table), path);
  if (mount === undefined) return undefined;
  const meaning = REMOTE_PROTOCOL_FILESYSTEMS[mount.type];
  if (meaning === undefined) return undefined;
  return {
    name: "checkout filesystem",
    ok: true,
    status: "warn",
    detail:
      `this checkout is on a ${mount.type} mount at ${mount.mountPoint}: ${meaning}. Every file operation crosses to the host, so Git and discern run many times slower here than on a local disk`,
    fix:
      "move the project onto the Linux filesystem, for example under your home directory, and work on it there",
  };
}
