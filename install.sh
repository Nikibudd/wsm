#!/usr/bin/env bash
# Downloads and installs the latest wsm release. This is only the one-time
# bootstrap for a first install — `wsm update` takes over after that (see
# README's "From a release"). Mirrors src/update.ts's fetch-latest-release
# logic in bash, since that self-updater can't be what installs itself.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Nikibudd/wsm/main/install.sh | bash
#
# WSM_INSTALL_DIR overrides the install directory (default: ~/.local/bin).
set -euo pipefail

REPO="Nikibudd/wsm"
ASSET_NAME="wsm.mjs"
INSTALL_DIR="${WSM_INSTALL_DIR:-$HOME/.local/bin}"

log() { printf '%s\n' "$*"; }
err() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

# macOS + Linux only, same scope as the rest of wsm (see AGENTS.md) — no
# OS-specific installers to maintain beyond that.
case "$(uname -s)" in
  Darwin | Linux) ;;
  *) err "wsm supports macOS and Linux only — detected $(uname -s)." ;;
esac

command -v curl >/dev/null 2>&1 || err "curl is required to install wsm."
command -v node >/dev/null 2>&1 ||
  err "Node.js 20+ is required to run wsm. Install it first: https://nodejs.org"

node_major=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$node_major" -lt 20 ]; then
  err "wsm requires Node.js 20+, found $(node --version)."
fi

log "Fetching latest wsm release..."
release_json=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest") ||
  err "Could not reach GitHub's API to check the latest release."

version=$(printf '%s\n' "$release_json" | grep -m1 '"tag_name"' |
  sed -E 's/.*"tag_name": *"([^"]+)".*/\1/') || true
download_url=$(printf '%s\n' "$release_json" | grep '"browser_download_url"' |
  grep "/${ASSET_NAME}\"" | head -1 | sed -E 's/.*"(https:[^"]+)".*/\1/') || true

[ -n "$version" ] || err "Could not determine the latest release version."
[ -n "$download_url" ] || err "Latest release ($version) has no ${ASSET_NAME} asset to download."

log "Downloading wsm ${version}..."
mkdir -p "$INSTALL_DIR"
# Download to a temp file in the SAME directory as the target first, then
# move into place — same atomic-install reasoning as update.ts's
# installUpdate(): no risk of a half-written binary landing on PATH.
tmp_file=$(mktemp "${INSTALL_DIR}/.wsm.download.XXXXXX")
trap 'rm -f "$tmp_file"' EXIT
curl -fsSL "$download_url" -o "$tmp_file" || err "Download failed."
chmod +x "$tmp_file"
mv "$tmp_file" "${INSTALL_DIR}/wsm"
trap - EXIT

log "Installed wsm ${version} -> ${INSTALL_DIR}/wsm"

case ":$PATH:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    log ""
    log "${INSTALL_DIR} isn't on your PATH yet. Add this to your shell rc file:"
    log "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac

log ""
log "Run 'wsm' to configure a workspace, or 'wsm --version' to confirm the install."
