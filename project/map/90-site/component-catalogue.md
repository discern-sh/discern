# Design-system component roles

The catalogue at `/styleguide/` is generated from each component's metadata,
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
