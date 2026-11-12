# ADR 0430: The homepage ships one hydrated React island

**Status**: accepted on 2026-11-10. Narrows [ADR 0135](0135-site-pages-use-build-time-react-and-static-runtime.md) and [ADR 0402](0402-site-layouts-use-server-rendered-react-components.md) for the route `/`. The package ownership in [ADR 0139](0139-the-design-system-is-an-independent-package.md) stands, and its restatement of ADR 0135's static-runtime clause narrows the same way.

## Context

The homepage body was a stack of marketing blocks, and it read like a manual. The owner replaced it with a wall: about seventy small cards, each stating one thing discern does. A visitor scans the cards in any order, brings one group forward with a lens, and opens one for a second paragraph and a link into the manual.

That page needs state in the browser. A lens is active or it is not. One card is open, in a modal dialog that returns focus to its card when it closes. The wall follows the pointer with a light, and scrolling brings it from a distant, tilted plane to a flat one.

Two earlier decisions kept that state out of reach. ADR 0135 sends every page as static HTML with page-owned progressive enhancement. ADR 0402 lets React render on the server and names browser hydration as a separate decision that a later page would have to make.

React already renders every site page on the server. Writing the wall's behavior as page-owned script would have produced a second account of the same view. That script would need its own selectors, its own state attributes, and its own copy of the opened card's markup, built from the deck a second time.

These facts bounded the choice:

- Deno 2.9 ships `deno bundle`, which resolves npm packages through the repository's own import map and lockfile. Bundling needs no new dependency.
- The site's Content Security Policy admits same-origin scripts and refuses `eval`, WebAssembly, and any style a script injects at run time.
- The owner found the motion in the first visual study nauseating. Calm motion is a requirement, so the page needs only a few transforms and opacity changes.

## Decision

**The homepage hydrates one React island, the wall.** [`WallPage`](../../../site/wall/WallPage.tsx) renders on the server into a host element. The browser hydrates the same component with the props the server recorded on that host. Those props are text: the page's own words, and the manual's title for each page a card links to. The document around the wall, including the head, header, and footer, stays static server output.

**The page is complete before script runs.** The headline, the call to action, and every card's front are server markup. The lens stays hidden until the island marks the wall live. A card's heading is a button that opens nothing until then. Hydration must find nothing to reconcile, so the component reads no clock, no randomness, and nothing from the browser before an effect runs.

**The island is one content-hashed script.** [`site/build.ts`](../../../site/build.ts) bundles [`site/wall/island.tsx`](../../../site/wall/island.tsx) with `deno bundle` and names the file after the SHA-256 digest of its own bytes. The homepage loads it as a same-origin module script. The site serves that file as immutable for a year, because a new build publishes new bytes under a new name. The build fails when the bundle is not the island, and when that file name is missing from `/` or present on any other page.

**Every other route stays free of a browser framework runtime.** The manual, the map, the decision records, and the release page keep the static runtime of ADR 0135. Tests hold that by script content. They read every script a route loads, imports included, and search for the string constants a React build leaves in any bundle. A check on file names would pass a bundle that carried React under another name.

**One module imports the browser client.** Only the island entry imports `react-dom/client`, and no module imports the island. The server and the build load neither.

**No animation library.** Motion uses only what the platform provides. CSS and the View Transitions API carry the wall's motion, and the Web Animations API is the one other tool this decision permits. CSS drives the scroll approach where the browser supports scroll-driven animation, and a browser without that support shows the flat wall from the start. The page is complete in both.

**The wall owns its look.** Its card surfaces, glyphs, and dark palette live in site stylesheets. ADR 0139's ownership stands: the wall asks the design-system package for nothing new and adds nothing to it.

This decision does not make the site a client application. It adds no client-side routing and no application shell, and it hydrates no part of the document outside the wall. A second island needs its own decision.

## Consequences

- `/` loads about 67 KB of gzip-compressed script, 210 KB before compression, as built on the day of this decision. That bundle holds React, React DOM, the wall's components, the deck, and the glyph drawings. The page reads in full before the script arrives, and a returning visitor's cache keeps the file until a build changes it.
- The build depends on `deno bundle`, which Deno 2.9 labels experimental. A Deno upgrade can change its flags or its output, and the hosted build needs a Deno that has the subcommand. A test compares the built file with a fresh bundle, so changed output fails that test.
- Server and browser must serialize identical markup. The glyph grammar therefore computes coordinates with arithmetic the language specifies exactly, and a structural guard rejects anything in the glyph modules that could vary between renders.
- Card copy ships twice: once as server markup and once inside the bundle. An opened card's second paragraph and its manual link exist only in the bundle. No server markup holds those paragraphs, so the prose checks read them from the deck module.
- The homepage's markup depends on the manual. The build reads each linked page's title, and a card that links to a page the manual does not publish stops the build.
- The wall is dark inside both site themes. It sits as one rounded dark room with a margin of the site's canvas around it, so a reader on the light theme sees a dark panel on a light page.
- The wall's look sits outside the design system. A package restyle does not reach it, and the package gains nothing from it.
- The runtime guard recognizes React by constants internal to React. A React release that renames them would blind the guard. The build and a test therefore require the island itself to carry them, and both fail on that release.
- The import map pins React once for the server and once for the browser client. Both pins must move together, because hydration needs one version on both sides.

## Alternatives considered

- **Page-owned script over static markup.** This is the pattern ADR 0135 set. The lens and the opened card would live in hand-written Document Object Model (DOM) code that repeats what the component already knows, and each new interaction would widen the copy.
- **A smaller framework runtime in the browser.** It would add a dependency and a second renderer whose output had to match the markup React renders on the server. Rendering one component on both sides gives that match with no further work.
- **A separate bundling dependency.** It would add a second module-resolution path beside Deno's import map and lockfile. `deno bundle` reads both.
- **An animation library.** The motion the owner approved is transforms and opacity changes tied to scroll, hover, and the opened card. CSS and the platform provide those, so a library would add script weight and a dependency for motion the page already has.
- **Hydrating the whole document.** The header, footer, and theme bootstrap are static and enhanced by the design-system package. Hydrating them would make React reconcile markup it has no reason to own. The island keeps hydration to the subtree that holds state.
