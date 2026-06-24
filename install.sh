#!/bin/sh
#
# discern installer — download the right prebuilt binary and put it on PATH.
#
#   curl -fsSL https://raw.githubusercontent.com/jackwh/discern/main/install.sh | sh
#
# Detects your OS/arch, fetches the matching binary from the latest GitHub
# release (or $DISCERN_VERSION), installs it to a writable bin dir, and chmods
# it. POSIX sh; needs curl (or wget) and either tar-free single-binary download.
#
# Environment overrides:
#   DISCERN_REPO     owner/repo to download from (default: jackwh/discern)
#   DISCERN_VERSION  release tag to install (default: latest)
#   DISCERN_BIN_DIR  install directory (default: ~/.local/bin, else /usr/local/bin)

set -eu

REPO="${DISCERN_REPO:-jackwh/discern}"
VERSION="${DISCERN_VERSION:-latest}"

# --- pretty output (only on a TTY) ---------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    BOLD=$(printf '\033[1m'); GREEN=$(printf '\033[32m'); RED=$(printf '\033[31m'); RESET=$(printf '\033[0m')
else
    BOLD=""; GREEN=""; RED=""; RESET=""
fi
info() { printf '%s→%s %s\n' "$GREEN" "$RESET" "$1"; }
die() { printf '%s✗%s %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }

# --- detect a downloader --------------------------------------------------
if command -v curl >/dev/null 2>&1; then
    DL_OUT="curl -fsSL -o"
elif command -v wget >/dev/null 2>&1; then
    DL_OUT="wget -qO"
else
    die "need curl or wget to download discern."
fi

# --- detect OS/arch and map to a release asset triple --------------------
os=$(uname -s)
arch=$(uname -m)

case "$os" in
    Darwin) os_part="apple-darwin" ;;
    Linux)  os_part="unknown-linux-gnu" ;;
    *) die "unsupported OS \"$os\". discern ships macOS and Linux binaries (Windows: use WSL)." ;;
esac

case "$arch" in
    x86_64|amd64) arch_part="x86_64" ;;
    arm64|aarch64) arch_part="aarch64" ;;
    *) die "unsupported architecture \"$arch\"." ;;
esac

asset="discern-${arch_part}-${os_part}"

# --- resolve the download URL --------------------------------------------
if [ "$VERSION" = "latest" ]; then
    url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
    url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

# --- choose an install dir ------------------------------------------------
if [ -n "${DISCERN_BIN_DIR:-}" ]; then
    bin_dir="$DISCERN_BIN_DIR"
elif [ -d "$HOME/.local/bin" ] || mkdir -p "$HOME/.local/bin" 2>/dev/null; then
    bin_dir="$HOME/.local/bin"
elif [ -w /usr/local/bin ]; then
    bin_dir="/usr/local/bin"
else
    die "no writable install dir. Set DISCERN_BIN_DIR to a directory on your PATH."
fi
mkdir -p "$bin_dir" || die "could not create install dir: $bin_dir"

dest="$bin_dir/discern"
tmp=$(mktemp 2>/dev/null || mktemp -t discern)

# --- download -------------------------------------------------------------
info "downloading ${BOLD}${asset}${RESET} from ${REPO} (${VERSION})"
# shellcheck disable=SC2086
if ! $DL_OUT "$tmp" "$url"; then
    rm -f "$tmp"
    die "download failed: $url"
fi

# --- install --------------------------------------------------------------
chmod +x "$tmp"
mv "$tmp" "$dest" || die "could not move binary into $bin_dir"

info "installed ${BOLD}discern${RESET} to ${dest}"

# --- PATH hint ------------------------------------------------------------
case ":$PATH:" in
    *":$bin_dir:"*) : ;;
    *) printf '%s!%s %s is not on your PATH. Add it:\n    export PATH="%s:$PATH"\n' \
           "$RED" "$RESET" "$bin_dir" "$bin_dir" >&2 ;;
esac

printf '\n%sNext:%s tell your coding agent to run %sdiscern%s — it sets up the project for you.\n' \
    "$GREEN" "$RESET" "$BOLD" "$RESET"
printf '      Setup is a one-time, high-leverage step, so point your %smost capable model%s at it.\n' \
    "$BOLD" "$RESET"
