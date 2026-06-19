# shellcheck shell=sh
# jobs.sh — a tiny, dependency-free POSIX job runner (no external
# 'concurrently'-style tool needed). It runs labelled commands — concurrently
# (run_parallel) or one at a time (run_serial) — captures each one's combined
# output, prints them in stable order under a banner, and returns non-zero if any
# failed. The gate runs each capability/check as its own labelled job, reported
# per-job (the fix stage uses run_serial; the rest run_parallel).
#
# Output is buffered-then-grouped rather than live-interleaved: a quality gate
# wants legible, non-tangled output more than it wants live progress, and this
# keeps the implementation portable. Live streaming is a possible enhancement.
#
# Commands are run with `eval` on purpose — they are operator-supplied command
# strings from .icculus/config.toml, and running them verbatim is the whole point.
#
# STRUCTURED SIDE CHANNEL. When ICCULUS_JOBS_RESULTS names a file, each job's
# result is appended as a tab-separated line: "<label>\t<code>\t<seconds>". This
# is how `finish --json` (ADR 0004) collects per-job / per-scope-gate results.
# With the variable unset (every other caller), behaviour is unchanged.
#
# OPT-IN ERGONOMICS (ADR 0006), both default-off so the default is unchanged:
#   ICCULUS_GATE_STREAM=1     stream each job's output live, line-prefixed
#                             `── <label> │ …`, instead of buffering it.
#   ICCULUS_GATE_FAIL_FAST=1  poll the jobs and, on the first failure, SIGTERM the
#                             still-running siblings (best effort — a command's own
#                             grandchildren may briefly linger).
#
# Usage:
#   run_parallel "label1" "cmd1" "label2" "cmd2" ...
# Returns 0 only if every command exited 0.

# Prefix each input line with the job label and flush per line, so concurrent
# streamed jobs stay attributable and appear live.
_rp_prefix() {
    awk -v label="$1" '{ print "── " label " │ " $0; fflush() }'
}

# Run one job: capture its true exit code (in stream mode, before the prefix pipe)
# and its wall-clock duration. Streams or buffers per ICCULUS_GATE_STREAM.
#
# The command runs inside a nested `( … )` so a command that calls `exit` exits only
# that inner subshell — the code file is still written (the exit code is the
# inner subshell's). Without this, `eval "exit N"` would skip the code write,
# which the fail-fast poll reads as "still running" (an infinite loop) and the
# wait-all path would mis-default to a failure even for `exit 0`.
_rp_run_job() {
    _rj_n=$1
    _rj_label=$2
    _rj_cmd=$3
    _rj_start=$(date +%s 2>/dev/null || printf '0')
    if [ -n "${ICCULUS_GATE_STREAM:-}" ]; then
        { (eval "$_rj_cmd"); printf '%s' "$?" > "$_rp_tmp/$_rj_n.code"; } 2>&1 |
            _rp_prefix "$_rj_label"
    else
        (eval "$_rj_cmd") > "$_rp_tmp/$_rj_n.out" 2>&1
        printf '%s' "$?" > "$_rp_tmp/$_rj_n.code"
    fi
    _rj_end=$(date +%s 2>/dev/null || printf '0')
    printf '%s' "$((_rj_end - _rj_start))" > "$_rp_tmp/$_rj_n.dur"
}

