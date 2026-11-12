---
aliases:
  - React hydration
  - wall island
  - wall build step
---

# The wall's server render and build

How [the homepage wall](the-homepage-wall.md) is rendered on the server, hydrated in the browser, and built into the files the site serves. That page names the files and tests this page refers to.

## Server render and hydration

[`renderLanding`](../../../site/ui/pages/HomePage.tsx) renders `WallPage` to markup inside the host element `#wall-island` and writes the props it used to that element's `data-wall-props` attribute. The island reads them back through `decodeWallProps`, which refuses a malformed value, and hydrates the host with the same component.

The props are plain text and one table of text: the mark, the version, the headline, the category line, and `linkLabels`. That table gives the title of each manual page a card links to, by route. [`host.ts`](../../../site/wall/host.ts) defines the props and imports nothing, so the server and the build read the seam without loading the wall. The deck, lenses, and knob table are modules the component imports on both sides.

Only the server can read the manual. `HomePage.tsx` loads it once as the module loads and takes each linked page's title from it. A card that links to a page the manual does not publish stops the render.

Hydration has nothing to reconcile only while both renders produce the same markup. These rules keep them equal:

- `WallPage` and everything under it read no clock, no randomness, and nothing from the browser before an effect runs.
- No component calls `useId`. An element id is a fixed string or derives from a card id.
- The site build formats every generated page, and reformatting the wall's markup would change the nodes React expects. `HomePage.tsx` places a formatter directive before the host so the formatter leaves that element alone.

The island test proves the result: the served homepage contains the bytes that `renderToString` produces from the props on the host. The built island carries the production build of React, which keeps the server's attributes without a word when the browser's first render disagrees with them. The browser test therefore hydrates the served page once more with a bundle made with minification off, which carries the development build. That case fails on any console message other than a log or an info message, through hydration, a lens, and an opened card.

The page works before script runs. Every card's front, the headline, and the call to action are server markup. A card's second paragraph and its manual link exist only in the island. The lens bar needs script, so it stays hidden until the island sets `data-wall-live`. A card's heading is a button in server markup. Until the island is live, that button opens nothing and shows no pointer cursor, though the keyboard still stops on it. The opened card and the tuning panel never appear in server markup. `OpenCard` renders nothing until a card is open, and the wall checks the address for the panel's parameter only after it mounts.

The browser test loads the page with script off at phone and laptop sizes. It requires every card's copy to show, nothing left hidden or faded once the wall is flat, and no visible button that invites a press. On the laptop it also tabs onto the stage and requires the plane to lie flat under that focus, which the stylesheet does with no script.

The wall root `.wall` carries the page's state for the stylesheets. Every knob is an inline `--wall-<name>` custom property. Script adds data attributes as the state changes: `data-wall-live` once the island has hydrated, `data-wall-drift` and `data-wall-paused` for the drift knob, and the stage's mark, `data-wall-near`. The doc comments on [`WallPage`](../../../site/wall/WallPage.tsx) and in [`use_stage.ts`](../../../site/wall/use_stage.ts) list every attribute and its meaning. Script sets them all, so nothing a reader needs may depend on one.

## The build step

[`buildSite`](../../../site/build.ts) bundles the island before it renders any page, because the homepage links the bundle by a name only the build knows. [`bundleBrowserModule`](../../../site/page-src/format-generated.ts) runs `deno bundle --platform browser --minify` on `island.tsx`. It resolves React through the repository's import map and lockfile. Its `minify` option exists for the development-React case in the browser test. The bundle step and the generated-page formatter share one [registered spawn boundary](../50-engine-internals/subprocess-boundaries.md).

[`wallIslandFile`](../../../site/wall/assets.ts) turns the bundle into the file the build publishes, `wall-island.<hash>.js`, beside the wall's stylesheets. The hash is the leading hexadecimal digits of the SHA-256 digest of the file's own bytes, so a page cannot pair with a bundle built from other markup. No other module under `site/` spells that name. `wallIslandContentHash` reads the hash back from a file name.

The same function refuses a bundle that is not the island. `wallIslandFault` requires the script to name the host element and to carry a React runtime. A bundle step that ends without a fault and with empty or partial output therefore stops the build. No homepage ships with controls that never come alive.

[`renderMarketingPage`](../../../site/renderers.ts) takes the generated file names as an optional argument. The build passes the island's name. Every other caller, such as the prose checks, omits it and receives the same document without the script. The build fails unless the island's name appears in the homepage and in no other page.

[`site/serve.ts`](../../../site/serve.ts) serves a file whose name carries that hash with `cache-control: public, max-age=31536000, immutable`. A new build publishes new bytes under a new name, so a cache never needs to ask again. Every other bundled file keeps the five-minute policy.

[`SITE_BUILD_INPUTS`](../../../site/build_inputs.ts) includes `site/wall`, so the watcher rebuilds after a wall edit. It also includes `site/docs.tsx` and `project/manual`, because the homepage's markup carries the manual's page titles. Deno labels `deno bundle` experimental. The island test compares the built file with a fresh bundle of its entry, so a stale build or changed `deno bundle` output fails there.
