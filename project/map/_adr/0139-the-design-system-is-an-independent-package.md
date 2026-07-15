# ADR 0139: The design system is an independently versioned package

**Status**: accepted

## Context

Discern's design system began under `site/design-system/` so the public-site
prototype, component catalogue, tests, and static page build could evolve in one
atomic repository. That proved the build-time React/static-browser model
recorded in ADR 0135 and produced a reusable visual system rather than a set of
page-local styles.

The prototype has become a substantial independent subsystem: hundreds of
tracked source files, dozens of components, typed tokens, examples, a catalogue,
self-hosted fonts, textures, and its own build/test contract. Keeping all of
that in Discern makes the engine repository carry a frontend library it does not
need to author. Copying the system into another Deno site would instead create
two visual forks with no version or compatibility boundary.

Both known consumers are Deno sites. Discern uses React adapters only while
rendering static HTML; another site must be able to consume semantic HTML/CSS
and themes without React. The package therefore needs a framework-neutral core,
selective CSS/assets, and a public theming seam rather than an assumption that
every consumer shares Discern's page composition or blue accent.

## Decision

The branded `discern-design-system` is developed and released from its own Git
repository as one independently versioned package. JSR is its first canonical
registry because the known consumers are Deno applications; npm publication is
deferred until a real non-Deno consumer justifies a second release channel. The
GitHub owner and JSR scope are selected immediately before publication, not
guessed during local preparation.

The package owns tokens, scoped framework-neutral CSS, components, metadata,
examples, catalogue, optional assets, an optional React adapter, and a
deterministic build API. Its public CSS names use the `discern` namespace. The
default preset retains Discern's blue identity, while public semantic tokens and
slots allow consumer themes such as a green personal site without forking
component CSS. Fonts and textures are opt-in.

Discern consumes an exact immutable package version. It keeps only product page
composition, copy, docs rendering, its selected theme, progressive enhancement,
a thin build integration, and consumer tests. The package release is proven
before the in-repo source is removed. Registry files are copied into each
consumer's build output; browsers do not hotlink the registry or another asset
host.

This changes ADR 0135's in-repository ownership/location clause. Its central
decision still stands: Discern may use React at build time, and the browser
receives static HTML/CSS with no implicit hydration or React runtime.

## Consequences

- Discern loses the component source, catalogue, examples, package assets, and
  package-only tooling, keeping its repository focused on the engine and the
  small public site that presents it.
- The same maintained visual system can serve Discern and unrelated Deno sites;
  attribution remains useful branding without forcing Discern product copy into
  examples.
- CSS class names, custom properties, root attributes, layers, and animation
  names become a versioned public API. The pre-launch `ds` to `discern` rename
  avoids publishing two permanent namespaces.
- React becomes an explicit optional adapter rather than a transitive
  requirement for consumers that hand-author semantic HTML.
- Consumers can select components/groups and optional assets instead of loading
  the complete catalogue runtime. The package must maintain a dependency graph,
  manifest schema, SemVer discipline, migration notes, and clean-room consumer
  fixtures.
- Discern's site build now depends on a package release. A package defect is
  fixed and released in the package repository, then consumed as a new exact
  version; it is not patched by copying source back into Discern.
- Releases require coordination across two repositories and cannot be made
  atomic. Publishing first and cutting over second supplies the rollback seam.
- JSR's code-oriented module model makes the CSS/font/texture build interface a
  deliberate contract. It must work on stable Deno without undocumented cache
  paths, experimental byte imports, or production registry hotlinks.
- The docs-browser platform work waits until the namespace and asset boundary
  have landed, avoiding a later rewrite of its CSP, hashed assets, search shell,
  accessibility fixtures, and size baselines.

## Alternatives considered

**Keep it in Discern.** This retains atomic changes but makes the engine own a
large reusable frontend authoring surface and does not solve reuse by another
site.

**Copy or fork it for each site.** This minimizes packaging work initially but
creates immediate drift in tokens, components, accessibility fixes, and asset
licensing. There is no dependable way to know which fork contains the current
contract.

**Publish to npm first or to npm and JSR simultaneously.** npm remains a valid
future compatibility channel, and Deno can produce it with `deno pack`. It adds
compiled artifacts and a second release surface without serving either known
consumer today, so it is deferred rather than forbidden.

**Split tokens, styles, React adapters, and assets into several packages.** That
would make optionality visible in package names but impose version choreography
before the component dependency graph or external demand requires it. One
package with explicit module and runtime selections provides the needed seams.
