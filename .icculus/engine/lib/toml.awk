# toml.awk — a focused reader for the .icculus/config.toml configuration subset.
#
# This is NOT a general TOML parser. It understands exactly the shapes the
# harness uses, chosen so the whole thing stays a few dozen lines of portable
# awk with no runtime dependency:
#
#   [section] and [section.sub] headers
#   key = "string"            (single- or double-quoted, or bare)
#   key = true | false | 1.0  (bare scalars)
#   key = ["a", "b"]          (single-line arrays; items must not contain commas)
#   # comments                (full-line, and inline — respecting quotes)
#
# It deliberately does not handle multi-line arrays, inline tables, dotted
# keys, or commas inside array values. The shipped .icculus/config.toml stays within
# this subset; config.sh documents the contract for anyone editing by hand.
#
# Invocation (always via config.sh, never directly):
#   awk -v op=scalar      -v q="slots.format.run" -f toml.awk FILE
#   awk -v op=array       -v q="project.agents"   -f toml.awk FILE
#   awk -v op=subsections -v q="slots"            -f toml.awk FILE
#   awk -v op=keys        -v q="scopes.side_gates" -f toml.awk FILE
#   awk -v op=has         -v q="worktree.db"      -f toml.awk FILE

function trim(s) {
    sub(/^[ \t\r]+/, "", s)
    sub(/[ \t\r]+$/, "", s)
    return s
}

# Strip an inline `# comment`, but never a `#` that sits inside a quoted string
# (slot commands and adapter hooks can legitimately contain one).
function decomment(s,    out, i, c, inq, q) {
    out = ""; inq = 0; q = ""
    for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        if (inq) {
            out = out c
            if (c == q) { inq = 0 }
            continue
        }
        if (c == "\"" || c == "'") { inq = 1; q = c; out = out c; continue }
        if (c == "#") { break }
        out = out c
    }
    return out
}

function unquote(s) {
    s = trim(s)
    if (s ~ /^".*"$/) { return substr(s, 2, length(s) - 2) }
    if (s ~ /^'.*'$/) { return substr(s, 2, length(s) - 2) }
    return s
}

# Print every item of a single-line array value on its own line.
function emit_array(raw,    n, parts, i, item) {
    raw = trim(raw)
    sub(/^\[/, "", raw)
    sub(/\][ \t]*$/, "", raw)
    n = split(raw, parts, ",")
    for (i = 1; i <= n; i++) {
        item = unquote(trim(parts[i]))
        if (item != "") { print item }
    }
}

BEGIN { section = ""; nheaders = 0 }

{
    line = decomment($0)
    t = trim(line)
    if (t == "") { next }

    # Section header: [a] or [a.b.c]
    if (substr(t, 1, 1) == "[") {
        h = t
        sub(/^\[[ \t]*/, "", h)
        sub(/[ \t]*\].*$/, "", h)
        section = trim(h)
        headers[nheaders++] = section
        next
    }

    # key = value
    eq = index(t, "=")
    if (eq == 0) { next }
    key = trim(substr(t, 1, eq - 1))
    val = trim(substr(t, eq + 1))
    full = (section == "" ? key : section "." key)

    seen[full] = 1
    rawval[full] = val
    if (section != "") {
        # Record the key under its section for the `keys` op.
        keys_in[section] = keys_in[section] "\n" key
    }
}

END {
    if (op == "scalar") {
        if (full_seen(q)) { print unquote(rawval[q]) }
    } else if (op == "array") {
        if (full_seen(q)) { emit_array(rawval[q]) }
    } else if (op == "has") {
        if (full_seen(q) || header_exists(q)) { print "1" }
    } else if (op == "keys") {
        n = split(keys_in[q], parts, "\n")
        for (i = 1; i <= n; i++) {
            if (parts[i] != "") { print parts[i] }
        }
    } else if (op == "subsections") {
        # Immediate child segment of every header nested under `q`.
        prefix = q "."
        plen = length(prefix)
        seen_count = 0
        for (i = 0; i < nheaders; i++) {
            hdr = headers[i]
            if (substr(hdr, 1, plen) == prefix) {
                rest = substr(hdr, plen + 1)
                dot = index(rest, ".")
                seg = (dot == 0 ? rest : substr(rest, 1, dot - 1))
                if (!(seg in emitted)) {
                    emitted[seg] = 1
                    print seg
                }
            }
        }
    }
}

function full_seen(k) { return (k in seen) }

function header_exists(k,    i) {
    for (i = 0; i < nheaders; i++) {
        if (headers[i] == k) { return 1 }
    }
    return 0
}
