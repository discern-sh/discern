# ADR 0143: Site URLs are canonical at the apex and redirects resolve in one hop

**Status**: accepted

## Context

The site served `/docs`, `/docs/`, and `/docs/index.html` as duplicate 200
responses, raw Markdown editions carried no indexing policy, and no canonical or
redirect machinery existed. That was harmless before publication and dangerous
at launch: crawlers could split authority across representations, and a future
rename could create a chain if each move were handled locally.

Redirects have two different owners. A moved page knows its own historical
addresses, while a section rename has no single destination document that can
own the whole structural move. Heading fragments are different again: they never
reach the server, so an HTTP redirect cannot preserve a renamed anchor.

## Decision

The canonical production origin is `https://discern.sh`. HTML routes use no
trailing slash and no `.html` suffix. HTTP, `www`, trailing-slash, and
`index.html` variants return 308 to the final apex URL in one response. Every
successful HTML page names itself with a canonical link; an explicit `.md`
edition points to the HTML URL with a `Link` header and carries
`X-Robots-Tag: noindex, follow`.

Destination-owned `redirect_from` claims feed the shared validated document
registry. `site/seo.ts` combines that registry with an explicit static map for
section moves, derives matching `.md` redirects, and refuses dead targets,
live-route collisions, double claims, chains, and loops. The site has no
historical redirects before launch, so both registries begin empty; the slug
freeze starts their maintenance obligation.

When a published heading changes, the page retains the old fragment as an
explicit alias anchor beside the new heading. Fragment compatibility is page
content, not server routing.

Unknown addresses return 404. A 410 is reserved for a deliberately retired URL
that has no replacement and must be introduced through an explicit tombstone;
the site does not infer gone routes from missing files. There are no tombstones
at launch.

## Consequences

- A crawler sees one HTML address eligible for indexing for each page and
  reaches a moved page in one hop, including its Markdown representation.
- A redirect mistake fails the gate before the handler can serve it.
- Renaming a public page or heading now carries an explicit compatibility task;
  deleting a file is never enough.
- Local development keeps its local origin for variant redirects, while page
  metadata still names the production canonical origin.
