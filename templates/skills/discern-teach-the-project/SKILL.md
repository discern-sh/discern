---
name: discern-teach-the-project
description: Route a lesson this session produced into the project's own surfaces — an instruction line, an authored skill, a project script, a doc, or an ADR — so every future agent session inherits it. Use when the user says "remember this", "add this to the instructions", "capture this", or wants a rule or procedure to stick. Also offer it proactively, at a natural pause and never mid-task, after the user corrects your approach, after you derive a non-obvious procedure the hard way, or when a decision gets made that no file records. Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Teach the project

Sessions end; what they learned usually ends with them. The correction the user gave you, the procedure you derived the hard way, the decision you both reached — unless it's written into the project, the next session rediscovers it from scratch, or worse, guesses differently. discern gives a project several surfaces built to carry knowledge forward, and **anything routed into them is inherited by every future agent session, whichever vendor's agent shows up**. That is how a project gets smarter over time instead of merely older.

The judgement this skill holds is _routing_: each kind of lesson has exactly one right home, and a lesson filed in the wrong one is never found again.

---

## 1. Catch the lesson

The lessons worth teaching mostly announce themselves:

- **The user corrected you** — your approach was reasonable but wrong _here_; the correction encodes a project rule nobody had written down.
- **You derived something the hard way** — a procedure, an incantation, a gotcha that cost real effort to figure out and will cost the next session the same.
- **A decision was made that no file records** — the conversation settled something the code alone won't explain.
- **You explained the same thing twice** — to the user, or in two prompts; repetition is a filing request.

Not everything qualifies. A fact only this conversation needs, something the code or git history already records, or a one-off detail — let those go. Teaching has a cost (the surfaces are read by every future session), so teach what will still be true and useful next month.

---

## 2. Offer at the right time

When the lesson came from you noticing (rather than the user asking), **offer — don't just file.** One sentence, at a natural pause: after the task lands, at review, at wrap-up — never mid-implementation, and never as a stream of little interruptions. Batch what the session produced: "Two things came up worth teaching the project: X and Y — want me to capture them?" The user knows what's idiosyncratic to today versus durably true; their _no_ is information, not an obstacle.

---

## 3. Route it — each lesson has one home

Pick the **smallest surface that fully carries the lesson**, and give it exactly one home — the same single-source rule the code lives by:

| The lesson is…                                                                    | Its home                                                                                                   | Why there                                                                                       |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A standing rule every session must follow ("always X here", "never Y")            | **A instructions line** — the project instruction source ({{instruction_sources}}), compiled into every agent's file | Always in context, so it's never missed — and always _paying_ context, so it must earn its line |
| A repeatable, multi-step procedure needing judgement                              | **An authored skill** — a `SKILL.md` under `{{skills_dir}}`                                                | Discoverable when the task matches; costs context only when used                                |
| A deterministic action — a command sequence you'd otherwise re-derive             | **A project script** — an executable in `{{scripts_dir}}` (run it with `discern scripts <name>`)            | A script executes exactly; prose about commands drifts                                          |
| Durable context — how a subsystem works, what's true and why it's shaped this way | **A docs page** — under `{{map_dir}}` (the `discern-document-subsystem` skill maintains subtrees)          | Read on demand; the reference the other surfaces can point at                                   |
| A decision — hard to reverse, surprising without context, a real trade-off        | **An ADR** — via the `discern-write-adr` skill                                                             | Records _why_, so it isn't silently re-litigated                                                |

Two rules across all five: **check for an existing home first** — a lesson that updates a stale instructions line, an existing skill, or a current doc belongs _there_, not in a duplicate; and **never split one lesson across surfaces** — if a rule needs its rationale, the rule goes in instructions with a link to the ADR that explains it.

---

## 4. Author it to that surface's own bar

- **An instruction line** is one or two sentences, imperative, with the _why_ in half a sentence when it isn't obvious — written for an agent who will read it in every session, forever. If it needs a paragraph, it's probably a doc plus a one-line pointer.
- **An authored skill** must be a genuine multi-step playbook — trigger-rich `description` frontmatter (that's what matching runs on), concrete steps with the judgement points called out, and a falsifiable "done when". A single deterministic action is not a skill; make it a project script.
- **A project script** is an executable with an optional `# desc:` line, exiting non-zero on failure, silent about things it didn't do.
- **Docs and ADRs** follow the project's existing tree and ADR format — their skills hold those bars.

Write for a _future reader with no memory of today_: name files by path, not "the file we discussed"; state the rule, not the story of how it emerged.

---

## 5. Compile, verify, and report

Teaching isn't done until the surface is live:

- Instruction edits: run `discern refresh` so the agent files recompile; the gate fails on drift either way.
- A new skill or project script: confirm it's discoverable — `discern skills list` shows the skill materialized into the agent dirs; `discern scripts` lists the script.
- Tell the user what was taught and _where_, in one line each — they're the editor of record for what their project believes.

> I taught the project <lesson> in <surface>. I verified it with <verification>.

---

## Done when

- each lesson lives at **exactly one surface**, the smallest that carries it — updating an existing entry rather than duplicating it;
- what was authored meets **that surface's bar** (an earning-its-line instructions rule, a real playbook, an executable project script, a current doc, a why-carrying ADR);
- the surface is **live** — instructions recompiled, skill/project script discoverable — and the user was told what the project just learned;
- anything the user declined to capture was **dropped without residue** (no half-filed notes in odd corners).
