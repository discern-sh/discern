/**
 * A shell fixture holds on a file its owner writes, and never outlives that
 * owner.
 *
 * Tests and repository tools pause a child — a desk shell, a gate job, a hook,
 * a backgrounded late writer — until a signal file appears. A bare polling
 * loop has no other exit: when the owner abandons it (a failing assertion
 * skips the release, the temporary directory is removed between the release
 * and the next poll, or the test runner is killed), the loop is reparented to
 * init and polls forever. Every file hold is therefore rendered here, and the
 * shell-wait guard rejects a hand-written one.
 */

export interface ShellAwaitFileOptions {
  /**
   * Wait for content rather than existence, for a writer that creates the
   * file before it writes it.
   */
  readonly nonEmpty?: boolean;
  /**
   * The process whose exit abandons the hold. The current test or tool
   * process owns its fixtures' holds, however deep they run beneath engine
   * processes, hooks, or backgrounded subshells. A shell's own `$PPID` would
   * name an intermediate engine process instead, which can outlive a killed
   * test runner while it waits for this very hold.
   */
  readonly owner?: number;
}

/**
 * Shell fragment that holds until `file` exists, polling at one reviewed
 * interval. The hold exits its shell (or the subshell it runs in) with status
 * 1 once the file's directory is gone or the owner has exited, so commands
 * after it never run for an abandoned fixture.
 *
 * `file` is one shell word, quoted as its context requires: `"$2"`,
 * `'/tmp/x/release'`, `"$PWD/ready"`, or a bare relative name. The fragment
 * itself contains no single quote, so it embeds in single-quoted TOML and
 * shell strings. A relative directory resolves against `$PWD` when the hold
 * starts, because a removed working directory still satisfies `[ -d . ]`.
 */
export function shellAwaitFile(
  file: string,
  options: ShellAwaitFileOptions = {},
): string {
  const present = options.nonEmpty === true ? "-s" : "-e";
  const owner = options.owner ?? Deno.pid;
  if (!Number.isSafeInteger(owner) || owner < 1) {
    throw new RangeError(`shell hold owner '${owner}' is not a process id`);
  }
  return [
    `hold_file=${file}`,
    'case "$hold_file" in */*) hold_dir=${hold_file%/*}/ ;; *) hold_dir=./ ;; esac',
    'case "$hold_dir" in /*) ;; *) hold_dir=$PWD/$hold_dir ;; esac',
    `while [ ! ${present} "$hold_file" ]; do [ -d "$hold_dir" ] && kill -0 ${owner} 2>/dev/null || exit 1; sleep 0.05; done`,
  ].join("; ");
}

/**
 * Run `during` while `held` waits on `release`, then always write `release`
 * and settle `held`, so a failing assertion can never skip the reap. The
 * hold's own exit bounds the wait. A failure in `during` outranks the held
 * operation's outcome; otherwise the held operation's value is returned.
 */
export async function whileHeld<T>(
  held: Promise<T>,
  release: string,
  during: () => Promise<void>,
): Promise<T> {
  // Observe the held operation first, so an early rejection is never unhandled.
  const settled = held.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  let failure: { readonly error: unknown } | undefined;
  try {
    await during();
  } catch (error) {
    failure = { error };
  }
  await Deno.writeTextFile(release, "released\n");
  const outcome = await settled;
  if (failure !== undefined) throw failure.error;
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
