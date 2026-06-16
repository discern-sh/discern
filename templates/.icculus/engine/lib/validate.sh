# validate.sh — small, pure predicates for sanity-checking icculus.toml values.
#
# Sourced by `doctor` (and available to any recipe via bootstrap.sh if needed).
# These are deliberately content-only: they take a string and answer a question,
# touching no files and reading no config, so they are trivial to reason about
# and to unit-test. File- and config-shaped checks live in the recipe that needs
# them; this file holds just the reusable value-level rules.

# The phases a slot may declare. This is the ONE place the engine names them, so
# the gate's phase order (finish/tidy) and doctor's validation cannot drift. A
# space-delimited list with surrounding spaces, for a clean substring test.
ICCULUS_PHASES=" fix build check test coverage "

# True (exit 0) when $1 is one of the known slot phases.
#   validate_is_phase "$(config_get slots.format.phase)" || warn ...
validate_is_phase() {
    case "$ICCULUS_PHASES" in
        *" $1 "*) [ -n "$1" ] ;;   # reject the empty string (it would substring-match the gaps)
        *) return 1 ;;
    esac
}

# A human-readable list of the valid phases, for fix-up hints.
#   "fix, build, check, test, coverage"
validate_phase_list() {
    # Trim the surrounding spaces and comma-join the words.
    printf '%s' "$ICCULUS_PHASES" | awk '{
        out = ""
        for (i = 1; i <= NF; i++) { out = (i == 1 ? $i : out ", " $i) }
        printf "%s", out
    }'
}

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
