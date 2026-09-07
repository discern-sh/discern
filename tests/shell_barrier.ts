/** A job advances only after its owner acknowledges the observed state. */
import { quoteCommandWord } from "../src/shared/command_evidence.ts";

interface ShellBarrier extends Disposable {
  /** Shell fragment blocking one phase until release() acknowledges it. */
  readonly wait: string;
  readonly path: string;
  readonly release: () => Promise<void>;
}

/** Create outside the fixture repository so coordination cannot change its subject. */
export async function shellBarrier(path: string): Promise<ShellBarrier> {
  const result = await new Deno.Command("mkfifo", {
    args: [path],
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  // Holding both ends makes acknowledgement safe even if the child has exited;
  // neither open nor a one-byte release depends on a concurrent reader opening.
  const pipe = await Deno.open(path, { read: true, write: true });
  return {
    path,
    wait: `IFS= read -r acknowledgement < ${quoteCommandWord(path)}`,
    release: async (): Promise<void> => {
      if (await pipe.write(Uint8Array.of(10)) !== 1) {
        throw new Error("shell acknowledgement was not written");
      }
    },
    [Symbol.dispose]: (): void => pipe.close(),
  };
}
