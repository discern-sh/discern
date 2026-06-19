# shellcheck shell=sh
# capabilities.sh — the known capability vocabulary and the gate's stage machinery.
#
# A CAPABILITY is one of a small, CLOSED set of things a project can do. The
# author declares them flat in [capabilities] (a name mapped to a command, or an
# array of commands); the engine derives WHEN each runs — its STAGE — from the
# capability name. This is the one place the vocabulary and the name->stage map
# live, so the gate (finish/tidy/test) and doctor cannot drift. Mirrors
# KNOWN_CAPABILITIES in src/lib/config.ts (the installer's copy of the same map).
#
# The four STAGES are the engine's internal scheduling buckets — fix runs first
# and serially (mutating), build next, then check and test together (read-only).
# A [checks.<name>] declares its stage explicitly; a capability's is derived here.

# Map a known capability name to its stage. Prints the stage; returns non-zero for
# a name outside the vocabulary (so callers can reject it).
#   stage=$(cap_stage lint)   # -> check
cap_stage() {
    case "$1" in
        format)         printf 'fix' ;;
        build)          printf 'build' ;;
        lint|typecheck) printf 'check' ;;
        test)           printf 'test' ;;
        *)              return 1 ;;
    esac
}

# The known capability vocabulary, space-delimited with surrounding spaces for a
# clean substring membership test. Also the order doctor walks its readiness
# checklist. Keep in step with cap_stage above and KNOWN_CAPABILITIES in src/.
ICCULUS_CAPABILITIES=" format build lint typecheck test "

# True (exit 0) when $1 is a known capability name.
#   cap_is_known "$cap" || warn "...not a capability..."
cap_is_known() {
    case "$ICCULUS_CAPABILITIES" in
        *" $1 "*) [ -n "$1" ] ;;   # reject the empty string (it matches the gaps)
        *) return 1 ;;
    esac
}

# The gate stages, space-delimited with surrounding spaces (membership test), and
# the canonical order the gate and the --json report iterate them in. A
# [checks.<name>].stage must be one of these.
ICCULUS_STAGES=" fix build check test "
# Consumed cross-file (finish iterates it to order the gate stages and the --json
# report); shellcheck sees only this file, so SC2034 here is spurious.
# shellcheck disable=SC2034
ICCULUS_STAGE_ORDER="fix build check test"

# True (exit 0) when $1 is a valid [checks.<name>].stage.
#   stage_is_valid "$(config_get checks.x.stage)" || add fail ...
stage_is_valid() {
    case "$ICCULUS_STAGES" in
        *" $1 "*) [ -n "$1" ] ;;
        *) return 1 ;;
    esac
}

# A human-readable list of the valid stages, for fix-up hints.
#   "fix, build, check, test"
stage_list() {
    printf '%s' "$ICCULUS_STAGES" | awk '{
        out = ""
        for (i = 1; i <= NF; i++) { out = (i == 1 ? $i : out ", " $i) }
        printf "%s", out
    }'
}

# A human-readable list of the known capabilities, for fix-up hints.
#   "format, build, lint, typecheck, test"
capability_list() {
    printf '%s' "$ICCULUS_CAPABILITIES" | awk '{
        out = ""
        for (i = 1; i <= NF; i++) { out = (i == 1 ? $i : out ", " $i) }
        printf "%s", out
    }'
}
