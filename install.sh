#!/bin/sh
#
# discern installer — download the right prebuilt binary and put it on PATH.
#
#   curl -fsSL https://discern.sh/install | sh
#
# Raw GitHub fallback:
#   curl -fsSL https://raw.githubusercontent.com/jackwh/discern/main/install.sh | sh
#
# Detects your OS/arch, fetches the matching binary from the latest GitHub
# release (or $DISCERN_VERSION), verifies its SHA-256 checksum, and installs it
# to a writable bin dir. POSIX sh; needs curl (or wget) and sha256sum (or shasum).
#
# Environment overrides:
#   DISCERN_REPO     owner/repo to download from (default: jackwh/discern)
#   DISCERN_VERSION  release tag to install (default: latest)
#   DISCERN_BIN_DIR  install directory (default: writable /usr/local/bin on
#                    macOS, otherwise ~/.local/bin, then /usr/local/bin)

set -eu

REPO="${DISCERN_REPO:-jackwh/discern}"
VERSION_INPUT="${DISCERN_VERSION:-latest}"

# --- pretty output (only on a TTY) ---------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    BOLD=$(printf '\033[1m'); GREEN=$(printf '\033[32m'); RED=$(printf '\033[31m'); RESET=$(printf '\033[0m')
else
    BOLD=""; GREEN=""; RED=""; RESET=""
fi
info() { printf '%s→%s %s\n' "$GREEN" "$RESET" "$1"; }
die() { printf '%s✗%s %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }

if [ "$VERSION_INPUT" = "latest" ]; then
    VERSION="latest"
else
    VERSION="v${VERSION_INPUT#v}"
    [ "$VERSION" != "v" ] || die "DISCERN_VERSION must name a release version."
fi

# --- detect download and checksum tools ----------------------------------
DOWNLOADERS="curl wget"
downloader=""
for candidate in $DOWNLOADERS; do
    if command -v "$candidate" >/dev/null 2>&1; then
        downloader="$candidate"
        break
    fi
done
[ -n "$downloader" ] || die "need curl or wget to download discern."

if command -v sha256sum >/dev/null 2>&1; then
    checksum_tool="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
    checksum_tool="shasum"
else
    die "need sha256sum or shasum to verify the discern download."
fi

download() {
    case "$downloader" in
        curl)
            curl -fL --retry 3 --retry-all-errors --connect-timeout 15 -sS -o "$2" "$1"
            ;;
        wget)
            wget -q --tries=3 --timeout=15 -O "$2" "$1"
            ;;
        *)
            die "unsupported downloader: $downloader"
            ;;
    esac
}

verify_checksum() {
    case "$checksum_tool" in
        sha256sum) (cd "$1" && sha256sum -c "$2" >/dev/null 2>&1) ;;
        shasum) (cd "$1" && shasum -a 256 -c "$2" >/dev/null 2>&1) ;;
        *) return 1 ;;
    esac
}

# --- detect OS/arch and map to a release asset triple --------------------
os=$(uname -s)
arch=$(uname -m)

case "$os" in
    Darwin) os_part="apple-darwin" ;;
    Linux)  os_part="unknown-linux-gnu" ;;
    *) die "unsupported OS \"$os\". discern ships macOS and Linux binaries; on Windows, use WSL 2." ;;
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
elif [ "$os" = "Darwin" ] && [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
    bin_dir="/usr/local/bin"
elif [ -d "$HOME/.local/bin" ] || mkdir -p "$HOME/.local/bin" 2>/dev/null; then
    bin_dir="$HOME/.local/bin"
elif [ -w /usr/local/bin ]; then
    bin_dir="/usr/local/bin"
else
    die "no writable install dir. Set DISCERN_BIN_DIR to a directory on your PATH."
fi
mkdir -p "$bin_dir" || die "could not create install dir: $bin_dir"

dest="$bin_dir/discern"
if [ -d "$dest" ]; then
    die "install destination is a directory: $dest"
fi
stage_dir=$(mktemp -d "$bin_dir/.discern-install.XXXXXX") || \
    die "could not create a staging directory in $bin_dir"
cleanup() { rm -rf "$stage_dir"; }
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
binary_path="$stage_dir/$asset"
checksum_name="$asset.sha256"
checksum_path="$stage_dir/$checksum_name"

# --- download and verify --------------------------------------------------
info "downloading ${BOLD}${asset}${RESET} from ${REPO} (${VERSION})"
if ! download "$url" "$binary_path"; then
    die "download failed: $url"
fi
if ! download "$url.sha256" "$checksum_path"; then
    die "checksum download failed: $url.sha256"
fi
if ! verify_checksum "$stage_dir" "$checksum_name"; then
    die "checksum verification failed for $asset; the existing installation was not changed."
fi

# --- install --------------------------------------------------------------
chmod +x "$binary_path"
mv "$binary_path" "$dest" || die "could not move binary into $bin_dir"

info "installed ${BOLD}discern${RESET} to ${dest}"

# --- truthful PATH handoff ------------------------------------------------
if resolved=$(command -v discern 2>/dev/null) && [ "$resolved" = "$dest" ]; then
    printf '\n%sNext:%s tell your coding agent to run %sdiscern%s — it sets up the project for you.\n' \
        "$GREEN" "$RESET" "$BOLD" "$RESET"
    printf '      Setup is a one-time, high-leverage step, so point your %smost capable model%s at it.\n' \
        "$BOLD" "$RESET"
elif [ -n "${resolved:-}" ]; then
    printf '%s!%s PATH resolves discern to %s before %s.\n' \
        "$RED" "$RESET" "$resolved" "$dest" >&2
    printf '  Put %s first in your shell profile, then open a new shell and run discern --version.\n' \
        "$bin_dir" >&2
else
    printf '%s!%s %s is not on PATH. Add this line to your shell profile, then open a new shell:\n' \
        "$RED" "$RESET" "$bin_dir" >&2
    printf "    export PATH=\"%s:\$PATH\"\n" "$bin_dir" >&2
    printf '  Verify afterward with: discern --version\n' >&2
fi
