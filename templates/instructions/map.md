## The Map & decisions

`{{map_dir}}` is the agent-maintained **map**, browsable with **`discern_map`**. Agents use the map to learn and navigate the project; humans use the map to audit agent understanding. Update the map when the reader's mental model, a durable boundary, a supported workflow, or a product behaviour changes.

Staleness is a defect, so keep the map current — a page is current when nothing in it is false. A map page must **reduce** the total amount of repository reading required to make a correct decision, so it should never restate what code, tests, or config already express. Do not use the map to maintain independently mechanically derivable facts.

The map records what the code cannot say (boundaries, invariants, intent, where to start). The map should read in the present, not as change history. Significant, hard-to-reverse decisions belong as ADRs instead — save **Architecture Decision Records** under `{{map_dir}}_adr/`.

<!-- discern:map-regions -->

Stuck or missing context? `search` the map in task language, then fetch the best result's canonical `target`.
