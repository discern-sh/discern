/** Serve one terminal-capture artifact over a loopback-only review URL. */

import { isAbsolute, resolve } from "@std/path";

const LOOPBACK_HOST = "127.0.0.1";
const REVIEW_PATH = "/";

const HELP = `Serve one terminal-capture HTML artifact for rendered review.

Usage:
  deno task terminal:review <artifact.html>

The task binds an ephemeral 127.0.0.1 port, prints the review URL, and serves
only the named artifact until the process stops.
`;

const HTML_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

/** One running terminal-artifact review server. */
export interface TerminalReviewServer {
  readonly url: Promise<URL>;
  readonly finished: Promise<void>;
  shutdown(): Promise<void>;
}

/** Serve the artifact only at the root path and only through read methods. */
export function terminalReviewResponse(
  html: string,
  request: Request,
): Response {
  const url = new URL(request.url);
  if (url.pathname !== REVIEW_PATH) {
    return new Response("Not found\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed\n", {
      status: 405,
      headers: {
        allow: "GET, HEAD",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
  return new Response(request.method === "HEAD" ? null : html, {
    headers: HTML_HEADERS,
  });
}

/** Start one ephemeral loopback server without exposing the artifact directory. */
export function startTerminalReviewServer(
  html: string,
): TerminalReviewServer {
  let announce: ((url: URL) => void) | undefined;
  const url = new Promise<URL>((resolveUrl) => {
    announce = resolveUrl;
  });
  const server = Deno.serve({
    hostname: LOOPBACK_HOST,
    port: 0,
    onListen: ({ port }) => {
      announce?.(new URL(`http://${LOOPBACK_HOST}:${port}${REVIEW_PATH}`));
    },
  }, (request) => terminalReviewResponse(html, request));
  return {
    url,
    finished: server.finished,
    shutdown: (): Promise<void> => server.shutdown(),
  };
}

/** Resolve, load, serve, and announce one requested artifact. */
async function main(args: readonly string[]): Promise<void> {
  if (args.length === 1 && args[0] === "--help") {
    console.log(HELP.trimEnd());
    return;
  }
  const requested = args[0];
  if (args.length !== 1 || requested === undefined) {
    throw new TypeError(HELP.trimEnd());
  }
  const artifact = isAbsolute(requested) ? requested : resolve(requested);
  const html = await Deno.readTextFile(artifact);
  const server = startTerminalReviewServer(html);
  console.log((await server.url).href);
  await server.finished;
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
