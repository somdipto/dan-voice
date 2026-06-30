#!/usr/bin/env bash
# One-time Cloudflare Tunnel setup for voice.danlab.dev.
#
# Usage:
#   1. cloudflared login                       # opens browser; pick danlab.dev
#   2. cloudflared tunnel create voice-dani    # creates named tunnel
#   3. cloudflared tunnel route dns voice voice.danlab.dev
#   4. cp credentials JSON to ~/.cloudflared/<UUID>.json
#   5. put the tunnel token in .env as CLOUDFLARE_TUNNEL_TOKEN
#
# V1 lands the actual subprocess wiring in voice_dani/tunnel.py.

set -euo pipefail

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Installing cloudflared via Homebrew…"
  brew install cloudflared
fi

echo
echo "Cloudflare Tunnel quick-start:"
echo "  1. cloudflared login"
echo "  2. cloudflared tunnel create voice-dani"
echo "  3. cloudflared tunnel route dns voice voice.danlab.dev"
echo "  4. Note the token printed by step 2 and put it in .env:"
echo "       CLOUDFLARE_TUNNEL_TOKEN=<token>"
echo
echo "Then run: uv run voice connect"
