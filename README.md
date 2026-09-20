# ◮ discern

discern installs a disciplined **engineering practice** into any software project.

- **You** decide what "quality" means for your project. discern encodes your taste and judgment into the project's configuration.
- **Your agent** operates discern day-to-day. discern helps them write better code, work safely in parallel, and continually improve the project's standards.
- **Your project** becomes a more reliable place for agents to work, with each change deterministically proven. discern gives you the confidence to ship high-quality changes faster than ever.

discern is designed for **people who ship serious software**:

- For **newer builders** who may only have built software through agents, discern is easy-to-use and requires no previous coding experience. It's mostly hands-off, as your agent configures discern and drives it day-to-day. When people start depending on your work, discern provides the engineering discipline so you can ship with confidence.
- For **serious engineers** who use agents to implement more than they can personally review, discern helps you stop feeling like the bottleneck, and scale your ambitions even further. discern empowers you to direct more work with less oversight, preserve your expertise across models and providers, and run complex workstreams in parallel.

discern was **created by a former CTO with over 15 years of experience** as an engineer and co-founder:

- Designed for **real-world use** in serious software products, discern runs completely offline, doesn't contain an AI model, and has zero dependencies besides `git`. There's no API key, subscription, or vendor lock-in.
- discern's **offline, self-contained binary** is signed and notarized, running on macOS, Linux, and Windows via WSL 2. Stack-agnostic, discern adapts to suit projects written in any programming language.
- **Battle-tested and hardened** _on itself_, since day one discern has 'dogfooded' its own practice. Every change to discern's own codebase has been built, validated, and proven under its own gate.

## Install and set up discern

Simply tell your coding agent:

> "Explain how [discern.sh](https://discern.sh) would improve our project, then set it up for me."

Your agent does the rest.

- **Setup is a one-time, high-leverage activity**. Use the strongest model you have available — every future agent will inherit the choices they make. discern is easy to reconfigure at any time, but a frontier model with extended thinking time will get your setup off to the strongest possible start.
- **Setup is isolated and reversible**. discern keeps all setup work contained to a one-off branch, using small incremental commits so you can see what's being done. discern never pushes remotely, and seeks your consent before finishing the setup process. You can uninstall discern at any time.

Prefer to put the binary in place yourself, or need a newer one later? One command installs it; then hand the project to your agent as above:

```sh
curl -fsSL https://discern.sh/install | sh
```

---

[discern.sh](https://discern.sh) · [Documentation](https://discern.sh/docs) · [For coding agents](https://discern.sh/llms.txt) · [License](LICENSE)
