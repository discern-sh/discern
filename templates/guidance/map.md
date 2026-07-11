## The map & decisions

The tree at `{{map_dir}}` is the **map** — the agent-maintained account of this
codebase, browsable with **`discern_map`**. Agents write it and keep it current;
humans read it to audit what their agents understand; a stale map is a defect.
Never touch documentation the user didn't point discern at — the map is the only
tree discern maintains. Record significant or hard-to-reverse decisions as
**Architecture Decision Records** under `{{map_dir}}_adr/`.
