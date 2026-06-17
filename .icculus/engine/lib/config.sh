# config.sh — shell accessors for icculus.toml, backed by toml.awk.
#
# Sourced by every recipe (via bootstrap.sh). Requires ICCULUS_TOML and
# ICCULUS_LIB to be set (bootstrap.sh guarantees this). Every read re-parses the
# file; the config is tiny and gate runs are not hot loops, so clarity wins over
# caching. See toml.awk for the supported subset.

# Scalar read with optional default. Quotes are stripped.
#   value=$(config_get project.slug)
#   value=$(config_get worktree.db.clone "")   # explicit default
config_get() {
    _ic_v=$(awk -v op=scalar -v q="$1" -f "$ICCULUS_LIB/toml.awk" "$ICCULUS_TOML")
    if [ -z "$_ic_v" ] && [ "$#" -ge 2 ]; then
        printf '%s' "$2"
    else
        printf '%s' "$_ic_v"
    fi
}

# Array read — one item per line.
#   config_array project.agents
config_array() {
    awk -v op=array -v q="$1" -f "$ICCULUS_LIB/toml.awk" "$ICCULUS_TOML"
}

# Immediate child names of every header nested under a prefix.
#   config_subsections slots   # -> format, build, lint, test, ...
config_subsections() {
    awk -v op=subsections -v q="$1" -f "$ICCULUS_LIB/toml.awk" "$ICCULUS_TOML"
}

# Key names of `key = value` lines declared directly in a section.
#   config_keys scopes.side_gates   # -> native, ...
config_keys() {
    awk -v op=keys -v q="$1" -f "$ICCULUS_LIB/toml.awk" "$ICCULUS_TOML"
}

# True (exit 0) when a scalar/array key OR a section header exists.
config_has() {
    [ -n "$(awk -v op=has -v q="$1" -f "$ICCULUS_LIB/toml.awk" "$ICCULUS_TOML")" ]
}

# True (exit 0) when a boolean key is the literal `true`.
#   if config_bool worktree.enabled; then ...
config_bool() {
    [ "$(config_get "$1")" = "true" ]
}

# True (exit 0) when a slot command is unset or the no-op `:`.
#   config_slot_is_noop slots.format.run
config_slot_is_noop() {
    _ic_run=$(config_get "$1")
    [ -z "$_ic_run" ] || [ "$_ic_run" = ":" ]
}