run_parallel() {
    _rp_tmp=$(mktemp -d "${TMPDIR:-/tmp}/icculus-jobs.XXXXXX") || return 1
    _rp_n=0

    while [ "$#" -ge 2 ]; do
        _rp_label=$1
        _rp_cmd=$2
        shift 2
        _rp_n=$((_rp_n + 1))
        [ -n "$_rp_cmd" ] || _rp_cmd=":"
        printf '%s' "$_rp_label" > "$_rp_tmp/$_rp_n.label"
        _rp_run_job "$_rp_n" "$_rp_label" "$_rp_cmd" &
        printf '%s' "$!" > "$_rp_tmp/$_rp_n.pid"
    done

    if [ -n "${ICCULUS_GATE_FAIL_FAST:-}" ]; then
        # Poll the result files (1s granularity, portable sleep). On the first
        # non-zero exit, SIGTERM the still-running siblings, then reap.
        while :; do
            _rp_running=0
            _rp_failed=0
            _rp_i=0
            while [ "$_rp_i" -lt "$_rp_n" ]; do
                _rp_i=$((_rp_i + 1))
                if [ -f "$_rp_tmp/$_rp_i.code" ]; then
                    _rp_c=$(cat "$_rp_tmp/$_rp_i.code" 2>/dev/null)
                    if [ -z "$_rp_c" ]; then
                        _rp_running=1   # file appearing but not yet written
                    elif [ "$_rp_c" != 0 ]; then
                        _rp_failed=1
                    fi
                else
                    _rp_running=1
                fi
            done
            if [ "$_rp_failed" -eq 1 ]; then
                _rp_i=0
                while [ "$_rp_i" -lt "$_rp_n" ]; do
                    _rp_i=$((_rp_i + 1))
                    [ -f "$_rp_tmp/$_rp_i.code" ] && continue   # already finished
                    _rp_kp=$(cat "$_rp_tmp/$_rp_i.pid" 2>/dev/null)
                    [ -n "$_rp_kp" ] && kill "$_rp_kp" 2>/dev/null
                done
                break
            fi
            [ "$_rp_running" -eq 0 ] && break
            sleep 1
        done
        wait 2>/dev/null
    else
        wait
    fi

    _rp_fail=0
    _rp_i=0
    while [ "$_rp_i" -lt "$_rp_n" ]; do
        _rp_i=$((_rp_i + 1))
        _rp_label=$(cat "$_rp_tmp/$_rp_i.label" 2>/dev/null)
        _rp_code=$(cat "$_rp_tmp/$_rp_i.code" 2>/dev/null || printf '1')
        [ -n "$_rp_code" ] || _rp_code=1   # killed before writing its code
        _rp_dur=$(cat "$_rp_tmp/$_rp_i.dur" 2>/dev/null || printf '0')
        # Optional structured side channel for machine-readable consumers.
        if [ -n "${ICCULUS_JOBS_RESULTS:-}" ]; then
            printf '%s\t%s\t%s\n' "$_rp_label" "$_rp_code" "$_rp_dur" >> "$ICCULUS_JOBS_RESULTS"
        fi
        if [ "$_rp_code" -eq 0 ] 2>/dev/null; then
            printf '%s── %s ─%s %sok%s\n' "$C_DIM" "$_rp_label" "$C_RESET" "$C_GREEN" "$C_RESET"
        else
            printf '%s── %s ─%s %sFAILED (exit %s)%s\n' "$C_DIM" "$_rp_label" "$C_RESET" "$C_RED" "$_rp_code" "$C_RESET"
            _rp_fail=1
        fi
        # Buffered mode dumps the captured output here; stream mode already showed it.
        [ -n "${ICCULUS_GATE_STREAM:-}" ] || cat "$_rp_tmp/$_rp_i.out" 2>/dev/null
    done

    rm -rf "$_rp_tmp"
    return "$_rp_fail"
}

# Run labelled commands ONE AT A TIME, in order, stopping at the first failure.
# The mutating fix stage uses this: its jobs are ordered (a later fixer may
# depend on an earlier one's edits) and must not run concurrently. Each job is
# recorded to the side channel and its output grouped (or streamed) exactly as
# run_parallel does. Returns 0 only if every command run exited 0.
#   run_serial "fix:format" "$fmt_cmd" "fix:codemod" "$codemod_cmd"
run_serial() {
    _rp_tmp=$(mktemp -d "${TMPDIR:-/tmp}/icculus-jobs.XXXXXX") || return 1
    _rs_fail=0
    _rs_n=0
    while [ "$#" -ge 2 ]; do
        _rs_label=$1
        _rs_cmd=$2
        shift 2
        _rs_n=$((_rs_n + 1))
        [ -n "$_rs_cmd" ] || _rs_cmd=":"
        # Foreground (no `&`): _rp_run_job completes and writes its files here.
        _rp_run_job "$_rs_n" "$_rs_label" "$_rs_cmd"
        _rs_code=$(cat "$_rp_tmp/$_rs_n.code" 2>/dev/null || printf '1')
        [ -n "$_rs_code" ] || _rs_code=1
        _rs_dur=$(cat "$_rp_tmp/$_rs_n.dur" 2>/dev/null || printf '0')
        if [ -n "${ICCULUS_JOBS_RESULTS:-}" ]; then
            printf '%s\t%s\t%s\n' "$_rs_label" "$_rs_code" "$_rs_dur" >> "$ICCULUS_JOBS_RESULTS"
        fi
        if [ "$_rs_code" -eq 0 ] 2>/dev/null; then
            printf '%s── %s ─%s %sok%s\n' "$C_DIM" "$_rs_label" "$C_RESET" "$C_GREEN" "$C_RESET"
        else
            printf '%s── %s ─%s %sFAILED (exit %s)%s\n' "$C_DIM" "$_rs_label" "$C_RESET" "$C_RED" "$_rs_code" "$C_RESET"
            _rs_fail=1
        fi
        # Buffered mode dumps the captured output here; stream mode already showed it.
        [ -n "${ICCULUS_GATE_STREAM:-}" ] || cat "$_rp_tmp/$_rs_n.out" 2>/dev/null
        # Ordered, mutating: a failed fixer means a later one would act on a bad
        # tree, so stop here rather than compounding the damage.
        [ "$_rs_fail" -eq 1 ] && break
    done
    rm -rf "$_rp_tmp"
    return "$_rs_fail"
}

