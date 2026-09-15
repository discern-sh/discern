/** Capture the production upgrade entrypoint for synthetic migration journeys. */
import { runUpgrade, type UpgradeOptions } from "../../src/commands/upgrade.ts";
import { SCHEMA_VERSION } from "../../src/lib/version.ts";

type CaptureOptions = Partial<Pick<UpgradeOptions, "registry" | "json" | "check" | "dryRun">>;

/** Keep apply, check, preview, and human output on one process-capture boundary. */
export async function captureUpgrade(
  dir: string,
  options: CaptureOptions = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const originalLog = console.log;
  const originalError = console.error;
  let stdout = "";
  let stderr = "";
  console.log = (...args: unknown[]) => {
    stdout += args.map(String).join(" ") + "\n";
  };
  console.error = (...args: unknown[]) => {
    stderr += args.map(String).join(" ") + "\n";
  };
  try {
    const code = await runUpgrade({
      json: true,
      noColor: true,
      dryRun: false,
      check: false,
      allowDirty: true,
      currentSchema: options.registry === undefined ? undefined : SCHEMA_VERSION + 1,
      cwd: dir,
      ...options,
    });
    return { code, stdout, stderr };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}
