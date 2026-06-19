# shellcheck shell=sh
# ratchets.sh — the named-metric ratchet engine (see ADR 0003).
#
# A ratchet is a number you only ever want to improve. Each enforces two halves:
#
#   NEVER LOOSENED vs main   the configured limit on this branch is compared to
#                            its value on main. A floor (direction=up) may only
#                            rise; a ceiling (direction=down) may only fall.
#   MEASURED vs limit        run the command that emits the metric, read it, and
#                            for up fail when measured < limit; for down fail when
#                            measured > limit.
#
# Every ratchet is a [ratchets.<name>] table — there is no built-in or special
# instance. Coverage is just the conventional name for a ratchet that measures
# line coverage; the engine treats it like any other.
#
#   metric     the metric name the run emits           (default: the ratchet name)
#   direction  up | down                               (default: up)
#   limit      the floor (up) or ceiling (down)        (required)
#   run        the command whose output emits the metric (required)
#
# METRIC EMISSION CONVENTION. The run reports a metric by printing a line:
#   ICCULUS_METRIC <name> <number>
# The LAST such line for a metric wins. This is the only way the run reports a
# number — there is no output-scraping fallback.
#
# The ratchet's `run` is run on demand by `agent ratchets`, never by the gate
# (`agent finish`) — measurement is slow, so it is kept out of the gate.
#
# Sourced (never executed) by the `ratchets` recipe, after bootstrap.sh, so the
# config/output helpers and ICCULUS_* paths are available.

# True (exit 0) when $1 is a non-negative decimal number (digits, one optional
# dot). Ratchet metrics (percentages, counts, sizes) are non-negative; this gives
# a clear error instead of awk silently treating garbage as 0.
_ratchet_is_number() {
    case "$1" in
        "" | *[!0-9.]* | *.*.* | .) return 1 ;;
        *) return 0 ;;
    esac
}

# Print a ratchet failure to stderr (red cross), like die() but WITHOUT exiting,
# so the `ratchets` recipe can run every ratchet and aggregate the result.
_ratchet_err() {
    printf '%s✗%s %s\n' "${C_RED}" "${C_RESET}" "$1" >&2
}

# Print the value of a metric from a captured output file: the last
# `ICCULUS_METRIC <name> <value>` line. Prints nothing when absent.
#   value=$(ratchet_extract_metric coverage "$out_file")
ratchet_extract_metric() {
    awk -v name="$1" '
        {
            for (i = 1; i < NF; i++) {
                if ($i == "ICCULUS_METRIC" && $(i + 1) == name && (i + 2) <= NF) {
                    v = $(i + 2)
                }
            }
        }
        END { if (v != "") print v }
    ' "$2"
}

# Read a scalar config key from main's .icculus/config.toml (the never-loosen baseline),
# using the SAME parser the harness uses. Prints the value, or returns non-zero
# when git or main's file is unavailable (e.g. a fresh repo with no main yet).
ratchet_main_value() {
    _rmv_key=$1
    _rmv_git=${GIT_BIN:-git}
    _rmv_main_branch=${MAIN_BRANCH:-main}
    command -v "$_rmv_git" >/dev/null 2>&1 || return 1
    _rmv_toml=$("$_rmv_git" show "$_rmv_main_branch:.icculus/config.toml" 2>/dev/null) || return 1
    [ -n "$_rmv_toml" ] || return 1
    _rmv_tmp=$(mktemp "${TMPDIR:-/tmp}/icculus-main-toml.XXXXXX") || return 1
    printf '%s\n' "$_rmv_toml" > "$_rmv_tmp"
    _rmv_val=$(awk -v op=scalar -v q="$_rmv_key" -f "$ICCULUS_LIB/toml.awk" "$_rmv_tmp")
    rm -f "$_rmv_tmp"
    [ -n "$_rmv_val" ] || return 1
    printf '%s' "$_rmv_val"
}

