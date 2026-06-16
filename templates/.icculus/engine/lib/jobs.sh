# jobs.sh — a tiny, dependency-free POSIX parallel runner (no external
# 'concurrently'-style tool needed). It runs labelled commands concurrently,
# captures each one's combined output, then prints them in stable order under a
# banner and returns non-zero if any failed.
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
# Usage:
#   run_parallel "label1" "cmd1" "label2" "cmd2" ...
# Returns 0 only if every command exited 0.

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
        (
            _rp_start=$(date +%s 2>/dev/null || printf '0')
            eval "$_rp_cmd" > "$_rp_tmp/$_rp_n.out" 2>&1
            _rp_jc=$?   # capture eval's status BEFORE running anything else
            _rp_end=$(date +%s 2>/dev/null || printf '0')
            printf '%s' "$_rp_jc" > "$_rp_tmp/$_rp_n.code"
            printf '%s' "$((_rp_end - _rp_start))" > "$_rp_tmp/$_rp_n.dur"
        ) &
    done

    wait

    _rp_fail=0
    _rp_i=0
    while [ "$_rp_i" -lt "$_rp_n" ]; do
        _rp_i=$((_rp_i + 1))
        _rp_label=$(cat "$_rp_tmp/$_rp_i.label" 2>/dev/null)
        _rp_code=$(cat "$_rp_tmp/$_rp_i.code" 2>/dev/null || printf '1')
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
        cat "$_rp_tmp/$_rp_i.out" 2>/dev/null
    done

    rm -rf "$_rp_tmp"
    return "$_rp_fail"
}

# Join the `run` commands of every slot in a given phase with ` && `, skipping
# no-ops. Prints `:` when the phase has no real commands, so a track is never
# empty. Used by the finish/tidy recipes.
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
