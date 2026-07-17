# Testing

_The testing approach in this repo — how tests are written, how they run, and the patterns the gate assumes._

> This doc is a skeleton. The `discern setup` command (and the `discern-document-subsystem` skill, when filling the `80-development` subtree) writes it from the project's actual test stack. Look for the `<!-- setup fills this -->` marker.

The `test` capability in `discern.toml` is what `discern done` runs; this doc explains how to write tests that pass it and how to run them while iterating.

## How tests run

<!-- setup fills this -->

_(How the `test` capability invokes the suite, how to run a single test or a filtered subset while iterating, and — importantly — whether the suite runs in parallel. If it does, the [gate gotchas](done-gate-gotchas.md) "passes alone but fails in the full run" trap applies: every test must own its fixtures and assume no ordering. Spell out the parallel-safe pattern this project uses.)_

## How tests are written

<!-- setup fills this -->

_(The conventions for a good test here: structure, what to assert, fixtures/factories, what to mock and what not to. If the project practices a particular discipline — write the failing test first, test behaviour not implementation — state it and what it requires.)_
