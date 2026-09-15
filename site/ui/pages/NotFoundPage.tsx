/** Minimal error document independent of generated site assets. */
import { renderToStaticMarkup } from "react-dom/server";

/** Keep unknown routes useful even when a requested static asset is missing. */
export function renderNotFoundPage(): string {
  return "<!doctype html>" + renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>404 · discern</title>
      </head>
      <body
        style={{
          fontFamily: "ui-monospace,monospace",
          padding: "4rem 1.5rem",
          color: "#1A1814",
          background: "#FBFAF7",
        }}
      >
        <p style={{ maxWidth: "34rem", lineHeight: 1.7 }}>
          404 — no such page.<br />
          Available pages: <a href="/">discern.sh</a> ·{" "}
          <a href="/agents">/agents</a> · <a href="/trust">/trust</a> ·{" "}
          <a href="/releases">/releases</a> · <a href="/docs">/docs</a> ·{" "}
          <a href="/map">/map</a> · <a href="/llms.txt">/llms.txt</a>
        </p>
      </body>
    </html>,
  );
}