# Run one ratchet by name (a [ratchets.<name>] key). Prints its own pass/fail
# lines and RETURNS 0 (held) or 1 (failed/misconfigured) — never exits, so
# callers aggregate.
ratchet_check() {
    _rc_name=$1

    # --- resolve parameters ------------------------------------------------
    _rc_limit_key="ratchets.$_rc_name.limit"
    _rc_direction=$(config_get "ratchets.$_rc_name.direction" "up")
    _rc_metric=$(config_get "ratchets.$_rc_name.metric" "$_rc_name")
    _rc_cmd=$(config_get "ratchets.$_rc_name.run" "")
    [ -n "$_rc_cmd" ] || _rc_cmd=":"

    case "$_rc_direction" in
        up | down) ;;
        *)
            _ratchet_err "ratchet '$_rc_name': direction must be \"up\" or \"down\" (got \"$_rc_direction\")."
            return 1
            ;;
    esac

    if ! config_has "$_rc_limit_key"; then
        _ratchet_err "ratchet '$_rc_name': no limit (set limit = <number> under [ratchets.$_rc_name])."
        return 1
    fi
    _rc_limit=$(config_get "$_rc_limit_key" "")
    if ! _ratchet_is_number "$_rc_limit"; then
        _ratchet_err "ratchet '$_rc_name': limit ($_rc_limit_key) is not a number: '$_rc_limit'."
        return 1
    fi

    # --- never loosened vs main -------------------------------------------
    _rc_main=$(ratchet_main_value "$_rc_limit_key" 2>/dev/null || printf '')
    if [ -n "$_rc_main" ] && _ratchet_is_number "$_rc_main"; then
        if [ "$_rc_direction" = "up" ]; then
            if awk "BEGIN { exit !($_rc_limit < $_rc_main) }" 2>/dev/null; then
                _ratchet_err "ratchet '$_rc_name': floor ${_rc_main} -> ${_rc_limit} vs ${MAIN_BRANCH:-main} — the floor only rises. Raise the metric, don't loosen the gate."
                return 1
            fi
        else
            if awk "BEGIN { exit !($_rc_limit > $_rc_main) }" 2>/dev/null; then
                _ratchet_err "ratchet '$_rc_name': ceiling ${_rc_main} -> ${_rc_limit} vs ${MAIN_BRANCH:-main} — the ceiling only falls. Lower the metric, don't loosen the gate."
                return 1
            fi
        fi
    fi

    # --- measure -----------------------------------------------------------
    if [ "$_rc_cmd" = ":" ]; then
        _ratchet_err "ratchet '$_rc_name' has no run command (set run = \"<command>\" under [ratchets.$_rc_name])."
        return 1
    fi

    heading "Measuring ${_rc_metric} (${_rc_direction}, limit ${_rc_limit})..."
    _rc_out=$(mktemp "${TMPDIR:-/tmp}/icculus-ratchet.XXXXXX") || {
        _ratchet_err "ratchet '$_rc_name': mktemp failed."
        return 1
    }
    # Run the command, teeing so the operator sees output live AND we can read it.
    if ! eval "$_rc_cmd" 2>&1 | tee "$_rc_out"; then
        rm -f "$_rc_out"
        _ratchet_err "ratchet '$_rc_name': the measurement command failed."
        return 1
    fi

    _rc_measured=$(ratchet_extract_metric "$_rc_metric" "$_rc_out")
    rm -f "$_rc_out"

    if [ -z "$_rc_measured" ]; then
        _ratchet_err "ratchet '$_rc_name': could not read metric '${_rc_metric}'. Emit a line: ICCULUS_METRIC ${_rc_metric} <number>."
        return 1
    fi
    if ! _ratchet_is_number "$_rc_measured"; then
        _ratchet_err "ratchet '$_rc_name': metric '${_rc_metric}' value is not a number: '${_rc_measured}'."
        return 1
    fi

    # --- compare measured vs limit ----------------------------------------
    if [ "$_rc_direction" = "up" ]; then
        if awk "BEGIN { exit !($_rc_measured + 1e-9 < $_rc_limit) }" 2>/dev/null; then
            _ratchet_err "ratchet '$_rc_name': ${_rc_metric} ${_rc_measured} is below the floor ${_rc_limit}. Improve it; never lower the floor."
            return 1
        fi
        ok "ratchet '$_rc_name': ${_rc_metric} ${_rc_measured} meets the floor ${_rc_limit}."
    else
        if awk "BEGIN { exit !($_rc_measured - 1e-9 > $_rc_limit) }" 2>/dev/null; then
            _ratchet_err "ratchet '$_rc_name': ${_rc_metric} ${_rc_measured} exceeds the ceiling ${_rc_limit}. Bring it down; never raise the ceiling."
            return 1
        fi
        ok "ratchet '$_rc_name': ${_rc_metric} ${_rc_measured} within the ceiling ${_rc_limit}."
    fi
    return 0
}
