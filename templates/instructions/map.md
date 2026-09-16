## The Map & decisions

`{{map_dir}}` is the **map**, browsable with **`discern_map`**: maintained explanations for agents and an account of their understanding for humans.

Keep affected pages accurate when behavior, boundaries, constraints, or workflows change. Keep the map in the present, not as change history; remove resolved-bug narratives. Explain what readers need for correct changes; link supporting code, tests, configuration, and requirements. Useful implementation summaries belong here. Name functions for entry points or contracts; never transcribe every method or duplicate derivable inventories.

Extend existing sections first. Split pages for distinct reader tasks; create folders with READMEs for durable responsibilities. Keep the root for overview and navigation. Follow existing ordering; numbers are optional.

Link relevant instructions, skills, checks,{{#if has_checkpoints}} checkpoints,{{/if}} and ADRs; each keeps its own authority.

Separate current behavior, agreed requirements, and open questions. Put concrete open work in `{{todo_path}}`. Preserve significant architectural rationale as **Architecture Decision Records** under `{{map_dir}}_adr/`. ADRs record decisions; they cannot authorize exceptions to agreed requirements.

<!-- discern:map-regions -->

Find context with `discern_map` `search` in task language, then retrieve the returned `target`.
