# worktree.sh — shared helpers for the worktree lifecycle recipes.
#
# Sourced (never executed) by the worktree-* recipes after bootstrap.sh, so the
# output/config helpers and the ICCULUS_* paths are already available. It holds
# the three things more than one recipe needs:
#
#   1. main_repo_path        resolve the MAIN checkout from git worktree metadata
#   2. wt_expand_tokens      substitute the adapter-token convention into a
#                            command string before it is eval'd
#   3. wt_teardown           run the DB-drop + dev-server-unlink adapter commands
#                            (reused by worktree-exit and worktree-teardown)
#
# The adapter-token convention. Adapter command strings in [worktree.db] and
# [worktree.dev_server] are operator-supplied and run with `eval` (matching the
# slot-command convention in jobs.sh). Before eval-ing, these tokens are
# replaced with values derived from THIS worktree's identity:
#
#   {{db}}            worktree-name --db        database-name-safe identity
#   {{site}}          worktree-name --site      dev-server site/host name
#   {{port}}          worktree-name --port      deterministic per-worktree port
#   {{project_slug}}  config_get project.slug   the project slug
#   {{dir}}           the worktree root          absolute path of the checkout
#
# An empty adapter command is a clean no-op: nothing is expanded and nothing is
# run. The recipes guard on emptiness, so an unset seam never executes anything.

# Resolve the MAIN repository path: the first 'worktree' entry of
# `git worktree list --porcelain`. sed (not awk $2) so paths with spaces
# survive. Prints nothing and returns non-zero when not in a git repo.
main_repo_path() {
    _wt_git=${GIT_BIN:-git}
    command -v "$_wt_git" >/dev/null 2>&1 || return 1
    _wt_main=$("$_wt_git" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | head -1)
    [ -n "$_wt_main" ] || return 1
    [ -d "$_wt_main" ] || return 1
    (CDPATH= cd -- "$_wt_main" && pwd -P)
}

# Resolve a single adapter token to its value for the current worktree. Lazily
# shells out to worktree-name only for the identity tokens that need it, so an
# adapter that uses none of them costs no extra processes.
#   wt_token_value db
wt_token_value() {
    case "$1" in
        db)           "$ICCULUS_ENGINE/worktree-name" --db 2>/dev/null || printf '' ;;
        site)         "$ICCULUS_ENGINE/worktree-name" --site 2>/dev/null || printf '' ;;
        port)         "$ICCULUS_ENGINE/worktree-name" --port 2>/dev/null || printf '' ;;
        project_slug) config_get project.slug "" ;;
        dir)          printf '%s' "$ICCULUS_ROOT" ;;
        *)            printf '' ;;
    esac
}

# Replace every literal occurrence of $2 in $1 with $3, printing the result.
# Pure POSIX parameter expansion: no regex, no awk — so a replacement value
# containing any metacharacter is inserted verbatim. Guards against a token
# whose replacement itself contains the token (avoids an infinite loop).
wt_replace_all() {
    _wr_in=$1
    _wr_find=$2
    _wr_repl=$3
    _wr_out=""
    while :; do
        case "$_wr_in" in
            *"$_wr_find"*)
                _wr_out="$_wr_out${_wr_in%%"$_wr_find"*}$_wr_repl"
                _wr_in=${_wr_in#*"$_wr_find"}
                ;;
            *)
                _wr_out="$_wr_out$_wr_in"
                break
                ;;
        esac
    done
    printf '%s' "$_wr_out"
}

# Substitute every adapter token in a command string and print the result. Only
# resolves a token's value when that token actually appears, so a command that
# names no tokens triggers no worktree-name calls.
#   expanded=$(wt_expand_tokens "$raw_command")
wt_expand_tokens() {
    _wt_cmd=$1
    [ -n "$_wt_cmd" ] || { printf ''; return 0; }
    for _wt_tok in db site port project_slug dir; do
        case "$_wt_cmd" in
            *"{{$_wt_tok}}"*)
                _wt_val=$(wt_token_value "$_wt_tok")
                _wt_cmd=$(wt_replace_all "$_wt_cmd" "{{$_wt_tok}}" "$_wt_val")
                ;;
        esac
    done
    printf '%s' "$_wt_cmd"
}

# Run one adapter command after token expansion, but only when it is non-empty.
# Prints the supplied label via info() first. Returns the command's exit status;
# an unset (empty) command is a clean success no-op.
#   wt_run_adapter "Dropping the worktree database…" "$(config_get worktree.db.drop '')"
wt_run_adapter() {
    _wt_label=$1
    _wt_raw=$2
    [ -n "$_wt_raw" ] || return 0
    info "$_wt_label"
    _wt_expanded=$(wt_expand_tokens "$_wt_raw")
    eval "$_wt_expanded"
}

# Tear down this worktree's external resources via the configured adapter seams:
# first unlink the dev server, then drop the database. Both are no-ops when their
# command is unset. Failures are reported but NOT fatal — a teardown hiccup must
# never strand a worktree (graduation continues; a discard sweep is the backstop)
# — so the caller decides the exit status. The database teardown during
# graduation is intentionally non-fatal for the same reason.
wt_teardown() {
    if ! wt_run_adapter "Unlinking the worktree dev server…" "$(config_get worktree.dev_server.unlink '')"; then
        warn "Dev-server unlink reported an error — continuing."
    fi
    if ! wt_run_adapter "Dropping the worktree database…" "$(config_get worktree.db.drop '')"; then
        warn "Database drop reported an error — continuing."
    fi
}
