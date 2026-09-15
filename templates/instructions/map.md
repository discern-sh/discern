## The Map & decisions

`{{map_dir}}` is the agent-maintained **map**, browsable with **`discern_map`**. It explains the current project with links to evidence. Agents use it to learn and navigate; humans use it to inspect agent understanding.

Update the affected pages when a change alters a boundary, constraint, supported workflow, or product behavior. Explain the behavior and relationships a reader needs to make a correct change. Summarize implementation when it helps, and link the code, tests, configuration, or agreed requirement that supports the explanation. Name functions as entry points or to explain contracts; do not transcribe every method, symbol, or source file. Keep mechanically derivable inventories in their authority or generated reference.

Extend an existing section first. Split a child page for a distinct reader task. Create a region with its own README for a durable responsibility; ordinary features belong under their subsystem. Keep the root for the project overview and navigation. Follow the project's existing ordering; numeric prefixes are optional.

Keep current behavior, agreed requirements, and unresolved questions distinct. The map describes the present; concrete outstanding work belongs in `{{todo_path}}`. Record significant decision rationale in **Architecture Decision Records** under `{{map_dir}}_adr/`. An ADR records a decision or approved exception; it does not authorize overriding an agreed requirement.

<!-- discern:map-regions -->

Stuck or missing context? Call `discern_map` with `search` in task language, then retrieve the best result using its returned `target`.
