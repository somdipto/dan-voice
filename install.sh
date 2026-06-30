#!/usr/bin/env bash
# Voice Dani — one-line installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/dan/voice-dani/main/install.sh | bash
#
# This downloads a tarball of the Voice Dani source to a temp dir and
# runs the installer. The Python server (voice) and OpenCode plugin /
# Claude Code slash command get installed; nothing is left in the temp
# dir after install completes.
#
# For development (running from a local checkout), use:
#   node dist/voice-dani-cli/bin/voice-dani.js install
set -euo pipefail

REPO="${VOICE_DANI_REPO_URL:-https://github.com/dan/voice-dani/archive/refs/heads/main.tar.gz}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading Voice Dani…"
curl -fsSL "$REPO" | tar -xz -C "$TMP"
SRC_DIR="$TMP"
# If the tarball wraps everything in a top-level dir, descend into it.
# GitHub source tarballs use the `<repo>-<branch>` convention; locally
# packed tarballs may use the bare repo dir name.
if [ -d "$SRC_DIR/voice-dani-main" ]; then
  SRC_DIR="$SRC_DIR/voice-dani-main"
elif [ -d "$SRC_DIR/voice" ] && [ -f "$SRC_DIR/voice/dist/voice-dani-cli/bin/voice-dani.js" ]; then
  SRC_DIR="$SRC_DIR/voice"
fi

echo "Running installer…"
cd "$SRC_DIR"
if [ ! -f dist/voice-dani-cli/bin/voice-dani.js ]; then
  echo "Could not find dist/voice-dani-cli/bin/voice-dani.js in $SRC_DIR" >&2
  ls "$SRC_DIR" >&2
  exit 1
fi
node dist/voice-dani-cli/bin/voice-dani.js install

echo
echo "Voice Dani is installed. Run one of:"
echo "  voice-dani start                        # default agent: opencode"
echo "  voice-dani start --agent claude         # use Claude Code"
echo "  voice-dani doctor                       # check prerequisites"
echo
echo "Or invoke directly from your agent:"
echo "  In OpenCode TUI:    /voice-dani"
echo "  In Claude Code:     /voice-dani"
