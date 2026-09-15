# ADR 0205: Browser Workflow semantics are explicit Markdown projections

> **Amendments.**
>
> **Build-on links (2026-07-28):** This record builds on [ADR 0135](0135-site-pages-use-build-time-react-and-static-runtime.md), which keeps the browser runtime static, and [ADR 0139](0139-the-design-system-is-an-independent-package.md), which makes the exact external package release the component and semantics boundary.
>
> - **React site authoring:** React is permitted in the website server. Explicit Markdown workflow directives remain authoritative, and their corpus renderer must preserve the complete raw source and product semantics. See [ADR 0402](0402-site-layouts-use-server-rendered-react-components.md).

**Status**: accepted

## Context

The manual has one authority: Markdown under `project/map/`. The same bytes serve terminal help, MCP, text negotiation, `.md` routes, search, and the browser. Design-system 0.9.0 gives the browser a Workflow grammar for procedures, commands, results, paths, ownership, and choices, but ordinary Markdown does not say whether a code fence is an executable command or whether a list is a procedure.

Inferring those meanings from headings or prose would make small copy edits change the rendered semantics. Copying the facts into a site route registry would create a second manual, while putting the only complete instruction in browser HTML would weaken terminal and text readers. The browser therefore needs an explicit source signal that leaves the Markdown itself complete.

## Decision

**Browser-only Workflow semantics use strict HTML-comment directives around complete, ordinary Markdown blocks.**

- A directive opens as `<!-- discern-workflow:<kind> -->` and closes as `<!-- /discern-workflow -->`. The enclosed Markdown carries every fact and remains useful when comments are ignored.
- `site/workflow_registry.ts` owns the closed directive vocabulary and the design-system roots each member selects. The canonical-set guard enrols every new member in a parser, a real source example, and the emitted bundle.
- `site/workflow.tsx` parses the marked blocks before the shared Markdown renderer runs, then emits the published package's semantic HTML through its public manifest and class helper. Unknown, nested, incomplete, or malformed directives fail the page build at their source path.
- The projection is presentation metadata, not another content model. It does not infer semantics from arbitrary headings, lists, tables, or code fences, and no route registry repeats the prose.
- Raw help, MCP, negotiated text, and `.md` routes continue to serve the pristine Markdown bytes. JavaScript is optional behavior on the already-complete semantic HTML, not a source of instructions.

## Consequences

- One page remains authoritative across every reader while the browser can communicate operational structure precisely.
- Authors must choose and satisfy a small directive grammar when a block deserves Workflow treatment. Copy changes inside a marked block can fail early if they break that contract.
- The source now contains site-facing HTML comments. Other Markdown readers ignore them, but removing or renaming a marker is a semantic change and must update the registry-backed guard.
- The browser renderer deliberately supports only the few projections Discern uses. Adopting another Workflow component means extending the canonical vocabulary and proving a real journey, rather than silently styling more prose.
- The site is coupled to the published semantic HTML contract of the exact design-system release, while remaining React-free and framework-free at runtime.

## Alternatives considered

- **Infer components from Markdown shapes or wording.** Rejected because heuristics make prose edits change semantics and eventually misclassify ordinary fences, lists, and tables.
- **Keep typed presentation data in a route registry.** Rejected because commands, outcomes, and next actions would be copied away from their canonical page.
- **Author browser-only component HTML in the Markdown.** Rejected because it leaks package anatomy into every reader and makes the raw manual harder to maintain.
- **Leave every journey as generic prose.** Rejected because the published Workflow grammar would add bundle weight without giving readers its structural and accessibility benefits.
