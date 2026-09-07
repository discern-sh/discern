/** Cold evaluation and later callbacks must not inherit invocation capabilities. */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./temp_dir.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

Deno.test("module loading isolates cold, concurrent, warm and rejected imports across callbacks", async () => {
  await withTempDir(async (dir) => {
    const entry = join(dir, "module_test.ts");
    await Deno.writeTextFile(
      entry,
      `import ${
        JSON.stringify(
          new URL("./fixtures/module_loading/driver.ts", import.meta.url).href,
        )
      };\n`,
    );
    const child = await new Deno.Command(Deno.execPath(), {
      args: [
        "test",
        "--no-check",
        "--allow-all",
        "--config",
        join(REPO_ROOT, "deno.json"),
        entry,
      ],
      cwd: REPO_ROOT,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(
      child.code,
      0,
      new TextDecoder().decode(child.stdout) +
        new TextDecoder().decode(child.stderr),
    );
  });
});
