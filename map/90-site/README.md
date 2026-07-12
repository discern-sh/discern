# The public site — discern.sh

The public-facing pages for discern, served from this repository so the same
gate that checks the engine checks the site
([ADR 0129](../_adr/0129-site-lives-in-repo-behind-one-fetch-handler.md)).
Contributor-facing: this subtree is not bundled into `discern help`.

## Shape

Everything lives under [`site/`](../../site/):

| Piece                                                  | Role                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| [`site/serve.ts`](../../site/serve.ts)                 | The one fetch handler: routes, reader negotiation, static fallback, 404s. |
| [`site/pages/`](../../site/pages/)                     | The HTML editions, one self-contained file per page.                      |
| [`site/text/discern.txt`](../../site/text/discern.txt) | The plaintext edition — DISCERN(1) as a man-style text document.          |

The routes, from the handler's exported `PAGES` table:

| Route       | Page                        | Text client receives                    |
| ----------- | --------------------------- | --------------------------------------- |
| `/`         | the engineers edition       | the plaintext edition                   |
| `/agents`   | the agent's manual          | the plaintext edition                   |
| `/start`    | the prompt-builders edition | the same HTML                           |
| `/careers`  | the careers page            | the same HTML                           |
| `/llms.txt` | —                           | the plaintext edition, for every reader |

## Reader negotiation

A browser declares `text/html` in its `Accept` header; nothing else reliably
does. On `/` and `/agents` the handler serves the plaintext edition to clients
that omit `text/html` and either match a known text tool (curl, wget, and
friends) or explicitly ask for `text/plain`. So `curl discern.sh` prints the
agent's manual, and the same URL in a browser renders the illustrated edition.
Negotiated responses carry `Vary: Accept, User-Agent`.

## Guards

[`tests/site_serve_test.ts`](../../tests/site_serve_test.ts) iterates the
exported `PAGES` table — every declared route must serve its page, negotiable
routes must serve the plaintext edition to text clients, and the plaintext file
itself must exist. A page added to the table auto-enrols; a route without its
file fails the gate.

## Operating it

[publishing.md](publishing.md) covers running the site locally and deploying it
to production.

## Current state & gotchas

- The pages load Tailwind from a CDN and fonts from Google Fonts. The root
  [`TODO.md`](../../TODO.md) tracks self-hosting both before launch — the pages
  advertise "no analytics on this page", and third-party asset requests undercut
  that claim.
- `mockups/landing/` is the design archive. Pages are promoted from there into
  `site/pages/` deliberately; the two are not synced.
