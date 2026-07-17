# Security policy

## Reporting a vulnerability

Please report security vulnerabilities **privately**, not as a public issue.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability** (<https://github.com/jackwh/discern/security/advisories/new>). This opens a private advisory visible only to you and the maintainers.

Please include:

- a description of the issue and its impact;
- the steps to reproduce it (a minimal repro is ideal);
- the discern version (`discern --version`) and your OS/architecture.

You can expect an initial acknowledgement within a few days. Once a fix is available, we will coordinate disclosure and credit you unless you prefer to remain anonymous.

## What is in scope

discern is a local command-line tool that runs the commands you configure in `discern.toml` — the same trust class as a `Makefile` or an npm `scripts` block. It makes no network calls and ships no telemetry. In-scope reports include, for example: a way for discern to write outside its documented footprint, to execute a command a user did not configure, or to mishandle a file it co-owns in a way that damages user content. A project that configures discern to run a dangerous command is behaving as designed, not a vulnerability in discern.

## Supported versions

Fixes land on the latest released version. If you are on an older release, the first step is usually to update (re-run your installer) and confirm the issue still reproduces.
