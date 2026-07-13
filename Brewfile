# ---------------------------------------------------------------------------
#
# *** discern — project Brewfile ***
#
# Homebrew tooling required to develop and maintain discern *itself*.
# These are only required by maintainers contributing to the project.
#
# Usage (from the repo root):
#   brew bundle check      # sanity-check the toolchain is present
#   brew bundle install    # install anything missing
#
# `codesign` is also needed to cut the macOS release binaries, but this
# ships with the Xcode Command Line Tools - already required by Homebrew - so
# assumed present already.
#
# ---------------------------------------------------------------------------

# Deno: drives the whole toolchain.
brew "deno"

# Vale: lints the documentation.
brew "vale"

# git: unsurprisingly, a formal requirement of this project.
brew "git"

# gh: GitHub CLI is recommended, but not required.
# brew "gh"

# node: optional - only for `deno task inspect-mcp`, which runs the MCP Inspector
# (a Node tool) via npx to debug discern's MCP server. Not needed for the gate,
# build, or tests; install it only if you want the Inspector. See
# project/map/80-development/for-humans.md.
# brew "node"
