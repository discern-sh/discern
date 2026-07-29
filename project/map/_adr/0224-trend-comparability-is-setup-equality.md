# ADR 0224: Trend comparability is setup equality, and setup-era events are read out of analysis

**Status**: accepted

## Context

ADR 0160 committed trend detectors to comparing "within an epoch" and attributing across boundaries. The first implementation realized that as a **contiguous window**: the comparable set was the longest run of newest events sharing the final event's config epoch, writer version, and dominant-client version era, and everything before the window's start was "prior" history attributed to a boundary event.

Contiguity assumed history is sequential. It is not. Parallel worktrees each carry their own `discern.toml` and all append to the ONE logbook under the shared git common dir, so epochs interleave whenever two efforts' runs land alternately — the same few configs flipping back and forth, not a sequence of genuine reconfigurations. On 2026-07-28 this repository's own logbook recorded six epochs interleaving within hours. With ~41 green `done` runs that day, the gate-duration trend reported "2 comparable runs since a config change to [acceptance]" and refused to trend — while a by-hand reading of the same lines showed daily median gate duration rising ~100s → ~170s over the week. The data was recorded; the windowing hid it. Any windowed finding fragments the same way, so the defect is the windowing model, not one detector.

A second comparability failure arrived from the field the next day: on a fresh install, `patterns` reported the gate "slowing" from 0.6s to 120s on its first day. The sub-second runs were recorded while `discern setup` was still in progress — the gate half-wired, the project being stood up around it. Setup work is deliberately isolated on the dedicated setup branch (ADR 0065), and `[meta]` (which carries the completion marker) is deliberately masked out of the epoch (ADR 0160) — so setup-era runs can share the epoch of the real work that follows, and no epoch rule can separate them.

Three constraints bound the fix. ADR 0160: readers advise, never gate, and recording stays facts — reader interpretation is the revisable layer, and revising it heals all existing history at once. ADR 0162: the logbook stores evidence, not inference, so a reader may only lean on what events already carry. And events carry only the **combined** epoch fingerprint — per-section hashes exist solely in the recorder's sidecar and as changed-section *names* on `config-change` events.

## Decision

**Comparability is equality of setup, never position in the stream.** A trend's comparable series is every candidate event whose setup — config epoch, writer version, and dominant-client version in effect — equals the newest candidate's, wherever those events sit in the logbook. Interleaved runs from other setups are excluded from the series and attributed: counted, and named by what differs (the changed config sections where a `config-change` event names them, the version pair for a writer or client release). The three dimensions carry equal weight, as before. For the client dimension, an event that itself declares the dominant client's version is grouped by that recorded evidence; only events without a declaration fall back to the time-imputed era version.

One shared helper in the detector layer (`comparableSeries`) owns the grouping; every windowed detector routes through it and carries a `windowed` marker in the registry. Parameterized guards iterate the marked set and hold two invariants for each member: interleaving foreign-setup runs through a comparable series changes its findings not at all, and a too-short series beside other-setup runs reports the attribution rather than going quiet. A new trend detector inherits the invariants by marking itself.

**Comparability is NOT section-scoped in v1.** A gate-duration series arguably shouldn't split on an `[acceptance]`-only change, but events record only the combined fingerprint: scoping comparability to "the sections this detector depends on" would require per-event section hashes (a recording change, out of scope here) or reconstructing section histories from interleaved `config-change` events (inference stacked on inference, exactly what ADR 0162 forbids). Whole-fingerprint equality already heals the observed failure, because flip-flopping configs *re-enter* existing groups instead of restarting a window.

**Setup-era events are excluded from analysis at read time.** Every event recorded on the dedicated setup branch — verb, begin, config-change, or pin — is set aside before any detector population is derived, and the report states the count. Recording is unchanged: the events stay in the logbook as facts (setup activity is still activity, and doctor/status still read it); `patterns` simply does not treat a project being stood up as practice.

The explicit *no*s: no schema change, no new event kinds, no change to epoch computation at write time, no recording toggle during setup, and no per-branch logbooks.

## Consequences

- The healing is retroactive. Reader-side reinterpretation covers every logbook ever recorded, including this repository's interleaved July history and any install already polluted by setup-era runs — precisely why ADR 0160 kept interpretation out of the recorder.
- A series may now span a config round-trip: change `[jobs]`, run, revert, and the runs on either side of the excursion are one series again. That is the honest reading — the setup is byte-identical — but it differs from "since the last change" intuition, and the copy must (and does) say "current setup", never "since the boundary".
- An `[acceptance]`-only one-way change still starts a fresh gate-duration series. Accepted: with equality grouping the loss is one series restart per *genuine* change, not one per interleaved flip. Section-scoped comparability remains open, contingent on recording per-event section hashes first.
- Setup-branch attribution is the setup-era signal, so installs whose setup predates the setup-branch isolation (or ran with the logbook off) keep their setup-era lines in analysis — nothing distinguishes them. Accepted for v1.
- The dominant-client dimension still time-imputes versions for events with no client declaration; two clients interleaving versions concurrently can mis-group those undeclared events. Recorded declarations now win over imputation, which bounds the damage to the evidence actually missing.

## Alternatives considered

- **Keep contiguity, merge adjacent same-epoch windows.** Rejected: it re-derives equality grouping with extra steps and keeps a positional vocabulary ("boundary", "prior") that misdescribes interleaved history.
- **Section-scoped comparability now.** Rejected as above: not derivable from recorded evidence without inference; requires a recording change to do honestly.
- **Suppress recording during setup, enabling it at `setup done`.** Rejected: it destroys facts (ADR 0160 records evidence; readers decide), leaves every existing logbook polluted, and loses genuinely useful setup-era history (crash evidence, doctor reads, how long setup took).
- **Mark setup-era on each event at write time.** Unnecessary: the setup branch name is already recorded on every event, and a write-side marker would not heal existing history.
