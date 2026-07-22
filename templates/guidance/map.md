## The map & decisions

`{{map_dir}}` is the agent-maintained **map**, browsable with **`discern_map`**. Keep it current; staleness is a defect. Humans audit agent understanding. Maintain no documentation outside it unless the user asks. Put significant, hard-to-reverse decisions in **Architecture Decision Records** under `{{map_dir}}_adr/`.

Use a region as `target` for its index, or add `search` to scope a query. When unsure, search in task language, then fetch a result with its canonical `target`.

<!-- discern:map-regions -->
