/** Fixed release routes project the same comparison through the site's outer handler. */
import { RELEASE_ROUTES } from "../../src/shared/product_identity.ts";
import { RELEASE_SCHEMA_MAJOR } from "../../src/shared/public_schemas.ts";
import { type CatalogueRecord, compareReleases, parseSince } from "./model.ts";
import {
  renderReleaseError,
  renderReleaseHtml,
  renderReleaseText,
} from "./render.ts";

/** Negotiate only the HTML address; explicit machine suffixes retain their identity. */
export function releaseResponse(
  req: Request,
  path: string,
  asText: boolean,
  records: readonly CatalogueRecord[],
): Response {
  const format = path === RELEASE_ROUTES.json
    ? "json"
    : path === RELEASE_ROUTES.text || asText
    ? "text"
    : "html";
  const headers = new Headers({
    "content-type": format === "json"
      ? "application/json; charset=utf-8"
      : `text/${format === "html" ? "html" : "plain"}; charset=utf-8`,
    "cache-control": "public, max-age=300",
  });
  if (path === RELEASE_ROUTES.html) headers.set("vary", "Accept, User-Agent");
  const query = new URL(req.url).searchParams;
  if (path !== RELEASE_ROUTES.html || [...query].length > 0) {
    headers.set("x-robots-tag", "noindex, follow");
  }
  let since: string | undefined;
  try {
    since = parseSince(query);
  } catch (cause) {
    headers.set("cache-control", "no-store");
    return new Response(
      renderReleaseError({
        schema_version: RELEASE_SCHEMA_MAJOR,
        error: "invalid-since",
        message: cause instanceof Error ? cause.message : String(cause),
      }, format),
      { status: 400, headers },
    );
  }
  const model = compareReleases(records, since);
  const body = format === "json"
    ? JSON.stringify(model)
    : format === "text"
    ? renderReleaseText(model)
    : renderReleaseHtml(model);
  return new Response(body, { status: 200, headers });
}
