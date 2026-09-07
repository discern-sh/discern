# ADR 0383: Test shell waits require observable transitions

**Status**: accepted.

Amends [ADR 0340](0340-tests-wait-on-conditions-and-enrol-real-delays.md) for shell fixtures; its JavaScript timer capability and protected census remain enforced.

## Context

A shell command embedded in a test can spend elapsed time without calling a JavaScript timer. A producer that prints a partial line, waits briefly, then replaces it does not establish that a terminal observer saw the first line. Similarly, a finite child lifetime can expire before the test reaches its intended cancellation. Runtime load changes both races without changing the product behavior being tested.

## Decision

**Test transitions advance from observed state. Remaining elapsed shell commands require explicit enrollment and semantic review.**

Transient-frame fixtures use an owned acknowledgement channel outside the repository under test. The producer waits until the observer acknowledges each required frame. Resize fixtures observe the initial frame before changing the kernel viewport, then observe a new stable job fact before releasing output. Kernel mutation alone does not acknowledge the renderer transition. Cancellation and timeout stimuli remain active until the product terminates them; pinned lifecycle facts require no artificial interval.

The syntax guard scans Git-derived test directories and native test entry names at any depth, including string declarations, static concatenation, templates, and shell fixtures. The shell-wait registry binds each retained command to its enclosing test or helper, argument, occurrence count, and reason. New copies and new fixture containers enter automatically. Retained intervals pace condition polling, exercise actual elapsed behavior, or supply a bounded competing workload after explicit queue readiness. Changes to either waiting registry reach the timing-readiness checkpoint.

## Consequences

- Intermediate output assertions retain their full behavior without a minimum display lifetime guessed from machine speed.
- JavaScript timer and shell-command populations stay separately inspectable; the existing timer Standard keeps its definition and limit.
- Static enrollment does not prove that a justification is true. Semantic review remains required, and arbitrary runtime-generated commands are outside the syntax census.
- Acknowledgement channels belong to the fixture owner and are closed before temporary-directory cleanup. Process cancellation and teardown remain awaited.

## Alternatives considered

- Longer intervals preserve the race and add cost to every passing run.
- Removing intermediate-frame assertions would lose the intended presentation evidence.
- A free-form timing helper would hide new guesses behind one allowed implementation.
- Treating every shell wait as a defect would remove condition polling and elapsed behavior that the suite deliberately exercises.
