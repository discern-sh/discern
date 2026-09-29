/** The planning filesystem preserves net bytes, modes, and read failures. */
import { assertEquals, assertRejects } from "@std/assert";
import { PlanningRefreshFileOps } from "../src/lib/refresh_file_ops.ts";

Deno.test("refresh overlay records final operations without changing its snapshot", async () => {
  const reads: string[] = [];
  const overlay = new PlanningRefreshFileOps("/project", {
    readTextFile: (path) => {
      reads.push(path);
      if (path.endsWith("missing")) {
        return Promise.reject(new Deno.errors.NotFound());
      }
      if (path.endsWith("denied")) {
        return Promise.reject(new Deno.errors.PermissionDenied("denied"));
      }
      return Promise.resolve("original");
    },
    mode: () => Promise.resolve(0o644),
  });
  await assertRejects(
    () => overlay.readTextFile("/project/missing"),
    Deno.errors.NotFound,
  );
  await assertRejects(
    () => overlay.chmod("/project/missing", 0o755),
    Deno.errors.NotFound,
  );
  assertEquals(overlay.operations(), []);
  await assertRejects(
    () => overlay.readTextFile("/project/denied"),
    Deno.errors.PermissionDenied,
  );
  await overlay.writeTextFile("/project/missing", "created");
  await overlay.chmod("/project/missing", 0o755);
  await overlay.chmod("/project/existing", 0o755);
  await overlay.writeTextFile("/project/unchanged", "temporary");
  await overlay.writeTextFile("/project/unchanged", "original");
  await overlay.ensureDir("/project");
  assertEquals(await overlay.readTextFile("/project/missing"), "created");
  assertEquals(reads.filter((path) => path.endsWith("missing")).length, 1);
  assertEquals(overlay.operations(), [
    {
      path: "existing",
      targetAbs: "/project/existing",
      disposition: "update",
      text: "original",
      mode: 0o755,
      bytesChanged: false,
      modeChanged: true,
    },
    {
      path: "missing",
      targetAbs: "/project/missing",
      disposition: "create",
      text: "created",
      mode: 0o755,
      bytesChanged: true,
      modeChanged: false,
    },
  ]);
  assertEquals(
    overlay.changes(),
    overlay.operations().map(({ path, bytesChanged, modeChanged }) => ({
      path,
      bytesChanged,
      modeChanged,
    })),
  );
});
