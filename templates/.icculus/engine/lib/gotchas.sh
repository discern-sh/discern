# shellcheck shell=sh
# gotchas.sh — the single source for the "a gate phase failed" failure pointer.
#
# A task runner that stops at the first failing step, with no on-failure hook,
# cannot run a trailing "print advice" step after a failure. Two recipes close
# that gap with the SAME wording — `finish` (via an EXIT trap on its gated
# phases) and `with-gotchas` (a thin wrapper for any one command) — so the text
# lives here once and both source it.
#
# The pointer aims an agent at the project's gotchas doc: the place the
# maintainer writes down the non-obvious ways this particular stack's gate fails
# (a flaky build manifest, a check that only trips in the full suite, a merge
# that needs a dependency install first). Keep it stack-neutral here; the doc it
# points at is where the stack-specific traps belong.

# Print the failure pointer to stderr. Reads [project].gotchas_doc and resolves
# it against the project root; says nothing extra when no doc is configured (an
# empty gotchas_doc disables the pointer, matching the config schema).
gotchas_hint() {
    _gh_doc=$(config_get project.gotchas_doc "")

    {
        printf '\n'
        printf '%s── a gate step failed ───────────────────────────────────────%s\n' "${C_DIM}" "${C_RESET}"
        if [ -n "$_gh_doc" ]; then
            printf 'If the error above is not self-explanatory, the non-obvious ways\n'
            printf 'this gate fails — each with its fix — are written down here:\n'
            printf '  %s%s%s\n' "${C_CYAN}" "$ICCULUS_ROOT/$_gh_doc" "${C_RESET}"
        else
            printf 'If the error above is not self-explanatory, record the fix in a\n'
            printf 'gotchas doc and point [project].gotchas_doc in .icculus/config.toml at it,\n'
            printf 'so the next failure carries its own guidance.\n'
        fi
        printf '%s─────────────────────────────────────────────────────────────%s\n' "${C_DIM}" "${C_RESET}"
    } >&2
}
