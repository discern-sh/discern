# Design principles

The principles that guide {{project_name}}: what the project commits to, why those commitments matter, and how they shape the work ahead. Use them when choosing between designs and reviewing a change.

These are agreed project requirements. A change that conflicts with one needs the owner's decision. Record the reasoning for a significant architectural exception in an [ADR](../_adr/README.md); writing the record does not grant approval.

<!-- setup fills this -->

<!--
  Replace the example with the project's agreed principles. Read its purpose,
  requirements, existing decisions, and implementation. For a new project,
  propose principles grounded in its intended use and confirm unsettled choices
  with the owner. Implementation is not a prerequisite for an agreed principle.

  Each principle has:

    ## <A clear rule that guides a design choice>

    <State the rule precisely enough to recognize a change that violates it.>

    **Why it matters.** <Explain the project-specific need or trade-off.>

    **How it guides work.** <Describe a concrete choice the rule determines.
    Link current code, checks, or requirements where they exist. For future work,
    state the commitment without claiming it is already implemented.>

  Keep existing policy authoritative by linking it. Do not infer a requirement
  merely because a pattern appears in the code. Remove this comment and the
  example once the project's principles are written.
-->

## Keep one home for every fact _(EXAMPLE — replace during setup)_

> This example demonstrates the format. Replace it with a rule grounded in this project's needs and agreed direction.

Each configuration value and shared rule has one authoritative source. Generate necessary copies from that source.

**Why it matters.** Independent copies can disagree and send different parts of the project in different directions. A shared source gives every reader and consumer the same answer.

**How it guides work.** Name the authority before adding a setting or rule. When a tool needs its own copy, generate that copy and check that it matches. In a completed principle, link the project's actual sources or explain how this commitment guides the first implementation.

## What these add up to

<!-- setup fills this -->

<!-- Explain how the agreed principles reinforce each other and what kind of project they help build. Give the owner a concise account of the direction future agents will inherit. -->
