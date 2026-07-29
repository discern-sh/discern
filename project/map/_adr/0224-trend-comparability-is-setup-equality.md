# ADR 0224: Trend comparability is setup equality, and analysis skips setup-era events

**Status**: accepted

## Context

ADR 0160 committed trend detectors to comparing "within an epoch" and attributing across boundaries. The first implementation realized that as a **contiguous window**: the longest run of newest events sharing the final event's config epoch, writer version, and dominant-client version era. Everything before the window's start became "prior" history, attributed to a boundary event.

Contiguity assumed history is sequential. It is not. Parallel worktrees each carry their own `discern.toml`, and all of them append to the one shared logbook under the git common dir. Epochs therefore interleave whenever two efforts' runs land alternately — the same few configs flipping back and forth, not genuine reconfigurations. On 2026-07-28 this repository's own logbook recorded six epochs interleaving within hours. With ~41 green `done` runs that day, the gate-duration trend reported "2 comparable runs since a config change to [acceptance]" and refused to trend. A by-hand reading of the same lines showed daily median gate duration rising ~100s → ~170s over the week. The logbook held the data; the windowing hid it. Any windowed finding fragments the same way, so the defect is the windowing model, not one detector.

A second comparability failure arrived from the field the next day: on a fresh install, `patterns` reported the gate "slowing" from 0.6s to 120s on its first day. The sub-second runs landed while `discern setup` was still in progress — the gate half-wired, the project still forming around it. Setup work deliberately stays on the dedicated setup branch (ADR 0065). `[meta]`, which carries the completion marker, is deliberately masked out of the epoch (ADR 0160). Setup-era runs can therefore share the epoch of the real work that follows, and no epoch rule can separate them.

Three constraints bound the fix. ADR 0160: readers advise, never gate, and recording stays facts — reader interpretation is the revisable layer, and revising it heals all existing history at once. ADR 0162: the logbook stores evidence, not inference, so a reader may only lean on what events already carry. And events carry only the **combined** epoch fingerprint — per-section hashes exist solely in the recorder's sidecar and as changed-section _names_ on `config-change` events.

## Decision

**Comparability is equality of setup, never position in the stream.** A trend's comparable series is every candidate whose setup — config epoch, writer version, dominant-client version in effect — equals the newest candidate's, wherever those runs sit in the logbook. The series excludes interleaved runs from other setups and attributes them instead: a count, plus what differs (changed sections where a `config-change` event names them, or the version pair for a release). The three dimensions carry equal weight, as before. On the client dimension, an event declaring the dominant client's version groups by that recorded evidence. Only events without a declaration fall back to the time-imputed era version.

One shared helper in the detector layer (`comparableSeries`) owns the grouping. Every windowed detector routes through it and carries a `windowed` marker in the registry. Parameterized guards iterate the marked set and hold two invariants for each member. Interleaving foreign-setup runs through a comparable series changes its findings not at all. A too-short series beside other-setup runs reports the attribution rather than going quiet. A new trend detector inherits the invariants by marking itself.

**Comparability is not section-scoped in v1.** A gate-duration series arguably shouldn't split on an `[acceptance]`-only change, but events record only the combined fingerprint. Scoping comparability to the sections a detector depends on would need per-event section hashes — a recording change, out of scope here. Reconstructing section histories from interleaved `config-change` events would stack inference on inference, exactly what ADR 0162 forbids. Whole-fingerprint equality already heals the observed failure, because flip-flopping configs _re-enter_ existing groups instead of restarting a window.

**Analysis skips setup-era events, at read time.** Every event from the dedicated setup branch — verb, begin, config-change, or pin — sits outside every detector population, and the report states the count. Recording does not change. The events stay in the logbook as facts — setup activity is still activity, and doctor/status still read them. `patterns` simply declines to read a forming project as practice.

The explicit *no*s: no schema change, no new event kinds, no change to epoch computation at write time, no recording toggle during setup, and no per-branch logbooks.

## Consequences

- The healing is retroactive. Reader-side reinterpretation covers every logbook ever recorded, including this repository's interleaved July history and any install already polluted by setup-era runs — precisely why ADR 0160 kept interpretation out of the recorder.
- A series may now span a config round-trip: change `[jobs]`, run, revert, and the runs on either side of the excursion are one series again. That is the honest reading — the setup is byte-identical — but it differs from "since the last change" intuition, and the copy must (and does) say "current setup", never "since the boundary".
- An `[acceptance]`-only one-way change still starts a fresh gate-duration series. Accepted: with equality grouping the loss is one series restart per _genuine_ change, not one per interleaved flip. Section-scoped comparability remains open, contingent on recording per-event section hashes first.
- Setup-branch attribution is the setup-era signal, so installs whose setup predates the setup-branch isolation (or ran with the logbook off) keep their setup-era lines in analysis — nothing distinguishes them. Accepted for v1.
- The dominant-client dimension still time-imputes versions for events with no client declaration; two clients interleaving versions concurrently can mis-group those undeclared events. Recorded declarations now win over imputation, which bounds the damage to the evidence actually missing.

## Alternatives considered

- **Keep contiguity, merge adjacent same-epoch windows.** Rejected: it re-derives equality grouping with extra steps and keeps a positional vocabulary ("boundary", "prior") that misreads interleaved history.
- **Section-scoped comparability now.** Rejected for the reasons in the decision: not derivable from recorded evidence without inference, and honest only after a recording change.
- **Suppress recording during setup, enabling it at `setup done`.** Rejected: it destroys facts (ADR 0160 records evidence; readers decide), leaves every existing logbook polluted, and loses genuinely useful setup-era history (crash evidence, doctor reads, how long setup took).
- **Mark setup-era on each event at write time.** Unnecessary: the setup branch name is already recorded on every event, and a write-side marker would not heal existing history.
