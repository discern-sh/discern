import { normalizeCapturedOutput } from "../../shared/result.ts";

export interface JobOutputSummary {
  /** Best-effort path to this job's full combined stdout+stderr capture. */
  outputPath?: string;
  /** Count of output lines observed in the full capture. */
  outputLines: number;
  /** Count of lines that look like compiler/linter diagnostics. */
  errorLikeLines: number;
}

const DIAGNOSTIC_LABEL_RE =
  /\b(?:fatal error|error|warning)(?:\[[^\]\s]+\])?:/i;
const CARET_LINE_RE = /^\s*(?:\^+~*|~{2,})(?:\s|$)/;

async function writeAll(file: Deno.FsFile, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.length) {
    const written = await file.write(chunk.subarray(offset));
    if (written === 0) {
      throw new Error("short write while recording job output");
    }
    offset += written;
  }
}

export function isErrorLikeOutputLine(line: string): boolean {
  const visible = normalizeCapturedOutput(line);
  return DIAGNOSTIC_LABEL_RE.test(visible) || CARET_LINE_RE.test(visible);
}

export class JobOutputRecorder {
  private readonly decoder = new TextDecoder();
  private file: Deno.FsFile | undefined;
  private path: string | undefined;
  private pendingLine = "";
  private sawText = false;
  private lines = 0;
  private errorLike = 0;
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(path: string | undefined, file: Deno.FsFile | undefined) {
    this.path = path;
    this.file = file;
  }

  static async create(): Promise<JobOutputRecorder> {
    try {
      const path = await Deno.makeTempFile({
        prefix: "discern-job-",
        suffix: ".log",
      });
      const file = await Deno.open(path, {
        write: true,
        truncate: true,
      });
      return new JobOutputRecorder(path, file);
    } catch {
      return new JobOutputRecorder(undefined, undefined);
    }
  }

  write(chunk: Uint8Array): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      this.observe(chunk);
      if (this.file === undefined) {
        return;
      }
      try {
        await writeAll(this.file, chunk);
      } catch {
        try {
          this.file.close();
        } catch {
          // Best-effort artifact writing must never decide the job outcome.
        }
        this.file = undefined;
        this.path = undefined;
      }
    });
    return this.writeChain;
  }

  async finish(): Promise<JobOutputSummary> {
    await this.writeChain;
    const tail = this.decoder.decode();
    if (tail.length > 0) {
      this.observeText(tail);
    }
    if (this.pendingLine.length > 0) {
      this.countLine(this.pendingLine);
      this.pendingLine = "";
    }
    if (this.file !== undefined) {
      try {
        this.file.close();
      } catch {
        this.path = undefined;
      }
      this.file = undefined;
    }
    const summary = {
      outputLines: this.sawText ? this.lines : 0,
      errorLikeLines: this.errorLike,
    };
    return this.path === undefined
      ? summary
      : { ...summary, outputPath: this.path };
  }

  private observe(chunk: Uint8Array): void {
    const text = this.decoder.decode(chunk, { stream: true });
    if (text.length > 0) {
      this.observeText(text);
    }
  }

  private observeText(text: string): void {
    this.sawText = true;
    const normalizedNewlines = text.replaceAll("\r\n", "\n").replaceAll(
      "\r",
      "\n",
    );
    for (const ch of normalizedNewlines) {
      if (ch === "\n") {
        this.countLine(this.pendingLine);
        this.pendingLine = "";
      } else {
        this.pendingLine += ch;
      }
    }
  }

  private countLine(line: string): void {
    this.lines += 1;
    if (isErrorLikeOutputLine(line)) {
      this.errorLike += 1;
    }
  }
}
