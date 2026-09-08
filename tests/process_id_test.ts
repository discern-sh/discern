import { assertEquals } from "@std/assert";
import { withTempDir } from "./temp_dir.ts";
import { readPidIfReady, readPidsIfReady } from "./process_id.ts";

Deno.test("PID readiness requires written process identity before cancellation", async () => {
  await withTempDir(async (dir) => {
    const leader = `${dir}/leader`;
    const child = `${dir}/child`;
    assertEquals(await readPidIfReady(leader), undefined);
    for (
      const text of [
        "",
        " ",
        "0",
        "-1",
        "1.5",
        "0x2",
        "1e3",
        "NaN",
        "Infinity",
        "9007199254740992",
        "42suffix",
      ]
    ) {
      await Deno.writeTextFile(leader, text);
      assertEquals(
        await readPidIfReady(leader),
        undefined,
        JSON.stringify(text),
      );
    }
    await Deno.writeTextFile(leader, `${Deno.pid}\n`);
    await Deno.writeTextFile(child, "");
    assertEquals(await readPidsIfReady([leader, child]), undefined);
    await Deno.writeTextFile(child, "123\r\n");
    assertEquals(await readPidsIfReady([leader, child]), [Deno.pid, 123]);
  });
});
