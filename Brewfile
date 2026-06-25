# ---------------------------------------------------------------------------
#
# *** discern — project Brewfile ***
#
# Homebrew tooling required to develop and maintain discern *itself*. These are
# NOT runtime dependencies of the shipped product: the compiled `discern`
# binary is self-contained (templates bundled in, no Deno, no network), so end
# users need none of this — only contributors and maintainers do.
#
# Usage (from the repo root):
#   brew bundle check      # sanity-check the toolchain is present
#   brew bundle install    # install anything missing
#
# Note: `codesign` is also needed to cut the macOS release binaries
# (scripts/build.ts verifies the ad-hoc signature). It is not a brew formula —
# it ships with the Xcode Command Line Tools (`xcode-select --install`), which
# Homebrew already requires, so it is assumed present rather than listed here.
#
# ---------------------------------------------------------------------------

#
# REQUIRED
#

# The whole toolchain. Every `deno task` drives the gate, build, compile,
# test, lint, and fmt — e.g. `deno task dev finish`, `deno task build`,
# `deno task test`. Nothing in this repo builds without it.
brew "deno"

# discern's isolated-worktree workflow shells out to git constantly: worktree
# add/list/prune, scope diffing for the gate, and the ratchet's "never loosen
# vs main" base comparison. A modern git is assumed. (Also provided by the
# Xcode Command Line Tools — this line is belt-and-braces for a fresh machine.)
brew "git"

# That is the whole required set. Note discern does NOT need jq: the Claude Code
# worktree hooks read their JSON payload in the binary itself (`discern
# worktree:create` / `:remove`), so there is no shell-tool dependency (ADR 0039).

#
# RECOMMENDED (not required by the build or the engine)
#

# GitHub CLI. Not invoked anywhere in the engine, scripts, or CI, but the
# contribution loop — opening PRs against the upstream repo and pushing v*
# release tags — is far smoother with it. Uncomment if you contribute upstream.
# brew "gh"
