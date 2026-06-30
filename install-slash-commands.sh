#!/usr/bin/env bash
# Voice Dani — install slash command for all CLI agents
# Run from the project root: ./install-slash-commands.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VOICE_CMD="$PROJECT_DIR/.venv/bin/python -m voice_dani"

echo "Installing /voice-dani slash command for all CLI agents..."
echo "Project: $PROJECT_DIR"
echo "Voice command: $VOICE_CMD"

# OpenCode
OPENCODE_DIR="$HOME/.config/opencode/commands"
mkdir -p "$OPENCODE_DIR"
cat > "$OPENCODE_DIR/voice-dani.md" <<EOF
---
description: Start a Voice Dani voice session from your phone
---

Run the voice server and show the pairing URL + PIN:

\`\`\`bash
$VOICE_CMD --agent opencode
\`\`\`

Wait for the PIN + URL to appear. Open the URL on your phone, enter the PIN, and speak to control OpenCode.
EOF
echo "✓ OpenCode: $OPENCODE_DIR/voice-dani.md"

# Claude Code
CLAUDE_DIR="$HOME/.claude/commands"
mkdir -p "$CLAUDE_DIR"
cat > "$CLAUDE_DIR/voice-dani.md" <<EOF
---
description: Start a Voice Dani voice session from your phone
---

Run the voice server and show the pairing URL + PIN:

\`\`\`bash
$VOICE_CMD --agent claude
\`\`\`

Wait for the PIN + URL to appear. Open the URL on your phone, enter the PIN, and speak to control Claude Code.
EOF
echo "✓ Claude Code: $CLAUDE_DIR/voice-dani.md"

# Codex
CODEX_DIR="$HOME/.codex/skills"
mkdir -p "$CODEX_DIR"
cat > "$CODEX_DIR/voice-dani.md" <<EOF
---
description: Start a Voice Dani voice session from your phone
---

Run the voice server and show the pairing URL + PIN:

\`\`\`bash
$VOICE_CMD --agent codex
\`\`\`

Wait for the PIN + URL to appear. Open the URL on your phone, enter the PIN, and speak to control Codex.
EOF
echo "✓ Codex: $CODEX_DIR/voice-dani.md"

# Grok
GROK_DIR="$HOME/.grok/commands"
mkdir -p "$GROK_DIR"
cat > "$GROK_DIR/voice-dani.toml" <<EOF
description = "Start a Voice Dani voice session from your phone"
prompt = "Run this command: $VOICE_CMD --agent grok. Wait for the PIN + URL to appear in the terminal output. Show the user the URL and PIN so they can open it on their phone, enter the PIN, and speak to control Grok."
EOF
echo "✓ Grok: $GROK_DIR/voice-dani.toml"

echo ""
echo "All slash commands installed!"
echo ""
echo "Usage in any terminal:"
echo "  /voice-dani              # defaults to opencode"
echo "  /voice-dani --agent claude"
echo "  /voice-dani --agent codex"
echo "  /voice-dani --agent grok"
echo ""
echo "Note: The commands use the project's venv python. If you move the project,"
echo "re-run this script to update paths."