/**
 * Production entrypoint for Deno Deploy.
 *
 * The new Deno Deploy runs an app's entrypoint with `deno run` and waits for it
 * to start an HTTP server. A bare `export default { fetch }` never binds a port
 * under `deno run`, so the entrypoint has to start the server itself. This wraps
 * the identical handler in `Deno.serve` and nothing else — no site behaviour
 * lives here. Local development uses its loopback-only counterpart in `dev.ts`.
 *
 * `PORT` is honoured when set — for a container or `deno run` behind a reverse
 * proxy — and otherwise falls back to Deno's default, which Deno Deploy assigns
 * for you.
 */
import { handler } from "./serve.ts";

const port = Number(Deno.env.get("PORT")) || 8000;
Deno.serve({ port }, handler);
