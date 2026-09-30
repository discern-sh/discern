/**
 * Every source launcher takes one explicit Deno config and hands it to each
 * process it starts, and every one refuses a config that would load a
 * different design-system build from the process launching it.
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { fromFileUrl, join, resolve } from "@std/path";
import { parseDeskCaptureArgs } from "../scripts/desk_capture.ts";
import { localDesignSystemConfig } from "../scripts/local_design_system.ts";
import { parseOptions } from "../scripts/terminal_capture.ts";
import { engineRunArgs, repoSourceRunArgs } from "./engine_helpers.ts";
import { deskTtyLaunchArgs } from "./fixtures/desk_tty_harness.ts";
import {
  compileDiscernCaptureBinary,
  terminalCaptureCompileArguments,
} from "./fixtures/terminal_command_capture.ts";
import { withTempDir } from "./helpers.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { z } from "@zod/zod";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

/** Every value that follows a `--config` flag in one argv. */
function configsIn(args: readonly string[]): string[] {
  return args.flatMap((argument, index) =>
    argument === "--config" ? [args[index + 1] ?? ""] : []
  );
}

/** Write an unlinked copy and a linked overlay of the committed config. */
async function withConfigs(
  run: (configs: { readonly copy: string; readonly linked: string }) => Promise<
    void
  >,
): Promise<void> {
  await withTempDir(async (directory) => {
    const base = decodeWith(
      z.record(z.string(), z.unknown()),
      await Deno.readTextFile(join(ROOT, "deno.json")),
    );
    const copy = join(directory, "copy.json");
    const linked = join(directory, "linked.json");
    await Deno.writeTextFile(copy, JSON.stringify(base));
    await Deno.writeTextFile(
      linked,
      JSON.stringify(localDesignSystemConfig(base, join(directory, "kit"))),
    );
    await run({ copy, linked });
  });
}

Deno.test("source launches default to the committed config and accept an explicit one", async () => {
  assertEquals(configsIn(engineRunArgs(["status"])), [
    join(ROOT, "deno.json"),
  ]);
  await withConfigs(({ copy }) => {
    assertEquals(configsIn(engineRunArgs(["status"], { config: copy })), [
      copy,
    ]);
    assertEquals(
      configsIn(repoSourceRunArgs("/harness.ts", [], { config: copy })),
      [copy],
    );
    return Promise.resolve();
  });
});

Deno.test("the Desk sentinel and the Desk it launches share one config", async () => {
  const base = {
    colorMode: "color" as const,
    theme: "dark" as const,
    resultPath: "/run/terminal.json",
    resizeDir: "/run/resizes",
  };
  assertEquals(configsIn(deskTtyLaunchArgs(base)), [
    join(ROOT, "deno.json"),
    join(ROOT, "deno.json"),
  ]);
  await withConfigs(({ copy }) => {
    assertEquals(configsIn(deskTtyLaunchArgs({ ...base, config: copy })), [
      copy,
      copy,
    ]);
    return Promise.resolve();
  });
});

Deno.test("capture compilation names the selected config", () => {
  assertEquals(
    configsIn(terminalCaptureCompileArguments("/project", "/tmp/out")),
    ["/project/deno.json"],
  );
  assertEquals(
    configsIn(
      terminalCaptureCompileArguments("/project", "/tmp/out", "/link.json"),
    ),
    ["/link.json"],
  );
});

Deno.test("a pinned process refuses to launch or compile against a linked config", async () => {
  await withConfigs(async ({ linked }) => {
    for (
      const launch of [
        () => engineRunArgs(["desk"], { config: linked }),
        () => repoSourceRunArgs("/harness.ts", [], { config: linked }),
        () =>
          deskTtyLaunchArgs({
            colorMode: "no-color-env",
            theme: "dark",
            resultPath: "/run/terminal.json",
            resizeDir: "/run/resizes",
            config: linked,
          }),
      ]
    ) {
      assertThrows(launch, Error, "uses the published design system");
    }
    await assertRejects(
      () => compileDiscernCaptureBinary(ROOT, "/tmp/never-built", linked),
      Error,
      "uses the published design system",
    );
  });
});

Deno.test("capture scripts accept an explicit config", () => {
  assertEquals(parseDeskCaptureArgs([]), {
    directory: resolve(".scratch/desk-review"),
  });
  assertEquals(
    parseDeskCaptureArgs(["gallery", "--config", "link/deno.json"]),
    { directory: resolve("gallery"), config: resolve("link/deno.json") },
  );
  assertEquals(
    parseDeskCaptureArgs(["--config", "/link.json", "/out"]),
    { directory: "/out", config: "/link.json" },
  );
  assertThrows(() => parseDeskCaptureArgs(["--config"]), TypeError, "--config");
  assertThrows(() => parseDeskCaptureArgs(["a", "b"]), TypeError, "at most");
  assertThrows(() => parseDeskCaptureArgs(["--theme"]), TypeError, "unknown");

  assertEquals(
    parseOptions(["status", "--config", "/link.json"]).config,
    "/link.json",
  );
  assertEquals(parseOptions(["status"]).config, undefined);
});
