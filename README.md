# dan-voice

Real-time voice interface for local CLI agents. Talk to OpenCode, Claude Code, or any agent from your phone.

Speak on your phone → STT → agent → TTS → audio back. One-shot per utterance.

## Install

```bash
pip install dan-voice              # core (TTS: macOS say)
pip install "dan-voice[stt]"       # + faster-whisper STT
pip install "dan-voice[stt,tts]"   # + piper TTS
```

## Start

```bash
python -m voice_dani
```

Terminal prints a 6-digit PIN and a public URL (via Cloudflare tunnel). Open the URL on your phone, enter the PIN, talk.

## Agents

Works with any CLI agent that accepts a prompt and prints a response:

- **OpenCode** (default) — `opencode run --format json`
- **Claude Code** — `claude --print --output-format stream-json`
- **Codex** — `codex`
- **Grok** — `grok`

Set via `--agent` flag or the `/voice-dani` slash command.

## Architecture

```
Phone (Safari/Chrome)              Laptop
┌────────────────────┐             ┌──────────────────────────┐
│  MediaRecorder     │ ◄── WS ──► │  FastAPI + WebSocket      │
│  PIN entry         │             │    ├─ STT (faster-whisper) │
│  Audio playback    │             │    ├─ Agent CLI runner     │
│  Chat bubbles      │             │    └─ TTS (piper / say)   │
└────────────────────┘             └──────────────────────────┘
```

One-shot per utterance: phone records → sends audio → server transcribes → runs agent → TTS → sends audio back.

## Config

| Variable | Default | Description |
|----------|---------|-------------|
| `VD_PHONE_RATE` | 48000 | Phone audio sample rate |
| `VD_STT_RATE` | 16000 | STT input rate |
| `VD_STT_MODEL` | tiny | Whisper model size |
| `VD_STT_DEVICE` | cpu | STT device (cpu/cuda/metal) |
| `VD_TTS_BACKEND` | auto | TTS backend (auto/piper/say) |
| `VD_TTS_VOICE` | en_US-lessac-medium | Piper voice |
| `VD_HOST` | 127.0.0.1 | Server host |
| `VD_PORT` | 7860 | Server port |
| `VD_RATE_LIMIT` | 5 | Max PIN attempts/min/IP |

## Security

- 6-digit PIN, single-use, 5-minute TTL
- Rate limiting: 5 attempts/min/IP, lockout after 10 failures
- No audio persisted
- Audit logging

## Dev

```bash
uv sync
uv run pytest tests/ -v
```

## License

MIT
