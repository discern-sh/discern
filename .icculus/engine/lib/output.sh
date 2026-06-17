# output.sh — shared, colour-aware terminal output helpers.
#
# Sourced by every engine recipe (via bootstrap.sh). Colour is enabled only on
# a TTY and when NO_COLOR is unset, so piped/CI output stays clean. The helpers
# are info/ok/warn/die plus a heading for phase banners.

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    C_RESET=$(printf '\033[0m')
    C_BOLD=$(printf '\033[1m')
    C_DIM=$(printf '\033[2m')
    C_RED=$(printf '\033[31m')
    C_GREEN=$(printf '\033[32m')
    C_YELLOW=$(printf '\033[33m')
    C_CYAN=$(printf '\033[36m')
else
    C_RESET=""; C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""
fi

# Informational step (cyan arrow).
info() { printf '%s→%s %s\n' "$C_CYAN" "$C_RESET" "$1"; }

# Success (green check).
ok() { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"; }

# Warning to stderr (yellow bang); non-fatal.
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$1" >&2; }

# Fatal error to stderr (red cross); exits 1.
die() { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$1" >&2; exit 1; }

# Phase banner, e.g. before a parallel track runs.
heading() { printf '\n%s%s%s\n' "$C_BOLD" "$1" "$C_RESET"; }
