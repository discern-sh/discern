/** Complete stdout capture for producer protocols through the supervised job runner. */
import { quoteCommandWord } from "../../shared/command_evidence.ts";
import { toCommand } from "../../shared/config_schema.ts";
import { tempArtifactScopeFor } from "../temp_artifact_scope.ts";
import { spawnJob } from "./command.ts";
import { JobOutputRecorder } from "./output_record.ts";
import type { JobResult } from "./types.ts";
import { presentJobResult, type RunOptions } from "./runner.ts";

import {
  BOUNDED_CAPTURE_BYTES as PRODUCER_CAPTURE_BYTES,
  readBoundedFile as readCompleteCapture,
} from "../../shared/bounded_file.ts";
export { PRODUCER_CAPTURE_BYTES, readCompleteCapture };

/** Exact stdout supplies extraction; the ordinary job diagnostic retains both streams. */
export async function runCapturedCommands(input: {
  readonly root: string;
  readonly label: string;
  readonly commands: readonly string[];
  readonly timeout: number;
  readonly signal: AbortSignal;
  readonly environment: Readonly<Record<string, string>>;
  readonly stdin?: Uint8Array;
  readonly presentation?: RunOptions;
  readonly timeoutKey?: string;
}): Promise<
  {
    readonly result: JobResult;
    readonly stdout: Uint8Array;
    readonly capture_complete: boolean;
    readonly output_path?: string;
  }
> {
  const scope = await tempArtifactScopeFor(input.root);
  let redirect = "";
  if (input.stdin !== undefined) {
    const recorder = await JobOutputRecorder.create(scope);
    await recorder.write(input.stdin);
    const recorded = await recorder.finish();
    if (recorded.outputPath === undefined) {
      throw new Error("extractor input capture is incomplete");
    }
    redirect = ` < ${quoteCommandWord(recorded.outputPath)}`;
  }
  const command = `(\n${toCommand([...input.commands]) || ":"}\n)${redirect}`;
  const stdoutRecorder = await JobOutputRecorder.create(scope);
  let output: string | undefined;
  const job = { label: input.label, command };
  input.presentation?.observer?.started({
    ...job,
    command: toCommand([...input.commands]),
  });
  const settled = await spawnJob(job, {
    cwd: input.root,
    stream: input.presentation?.quiet
      ? false
      : input.presentation?.stream ?? false,
    write: input.presentation?.write ?? (() => {}),
    ...(input.presentation?.outputObserver === undefined ? {} : {
      outputObserver: input.presentation.outputObserver,
    }),
    signal: input.signal,
    env: input.environment,
    timeout: { seconds: input.timeout, key: input.timeoutKey ?? input.label },
    keepOutput: true,
    stdoutRecorder,
  }).finally(async () => {
    output = (await stdoutRecorder.finish()).outputPath;
  });
  let stdout: Uint8Array = new Uint8Array();
  let complete = false;
  let result = settled.result;
  try {
    if (output === undefined) {
      throw new Error("producer stdout capture is unavailable");
    }
    stdout = await readCompleteCapture(output);
    complete = true;
  } catch (error) {
    result = {
      ...result,
      status: "failed",
      code: 1,
      failureMessage: error instanceof Error ? error.message : String(error),
    };
  }
  input.presentation?.observer?.settled(result);
  if (input.presentation !== undefined) {
    presentJobResult({ ...settled, result }, input.presentation);
  }
  return {
    result,
    stdout,
    capture_complete: complete,
    ...(output === undefined ? {} : { output_path: output }),
  };
}
