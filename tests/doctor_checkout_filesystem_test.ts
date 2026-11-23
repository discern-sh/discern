/**
 * The checkout filesystem probe: the mount table decides, and the warning
 * never turns a healthy install red.
 *
 * The mount-table samples carry several filesystem types and nested mount
 * points so the rule under test is "the mount that serves this path", not one
 * remembered directory.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  type CheckoutFilesystemHost,
  inspectCheckoutFilesystem,
  mountServing,
  parseMountTable,
} from "../src/engine/doctor/checkout_filesystem.ts";

const MOUNT_TABLE = [
  "25 1 8:32 / / rw,relatime - ext4 /dev/sdc rw,discard,errors=remount-ro",
  "40 25 0:21 / /proc rw,nosuid,nodev,noexec - proc proc rw",
  "65 25 0:50 / /mnt/d rw,noatime - 9p drvfs rw,dirsync,aname=drvfs;path=D:\;uid=1000;gid=1000,mmap,access=client,trans=fd",
  "66 25 0:51 / /mnt/shared\\040folder rw,noatime - 9p share rw,trans=virtio",
  "70 65 8:48 / /mnt/d/local-disk rw,relatime - ext4 /dev/sdd rw",
  "a line without the separator",
  "",
].join("\n");

/** A Linux host that serves the sample mount table and resolves paths as given. */
function linuxHost(
  overrides: Partial<CheckoutFilesystemHost> = {},
): CheckoutFilesystemHost {
  return {
    os: "linux",
    readMountTable: () => Promise.resolve(MOUNT_TABLE),
    realPath: (path) => Promise.resolve(path),
    ...overrides,
  };
}

Deno.test("the mount table parser reads mount points, escapes, and types", () => {
  assertEquals(parseMountTable(MOUNT_TABLE), [
    { mountPoint: "/", type: "ext4" },
    { mountPoint: "/proc", type: "proc" },
    { mountPoint: "/mnt/d", type: "9p" },
    { mountPoint: "/mnt/shared folder", type: "9p" },
    { mountPoint: "/mnt/d/local-disk", type: "ext4" },
  ]);
});

Deno.test("the serving mount is the longest containing mount point on a path boundary", () => {
  const mounts = parseMountTable(MOUNT_TABLE);
  assertEquals(mountServing(mounts, "/home/dev/app")?.mountPoint, "/");
  assertEquals(mountServing(mounts, "/mnt/d/work/app")?.mountPoint, "/mnt/d");
  assertEquals(mountServing(mounts, "/mnt/d")?.mountPoint, "/mnt/d");
  // A sibling whose name merely begins with the mount point's name.
  assertEquals(mountServing(mounts, "/mnt/data/app")?.mountPoint, "/");
  assertEquals(
    mountServing(mounts, "/mnt/d/local-disk/app")?.mountPoint,
    "/mnt/d/local-disk",
  );
});

Deno.test("a later mount shadows an earlier one at the same mount point", () => {
  const mounts = parseMountTable([
    "30 1 0:40 / /work rw - 9p share rw",
    "31 1 8:1 / /work rw - ext4 /dev/sda rw",
  ].join("\n"));
  assertEquals(mountServing(mounts, "/work/app")?.type, "ext4");
});

Deno.test("a checkout on a remote-protocol mount warns without failing", async () => {
  for (
    const [root, mountPoint] of [
      ["/mnt/d/work/app", "/mnt/d"],
      ["/mnt/shared folder/app", "/mnt/shared folder"],
    ] as const
  ) {
    const check = await inspectCheckoutFilesystem(root, linuxHost());
    assertEquals(check?.name, "checkout filesystem");
    assertEquals(check?.status, "warn");
    assertEquals(check?.ok, true);
    assertStringIncludes(check?.detail ?? "", `9p mount at ${mountPoint}`);
    assertStringIncludes(check?.fix ?? "", "Linux filesystem");
  }
});

Deno.test("the probe follows the checkout's real path", async () => {
  const check = await inspectCheckoutFilesystem(
    "/home/dev/app",
    linuxHost({ realPath: () => Promise.resolve("/mnt/d/work/app") }),
  );
  assertEquals(check?.status, "warn");
});

Deno.test("a checkout on a local filesystem reports nothing", async () => {
  for (const root of ["/home/dev/app", "/mnt/d/local-disk/app"]) {
    assertEquals(await inspectCheckoutFilesystem(root, linuxHost()), undefined);
  }
});

Deno.test("hosts without a mount table report nothing", async () => {
  const unread = (): Promise<string | undefined> => {
    throw new Error("the mount table must not be read on this host");
  };
  for (const os of ["darwin", "windows"] as const) {
    assertEquals(
      await inspectCheckoutFilesystem(
        "/mnt/d/work/app",
        linuxHost({ os, readMountTable: unread }),
      ),
      undefined,
    );
  }
  assertEquals(
    await inspectCheckoutFilesystem(
      "/mnt/d/work/app",
      linuxHost({ readMountTable: () => Promise.resolve(undefined) }),
    ),
    undefined,
  );
  assertEquals(
    await inspectCheckoutFilesystem(
      "/mnt/d/work/app",
      linuxHost({ realPath: () => Promise.resolve(undefined) }),
    ),
    undefined,
  );
});
