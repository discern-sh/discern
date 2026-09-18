# Security policy

## Report a vulnerability

Report suspected vulnerabilities privately. Email [security@discern.sh](mailto:security@discern.sh) or use [GitHub's private vulnerability reporting](https://github.com/discern-sh/discern/security/advisories/new). Do not open a public issue.

Include:

- what the issue is and what an attacker could do;
- the steps needed to reproduce it, preferably with a minimal reproduction; and
- the discern version (`discern --version`) and your operating system and architecture.

Do not send credentials, private keys, personal data, or unrelated confidential material. If a proof needs sensitive data, describe what is needed before sharing it.

We will acknowledge your report, investigate it, and coordinate disclosure with you. We will credit you unless you prefer to remain anonymous.

## What is in scope

discern is a local command-line tool. It runs the commands configured in `discern.toml`, in the same trust class as a `Makefile` or an npm `scripts` block. It makes no network requests and sends no telemetry.

A report is in scope if discern can write outside its documented footprint, execute a command the user did not configure, or mishandle a co-owned file in a way that damages user content. Reports about the official installer, release artifacts, repository automation, or `discern.sh` are also in scope when the issue could compromise users or redirect their security reports.

A project that configures discern to run a dangerous command is behaving as configured. Report vulnerabilities in third-party commands or services to their maintainers unless discern causes or worsens the issue.

## Supported versions

Security fixes target the latest released version. If you use an older release, rerun the installer and confirm that the issue still reproduces before reporting it.
