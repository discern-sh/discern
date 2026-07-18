# ADR 0155: The permanent landing page and the /install endpoint

**Status**: accepted; extends [ADR 0129](0129-site-lives-in-repo-behind-one-fetch-handler.md) and [ADR 0144](0144-canonical-site-urls-and-one-hop-redirects.md)

## Context

Since mid-July the public `/` route served the Marketing block atlas wearing homepage labels — a stand-in promoted while the launch copy and the design system converged. The stand-in also carried claims the launch review would have rejected. It showed fabricated terminal numbers and a vanity install command with no route behind it. The retired "Software quality you can see" tagline survived on the page, the social card, and the metadata.

Replacing it surfaced two serving-layer defects. The generated composition pages carried `data-discern-root` on `<body>` but the theme attribute on `<html>`. The package scopes its dark-theme tokens to both attributes on one element, so the dark palette never engaged. Dark-preferring visitors received the light palette with dark-on-dark terminal text. Separately, the site title template suffixed `· discern.sh docs` onto every route, including `/`, which is not a docs page.

## Decision

`/` serves a purpose-built landing composition (`site/page-src/landing.tsx`) rendered from the published design system with the brief's fixed copy. The copy runs: the strapline, the install moment, the trust strip verbatim, the three pillars, the dual-address section, the objections, and the closing call to action. Every terminal frame on the page is genuine captured output from this repository's own gate, with elisions marked and nothing altered. The frames stage one story: a deliberately introduced one-character defect, the red verdict, the structured diagnostics, and the clean pass. The Marketing atlas remains at `/design-system-demo` as an explicitly labelled atlas, and the replaced stand-in moves to the `mockups/landing/` archive.

`/install` joins the stable non-HTML endpoints and serves the repository's own `install.sh`. The command the page prints — `curl -fsSL https://discern.sh/install | sh` — is therefore true from the first deploy that carries it. The plaintext edition's synopsis drops the Homebrew line (no formula exists yet) for the same command.

The landing page carries its exact title with no template suffix; every other HTML route keeps the `· discern.sh docs` template. The three generated pages share one document skeleton (`site/page-src/document.ts`). The skeleton places `data-discern-root` and the theme attribute together on `<html>`, matching the docs shell, so both palettes engage everywhere. The social card draws on the design system's dark palette and sets the strapline.

## Consequences

- The frozen-route contract extends by one non-HTML endpoint; `/install` cannot later move without a redirect. A test holds its response to the exact bytes of the repository's `install.sh`.
- Claims on `/` are now checkable in the repository: the captures name their date and origin, and the licence line matches the shipped Apache-2.0 LICENSE rather than the licence the older brief assumed.
- Dark mode works on every generated composition page. The pairing rule — root and theme attributes on one element — is the convention any new static page inherits from the shared skeleton.
- The homepage title is the one route allowed to speak in its own voice; the smoke crawler and the metadata tests pin the exemption to exactly `/`.
