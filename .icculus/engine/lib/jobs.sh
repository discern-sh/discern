# shellcheck shell=sh
# jobs.sh — a tiny, dependency-free POSIX job runner (no external
# 'concurrently'-style tool needed). It runs labelled commands — concurrently
# (run_parallel) or one at a time (run_serial) — captures each one's combined
# output, prints them in stable order under a banner, and returns non-zero if any
# failed. The gate runs each SLOT as its own labelled job, so a result is
# reported per-slot (the fix phase uses run_serial; the rest run_parallel).
#
# Output is buffered-then-grouped rather than live-interleaved: a quality gate
# wants legible, non-tangled output more than it wants live progress, and this
# keeps the implementation portable. Live streaming is a possible enhancement.
#
# Commands are run with `eval` on purpose — they are operator-supplied slot
# strings from icculus.toml, and running them verbatim is the whole point.
#
# STRUCTURED SIDE CHANNEL. When ICCULUS_JOBS_RESULTS names a file, each job's
# result is appended as a tab-separated line: "<label>\t<code>\t<seconds>". This
# is how `finish --json` (ADR 0004) collects per-phase / per-side-gate results.
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
# The command runs inside a nested `( … )` so a slot that calls `exit` exits only
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
# The mutating fix phase uses this: its slots are ordered (a later fixer may
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

# Join the `run` commands of every slot in a given phase with ` && `, skipping
# no-ops. Prints `:` when the phase has no real commands, so a track is never
# empty. Used by the tidy/test convenience recipes and by no-op detection.
#   cmd=$(slots_for_phase fix)
slots_for_phase() {
    _sp_phase=$1
    _sp_joined=""
    for _sp_slot in $(config_subsections slots); do
        [ "$(config_get "slots.$_sp_slot.phase")" = "$_sp_phase" ] || continue
        config_slot_is_noop "slots.$_sp_slot.run" && continue
        _sp_run=$(config_get "slots.$_sp_slot.run")
        if [ -z "$_sp_joined" ]; then
            _sp_joined="$_sp_run"
        else
            _sp_joined="$_sp_joined && $_sp_run"
        fi
    done
    [ -n "$_sp_joined" ] || _sp_joined=":"
    printf '%s' "$_sp_joined"
}

# Print the NON-NO-OP slot names in a phase, one per line, in declaration order.
# Slot names are bare identifiers (no spaces), so a caller can iterate them with
# `for` and read each `run` command with config_get — the safe way to build a
# per-slot job list whose commands may contain spaces. A measurement slot (no
# phase) matches no gate phase, so it never appears here.
#   for slot in $(slots_in_phase check); do ...; done
slots_in_phase() {
    _sip_phase=$1
    for _sip_slot in $(config_subsections slots); do
        [ "$(config_get "slots.$_sip_slot.phase")" = "$_sip_phase" ] || continue
        config_slot_is_noop "slots.$_sip_slot.run" && continue
        printf '%s\n' "$_sip_slot"
    done
}
