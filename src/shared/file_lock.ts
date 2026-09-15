/** Advisory-lock ownership is released independently of descriptor lifetime. */

/** Borrowed record access cannot close or unlock the owning file. */
export type FileLockIO = Pick<
  Deno.FsFile,
  "stat" | "seek" | "read" | "write" | "truncate"
>;

/** Own one file and explicitly release any acquired lock before closing it. */
export class FileLock implements Disposable {
  readonly io: FileLockIO;
  private held = false;
  private closed = false;

  private constructor(private readonly file: Deno.FsFile) {
    this.io = file;
  }

  /** Open the same persistent lock record that every contender uses. */
  static async open(
    path: string,
    options: Deno.OpenOptions,
  ): Promise<FileLock> {
    return new FileLock(await Deno.open(path, options));
  }

  /** Wait for exclusive ownership without changing the caller's wait policy. */
  async acquire(): Promise<void> {
    await this.file.lock(true);
    this.held = true;
  }

  /** Probe exclusive ownership without waiting for another holder. */
  async tryAcquire(): Promise<boolean> {
    const acquired = await this.file.tryLock(true);
    if (acquired) this.held = true;
    return acquired;
  }

  /** End ownership now, even if native I/O or a fork retains the descriptor. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.held) this.file.unlockSync();
    } finally {
      this.file.close();
    }
  }

  [Symbol.dispose](): void {
    this.close();
  }
}
