## Skills

icculus makes **skills** — focused, reusable task playbooks — discoverable to the
agent. The effective set is the bundled built-ins shipped in the binary plus the
project's **authored skills** under `[skills].dir` (default `./skills`), where an
authored skill **overrides a bundled one of the same name**.

icculus materializes the effective set into `.claude/skills/` (gitignored): bundled
skills are copied in, authored skills are symlinked so your edits are live. You
never edit `.claude/skills/` by hand.

- **`icculus skills list`** — show the effective set and which authored skills
  override which built-ins.
- **`icculus skills eject <name>`** — copy a bundled built-in into `[skills].dir`
  so you can customize it; the ejected copy then wins by name.

To add a skill, create a directory with a `SKILL.md` under `[skills].dir`. To
customize a built-in, eject it first.
