/** Validate known edge transformations without relaxing application contracts. */
import { SITE_ORIGIN } from "../site/seo.tsx";

const EMAIL_PATH = "/cdn-cgi/l/email-protection";

/** Recover only well-formed protected text that also exists in the source page. */
export function cloudflareEmailText(
  anchor: Element,
  source: Document,
): string | undefined {
  const href = anchor.getAttribute("href") ?? "";
  const url = new URL(href, SITE_ORIGIN);
  if (url.origin !== SITE_ORIGIN || url.pathname !== EMAIL_PATH) return;
  const element = anchor.matches("[data-cfemail]")
    ? anchor
    : anchor.querySelector("[data-cfemail]");
  const payload = element?.getAttribute("data-cfemail") ?? url.hash.slice(1);
  if (
    url.search !== "" || !/^(?:[a-f0-9]{2}){4,}$/iu.test(payload) ||
    (url.hash !== "" && url.hash.slice(1) !== payload)
  ) throw new Error("malformed Cloudflare email payload");
  const key = Number.parseInt(payload.slice(0, 2), 16);
  const bytes = Uint8Array.from(
    payload.slice(2).match(/../gu) ?? [],
    (byte) => Number.parseInt(byte, 16) ^ key,
  );
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const authoredToken = new RegExp(
    `(?<![\\p{L}\\p{N}._%+@-])${
      RegExp.escape(decoded)
    }(?![\\p{L}\\p{N}_%+@-]|\\.[\\p{L}\\p{N}])`,
    "u",
  );
  const text = source.createTreeWalker(source.body, 4); // NodeFilter.SHOW_TEXT
  let authoredText = false;
  while (text.nextNode()) {
    if (authoredToken.test(text.currentNode.textContent ?? "")) {
      authoredText = true;
    }
  }
  const authored = authoredText ||
    [...source.querySelectorAll('a[href^="mailto:"]')].some((link) =>
      link.getAttribute("href")?.slice(7).split("?")[0] === decoded
    );
  if (!/^[^\s@<>]+@[^\s@<>]+$/u.test(decoded) || !authored) {
    throw new Error("Cloudflare email does not match authored page content");
  }
  if (
    ![...anchor.ownerDocument.querySelectorAll("script[src]")].some((script) =>
      /^\/cdn-cgi\/scripts\/[a-f0-9]+\/cloudflare-static\/email-decode\.min\.js$/iu
        .test(script.getAttribute("src") ?? "")
    )
  ) throw new Error("Cloudflare email decoder is missing");
  return decoded;
}

/** Allow an exact HTTP upgrade before the application's canonical redirect. */
export async function productionRedirectFailures(
  source: string,
  destination: string,
  fetchResponse: (url: string) => Promise<Response>,
  security: (response: Response, label: string) => string[],
): Promise<string[]> {
  const failures: string[] = [];
  let response = await fetchResponse(source);
  const url = new URL(source);
  const upgrade = new URL(source);
  upgrade.protocol = "https:";
  if (
    url.protocol === "http:" &&
    url.hostname === new URL(SITE_ORIGIN).hostname &&
    (response.status === 301 || response.status === 308) &&
    response.headers.get("location") === upgrade.href &&
    upgrade.href !== destination
  ) {
    await response.body?.cancel();
    response = await fetchResponse(upgrade.href);
  }
  failures.push(...security(response, source));
  if (
    response.status !== 308 || response.headers.get("location") !== destination
  ) {
    failures.push(
      `${source}: expected canonical 308 to ${destination}, got ${response.status} to ${
        response.headers.get("location")
      }`,
    );
    await response.body?.cancel();
    return failures;
  }
  await response.body?.cancel();
  const final = await fetchResponse(destination);
  failures.push(...security(final, `${source} destination`));
  if (final.status !== 200) {
    failures.push(`${source}: canonical target returned ${final.status}`);
  }
  await final.body?.cancel();
  return failures;
}
