/**
 * Open one URL with the host's ordinary browser launcher.
 *
 * discern ships for macOS and GNU/Linux. Keeping the platform command in one
 * adapter lets interactive callers share the effect without invoking a shell
 * or teaching their tests to open a real browser.
 */

/** One direct executable invocation for a supported host platform. */
export interface BrowserLaunch {
  readonly command: string;
  readonly args: readonly string[];
}

/** The small subprocess result the adapter needs from its injectable runner. */
export interface BrowserCommandResult {
  readonly success: boolean;
  readonly code: number;
  readonly stderr: string;
}

/** Testable subprocess boundary for the browser launcher. */
export type BrowserCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<BrowserCommandResult>;

/** Browser handoff outcome. Callers keep the URL visible when it fails. */
export type BrowserOpenResult =
  | { readonly status: "opened"; readonly launch: BrowserLaunch }
  | { readonly status: "unsupported"; readonly message: string }
  | {
    readonly status: "failed";
    readonly launch: BrowserLaunch;
    readonly message: string;
  };

/** One failed browser handoff, after narrowing away the success outcome. */
export type BrowserOpenFailure = Exclude<
  BrowserOpenResult,
  { readonly status: "opened" }
>;

/** Give every browser-opening surface the same speaker, cause, URL, and next
 * step when the operating-system handoff fails. */
export function browserOpenFailureMessage(
  subject: string,
  url: string,
  failure: BrowserOpenFailure,
): string {
  return `discern couldn't open ${subject}: ${failure.message}. ` +
    `Open ${url} in your browser.`;
}

/** Map every supported host to its direct browser-opening command. */
export function browserLaunch(
  url: string,
  os: typeof Deno.build.os = Deno.build.os,
  wsl = false,
): BrowserLaunch | undefined {
  switch (os) {
    case "darwin":
      return { command: "open", args: [url] };
    case "linux":
      return { command: wsl ? "wslview" : "xdg-open", args: [url] };
    default:
      return undefined;
  }
}

/** Run the host launcher without a shell. */
async function runBrowserCommand(
  command: string,
  args: readonly string[],
): Promise<BrowserCommandResult> {
  const output = await new Deno.Command(command, {
    args: [...args],
    stdin: "null",
    stdout: "null",
    stderr: "piped",
  }).output();
  return {
    success: output.success,
    code: output.code,
    stderr: new TextDecoder().decode(output.stderr).trim(),
  };
}

/** Open `url` in the user's browser and turn every platform/process failure
 * into data so the interactive surface can give one concrete fallback. */
export async function openInBrowser(
  url: string,
  options: {
    readonly os?: typeof Deno.build.os;
    readonly run?: BrowserCommandRunner;
    readonly wsl?: boolean;
  } = {},
  environment: Pick<typeof Deno.env, "get"> = Deno.env,
): Promise<BrowserOpenResult> {
  const os = options.os ?? Deno.build.os;
  const wsl = options.wsl ??
    (os === "linux" && Boolean(environment.get("WSL_DISTRO_NAME")));
  const launch = browserLaunch(url, os, wsl);
  if (launch === undefined) {
    return {
      status: "unsupported",
      message: `browser opening is unavailable on ${os}`,
    };
  }
  try {
    const result = await (options.run ?? runBrowserCommand)(
      launch.command,
      launch.args,
    );
    if (result.success) {
      return { status: "opened", launch };
    }
    return {
      status: "failed",
      launch,
      message: result.stderr === ""
        ? `${launch.command} exited with status ${result.code}`
        : result.stderr,
    };
  } catch (error) {
    return {
      status: "failed",
      launch,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
