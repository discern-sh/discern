# ADR 0244: The brand addresses the owner and judges only the work

**Status**: accepted

## Context

discern launches into a market that sells quality tooling as protection from AI. The category frames itself around catching a model's mistakes, with copy built on distrust of the workforce the customer chose. The owner's July 2026 launch review settled a different position, for two reasons. The buyer changed: with hand-written code, the judge and the judged were the same person, so quality tooling accused its own buyer. Agent-authored code dissolves that barrier — the buyer is now the judge, and a quality system can flatter their judgment instead of impugning their work. The felt problem moved too: inside one task window, agent work is mostly good now. The injury users report is silent regression — the feature from three weeks ago, quietly broken. discern's machinery (the full gate on every change, standards that only tighten, freshness and coupling checks) is anti-regression machinery, so this positioning and the product agree.

The prelaunch tagline — "Code got cheap. Judgement didn't." — failed the direction on both halves: "cheap" diminishes the agents' work, and "judgement" casts the buyer as a critic. The in-repo strategy surfaces still speak the earlier "the agent said done, and it wasn't" register. Pre-launch, with no public surface live, is the free moment to fix identity ([ADR 0022](0022-rename-to-discern.md), [ADR 0009](0009-one-point-zero-drop-backward-compat.md)).

## Decision

The brand addresses **the owner** — the person whose name is on what ships — and treats their agents as a chosen, respected workforce.

- **The buyer is the powerful party**: bold enough to hand production to agents, proud enough to sign the result. Copy never casts them as a hall monitor, a babysitter, or someone who needs protecting from their own tools.
- **discern judges changes, never agents.** Failure language targets states of the work — "the change didn't hold", "this isn't the tree you reviewed" — never the character of the worker. Marketing surfaces ban fear vocabulary: slop, hallucination, "can you really trust it?".
- **The hero direction is "Your taste. Their speed."** The retired tagline stays retired.
- **Claims live at three altitudes.** Headlines carry identity words and hold aspiration license — a claim like "self-improving" may lead. Body copy carries mechanism words and must survive a hostile literal reading. The proof layer carries artifacts the reader can check for themselves. Display positions alone license the two-beat sentence shape; body prose keeps the documentation register's full discipline.
- **Time is a first-class pillar.** At brand altitude the story is positive — a project that only gets better. Loss framing appears only deep in the funnel, as contrast.
- **The maintainer brand file is the living source.** The voice-and-tone skill and its lint recompile from it once the direction stabilizes. Until then, the skill governs published docs pages, and the brand file governs marketing drafts. Where they conflict on a marketing surface, this record wins.

The explicit noes: no fear-selling, even where it would convert. The agent-written percentage never leads a surface — ownership leads, the statistic supports. Customer testimonials are exempt from every vocabulary rule; their words are theirs.

## Consequences

- The landing-page brief's fixed copy and the product-strategy thesis line no longer match this direction. Both carry supersession notes pointing at the brand file until the copy sweep rewrites them.
- The voice-and-tone skill's cautions (avoid "taste" in first-contact copy; zero epigram budget on marketing pages) conflict with the hero by design. The altitude rules in this record resolve the conflict when the skill recompiles.
- The gate can hold the brand: the vocabulary bans and altitude rules are checkable, and join the prose enforcement at that recompile.
- Selling a gate for agent work while respecting agents is a tension the writing must hold. The resolution is precision: the gate evaluates trees and diffs, not minds.

## Alternatives considered

- **Loss framing at brand level** ("stop the rot") — honest, but it casts the buyer as a victim and the product as insurance. Kept only as deep-funnel contrast.
- **The verifier identity** ("discern checks your AI's work") — verification is machinery, not the promise. The frame makes the buyer anxious and the agents suspects.
- **Keeping the retired tagline** — deficit framing on both halves. Its one strength, the two-beat cadence, survives through the headline license.
