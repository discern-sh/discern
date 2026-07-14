# Design-system component roles

The catalogue at `/style-guide/` is generated from each component's metadata,
implementation, styles, and examples. This page records the cross-component
visual roles that a page author should preserve.

## Control and annotation roles

Primary buttons use the palest blue accent surface with a two-pixel hard shadow;
their border and text retain enough contrast to keep the action explicit.
`Kicker` is deliberately mixed-role: its optional index uses the mono face,
while its label uses the Inter UI family and shared OpenType feature set.

## Framed output

`Window` is the neutral presentation frame for product UI and general content.
Its title uses the UI role. `Terminal` mirrors the same figure, title bar, and
body-style override, but its title and semantic `pre`/`code` body use the mono
role. Terminal output preserves whitespace, scrolls long lines, and keeps an
always-dark console palette in both site themes.

## Separation and depth

`Divider` is a restrained editorial rule. Its optional label uses UI type and a
small accent datum instead of a patterned band. In light mode, the sunken
surface is a pale, low-chroma paper neutral so inset regions read through depth
rather than a brown tint.

## Marketing page frame

`SiteHeader` and `SiteFooter` establish the top and bottom landmarks. The header
may carry a notice, navigation, actions, and sticky positioning. Its mobile
navigation remains present as a horizontally scrolling row. The footer groups
links under real headings inside a labelled navigation landmark.

`HeroBlock` supports split and centered openings with canvas, sunken, and accent
surfaces. Its heading level is explicit, and its content stays before its visual
in source order. `CtaBand` closes the story with centered or split action
layouts and a product-owned visual slot.

## Trust and audience

`LogoCloud` is a quiet trust or integration band. Text names remain readable
when a decorative mark is present. `AudienceGrid` gives each reader a headed
article, so one product can lead with different outcomes for different levels of
experience or responsibility.

## Product storytelling

`FeatureBento` provides an asymmetric twelve-column feature field. Items declare
their size and surface while their DOM order stays straightforward.
`SplitFeature` alternates narrative copy and evidence without reversing source
order. `ProcessSteps` renders a horizontal or vertical ordered journey; its
visual connectors are never the only account of sequence.

## Evidence and decision

`MetricsBand` pairs figures and labels in a description list. `ComparisonTable`
remains a real table on wide screens and becomes labelled cards on narrow
screens. `Testimonial` uses quotation and attribution semantics, while
`CaseStudy` combines an article with visual and numerical evidence.

`FaqBlock` uses native `details` and `summary`, so disclosure needs no client
runtime. Together with `CtaBand`, it handles the final landing-page move from
resolving uncertainty to offering a next action.

## Editorial page frame

`ArticleHeader` is the publication-scale opening: title, introductory summary,
byline, reading metadata, actions, and optional cover media. `ArticleLayout`
provides a primary article landmark between optional navigation and context
rails. The rails become ordinary flow content as the screen narrows rather than
squeezing the reading measure.

`TableOfContents` is labelled navigation with explicit current-location state.
`Prose` supplies long-form rhythm, readable measures, heading spacing, lists,
links, inline code, rules, and optional lead and drop-cap treatments without
inventing hierarchy for the author. The drop cap aligns with the first line and
does not add a separate semantic character.

## Editorial emphasis and evidence

`KeyPoints` is an ordered article brief. Its ordered ideas use a quieter surface
than the heading so the information hierarchy remains visible without changing
the document structure. `PullQuote` preserves quotation and attribution
semantics, while `Callout` exposes context, interpretation, cautions, and
successful outcomes as headed notes. None relies on visual colour or numbering
as its only account of meaning.

`CodeListing` keeps source as a horizontally scrolling code block with stable
line numbers and optional highlights. `DataFigure` owns the title, legend,
visual, caption, and source frame around a caller-provided accessible chart or
diagram. `Timeline` expresses chronology as an ordered list. `Footnotes`
provides stable note anchors and descriptive return links. `RelatedContent`
closes a reading experience with headed article recommendations rather than
generic link cards.
