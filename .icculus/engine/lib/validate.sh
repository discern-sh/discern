# shellcheck shell=sh
# validate.sh — small, pure predicates for sanity-checking .icculus/config.toml values.
#
# Sourced by `doctor` (and available to any recipe via bootstrap.sh if needed).
# These are deliberately content-only: they take a string and answer a question,
# touching no files and reading no config, so they are trivial to reason about
# and to unit-test. File- and config-shaped checks live in the recipe that needs
# them; this file holds just the reusable value-level rules.

# The capability vocabulary and the gate's stages live in capabilities.sh (the
# one place the name->stage map is named), not here. This file holds only the
# content-level value predicates below.

# True (exit 0) when $1 matches the project-slug shape the kit enforces:
# lowercase letters/digits/dashes, starting with a letter or digit. Kept in sync
# with isValidSlug() in src/lib/config.ts (the wizard's rule).
validate_is_slug() {
    case "$1" in
        "" ) return 1 ;;
        *[!a-z0-9-]* ) return 1 ;;     # any char outside the allowed set
        [!a-z0-9]* ) return 1 ;;       # must start with a letter or digit
        *) return 0 ;;
    esac
}

# Escape a string for embedding inside a JSON double-quoted value: backslashes
# and quotes are escaped, and raw control characters (tab/newline/CR) are turned
# into spaces so the one-line JSON the recipes emit stays valid. Prints the
# escaped form on stdout.
validate_json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/'"$(printf '\t')"'/ /g; s/\r/ /g'
}
