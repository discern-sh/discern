/**
 * Run a freshly-COMPILED `discern` binary on PATH for as long as THIS process
 * lives — a lease, not a permanent swap.
 *
 * 99% of the time you want the from-source dev shim (`install-dev-cli`). But to
 * test the real shipped artifact — e.g. to rule the dev shim out as the cause of
 * a client-side MCP quirk — you need an opaque compiled binary on PATH instead,
 * one that carries no trace of this checkout. The trap with a plain swap is
 * forgetting to swap back, then confusing every agent that later runs `discern`.
 *
 * So this command makes the compiled state EPHEMERAL and visible: it builds the
 * host binary, installs it over the `discern` on PATH, then BLOCKS behind a live
 * banner. Press Ctrl+C (or close the terminal, or `kill` it) and it restores the
 * dev shim automatically before exiting. The only way the compiled binary stays
 * on PATH is for this process to keep running, in front of you.
 *
 * It reuses `scripts/build.ts` (the single source of truth for builds), so the
 * embed set, ad-hoc signing, and signature check match a shipped release.
 *
 * A MAINTAINER helper: it lives in `scripts/` (outside `templates/`), is never
 * bundled, and is kept OUT of discern's user-facing verbs.
 *
 * Usage:
 *   deno task use-compiled-build        # hold the lease; Ctrl+C restores the shim
 */

import { fromFileUrl, join } from "@std/path";
import {
  installExecutable,
  renderShim,
  resolveBakedCheckout,
  resolveCliDest,
  writeExecutableSync,
} from "./cli_install.ts";

/** Apply an ANSI code only when stderr is a real terminal. */
function style(code: string, text: string): string {
  return Deno.stderr.isTerminal() ? `\x1b[${code}m${text}\x1b[0m` : text;
}
const bold = (t: string): string => style("1", t);
const yellow = (t: string): string => style("33", t);
const dim = (t: string): string => style("2", t);

/** Build the host-target binary via the canonical build path. Returns success. */
async function buildHostBinary(
  repoRoot: string,
  triple: string,
): Promise<boolean> {
  const buildScript = fromFileUrl(new URL("./build.ts", import.meta.url));
  console.error(`compiling ${triple} …`);
  const { code } = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      buildScript,
      triple,
    ],
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  return code === 0;
}

function printLiveBanner(dest: string, triple: string): void {
  const rule = yellow("─".repeat(68));
  console.error("");
  console.error(rule);
  console.error(
    `  ${bold(yellow("⚠  COMPILED discern is LIVE on your PATH"))}`,
  );
  console.error(`     ${dest}`);
  console.error(`     → compiled binary (${triple}), no trace of any checkout`);
  console.error("");
  console.error(
    "  The from-source dev shim is suspended while this process runs.",
  );
  console.error(`  Press ${bold("Ctrl+C")} to restore it.`);
  console.error("");
  console.error(
    dim("  If this is KILLED (-9) or the machine dies, the shim won't restore"),
  );
  console.error(
    dim("  itself — put it back by hand with: deno task install-dev-cli"),
  );
  console.error(rule);
  console.error("");
}

/**
 * Hold the lease: the compiled binary is ALREADY installed at `opts.dest`.
 * Register restore-on-exit, show the banner, and block until a terminating
 * signal — on which the dev shim is restored synchronously and the process
 * exits. Never returns normally (exported so the swap-back path can be tested).
 */
export function holdCompiledLease(opts: {
  dest: string;
  bakedCheckout: string;
  triple: string;
}): Promise<never> {
  let restored = false;
  const restoreAndExit = (sig: string): void => {
    if (!restored) {
      restored = true;
      try {
        writeExecutableSync(renderShim(opts.bakedCheckout), opts.dest);
        console.error("");
        console.error(
          `  ↩  ${sig} — dev shim restored on PATH. Back to normal.`,
        );
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.error("");
        console.error(`  ✗  could not restore the dev shim: ${reason}`);
        console.error("     restore it by hand: deno task install-dev-cli");
        Deno.exit(1);
      }
    }
    Deno.exit(0);
  };

  // SIGINT covers Ctrl+C everywhere; SIGTERM/SIGHUP cover `kill` and a closing
  // terminal. Guard each registration so an unsupported signal can't abort setup.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as Deno.Signal[]) {
    try {
      Deno.addSignalListener(sig, () => restoreAndExit(sig));
    } catch {
      // Signal unsupported on this platform; the others still cover the exits.
    }
  }

  printLiveBanner(opts.dest, opts.triple);

  // A per-minute pulse so a long-lived lease keeps reminding you it is there.
  const startedMs = Date.now();
  setInterval(() => {
    const mins = Math.max(1, Math.round((Date.now() - startedMs) / 60_000));
    console.error(
      dim(
        `  ⚠  compiled discern still live (${mins}m) — Ctrl+C to restore the dev shim`,
      ),
    );
  }, 60_000);

  // Block until a signal handler ends the process; nothing else resolves this.
  return new Promise<never>(() => {});
}

async function main(): Promise<number> {
  const repoRoot = fromFileUrl(new URL("..", import.meta.url));
  const triple = Deno.build.target;
  const { dest } = await resolveCliDest();
  const bakedCheckout = await resolveBakedCheckout(repoRoot);

  // 1) Build first — nothing is swapped yet, so Ctrl+C here just aborts cleanly.
  if (!(await buildHostBinary(repoRoot, triple))) {
    console.error(`use-compiled-build: build failed for ${triple}`);
    return 1;
  }
  const builtPath = join(repoRoot, "dist", `discern-${triple}`);

  // 2) Swap the dev shim → compiled binary (atomic).
  try {
    await installExecutable(builtPath, dest);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`use-compiled-build: could not install ${dest}: ${reason}`);
    return 1;
  }

  // 3) Hold it until you let go; the shim is restored on the way out.
  return holdCompiledLease({ dest, bakedCheckout, triple });
}

if (import.meta.main) {
  Deno.exit(await main());
}