# Emit one job per line for a given stage, TAB-separated as
# "<label>\t<command>\t<kind>", from BOTH sources, skipping no-ops:
#
#   capabilities  every [capabilities] flat key whose derived stage matches. The
#                 value is read with config_array, which yields one line for a
#                 scalar and N for an array — so an array-valued capability
#                 expands to one job per element. The first element is labelled
#                 with the bare capability name; later ones get a `#N` suffix
#                 (lint, lint#2) so labels stay unique. kind = "capability".
#   checks        every [checks.<name>] whose `stage` equals the stage. The `run`
#                 is a scalar (commas allowed). kind = "check".
#
# Labels carry no spaces (capability/check names are bare identifiers); commands
# may, which is why this is TAB-separated and never space-split. Used by `finish`
# (job list + the --json report) and, via cmds_in_stage, by tidy/test.
#   jobs_in_stage check
jobs_in_stage() {
    _jis_stage=$1

    # (a) capabilities — flat keys of [capabilities], placed by cap_stage.
    for _jis_cap in $(config_keys capabilities); do
        cap_is_known "$_jis_cap" || continue          # unknown key: skip (doctor errors on it)
        [ "$(cap_stage "$_jis_cap")" = "$_jis_stage" ] || continue
        _jis_i=0
        # config_array yields ONE line for a scalar, N for an array — uniform.
        config_array "capabilities.$_jis_cap" | while IFS= read -r _jis_cmd; do
            [ -n "$_jis_cmd" ] || continue
            [ "$_jis_cmd" = ":" ] && continue
            _jis_i=$((_jis_i + 1))
            if [ "$_jis_i" -eq 1 ]; then
                _jis_lbl=$_jis_cap
            else
                _jis_lbl="$_jis_cap#$_jis_i"
            fi
            printf '%s\t%s\tcapability\n' "$_jis_lbl" "$_jis_cmd"
        done
    done

    # (b) checks — explicit stage; run is a scalar.
    for _jis_chk in $(config_subsections checks); do
        [ "$(config_get "checks.$_jis_chk.stage")" = "$_jis_stage" ] || continue
        _jis_run=$(config_get "checks.$_jis_chk.run" "")
        [ -n "$_jis_run" ] || continue
        [ "$_jis_run" = ":" ] && continue
        printf '%s\t%s\tcheck\n' "$_jis_chk" "$_jis_run"
    done
}

# Join the commands of every job in a stage with ` && `, in jobs_in_stage order.
# Prints `:` when the stage has no real command, so a track is never empty. Used
# by the tidy/test convenience recipes and by no-op detection. Reads via a here-
# doc (not a pipe) so the accumulator survives the loop in dash and bash.
#   cmd=$(cmds_in_stage fix)
cmds_in_stage() {
    _cis_joined=""
    while IFS="$(printf '\t')" read -r _cis_lbl _cis_cmd _cis_kind; do
        [ -n "$_cis_cmd" ] || continue
        if [ -z "$_cis_joined" ]; then
            _cis_joined="$_cis_cmd"
        else
            _cis_joined="$_cis_joined && $_cis_cmd"
        fi
    done <<EOF
$(jobs_in_stage "$1")
EOF
    [ -n "$_cis_joined" ] || _cis_joined=":"
    printf '%s' "$_cis_joined"
}
