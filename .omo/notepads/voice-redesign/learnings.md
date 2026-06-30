# Learnings

## 2026-06-29 — Codebase exploration

- `voice_dani/` package source is MISSING from working tree. Need to create it.
- `dan-voice-bridge/voidclaw_voice/` has working precursor code to reference.
- Web UI in `web/` has audio playback STUBBED (`playOpusFrame` is no-op) — this is why voice doesn't work.
- Pairing uses UUID + token flow. Need to change to 6-digit PIN.
- Server uses FastAPI + WebSocket on port 7860.
- Cloudflare tunnel exposes the server publicly.
- Dependencies: FastAPI 0.115.6, Starlette 0.41.3, Uvicorn 0.32.1, websockets 13.1.
- STT: whisper.cpp or faster-whisper. TTS: KittenTTS or Piper.
- Audio framing: 2-byte LE length prefix for Opus frames, 0x00 prefix byte for PCM.

## User requirements
1. 6-digit PIN pairing (not UUID URLs)
2. Public link that works reliably
3. Beautiful mobile UI (current is ugly)
4. Both voice AND text input
5. Proper audio connectivity (current voice doesn't work)

## 2026-06-29 — Server foundation built

### Files created
- `voice_dani/__init__.py` — package init, re-exports `app`, `PairingManager`, `PairingSession`
- `voice_dani/pairing.py` — PIN pairing logic
- `voice_dani/server.py` — FastAPI server

### Architecture
- PIN pairing uses `secrets.randbelow` (6 digits), 5-min TTL, single-use.
- Session tokens: `{pin}|{timestamp}|{sha256-hmac}` — 256-bit, server-signed, 24h max lifetime.
- WebSocket relay at `/ws?token=<session_token>` handles both binary (audio) and text (barge_in, config, text_message) frames.
- Legacy UUID-style endpoint `POST /pair/{pin}/redeem` kept for existing app.js compatibility.
- `index.html` template variable `{{PAIR_UUID}}` replaced with 6-digit PIN at serve time.
- `AgentAdapter` ABC included as interface for OpenCode/Claude/Codex adapters.
- Audio pipeline stubbed (`process_audio_frame`, `encode_tts_frame`) — implementation deferred.
- Static files from `web/` mounted at `/static`.
- Server binds to `127.0.0.1:7860` by default.

### Gotchas
- `cryptography` HMAC needs `SHA256()` instance, not class.
- Template `{{PAIR_UUID}}` is in the HTML both as a JS variable name AND a template placeholder — only the placeholder value `{{PAIR_UUID}}` is replaced with PIN.
- Web dir resolved at runtime: checks `voice_dani/web/` and `<project>/web/` for both dev and production layouts.
- `uvicorn[standard]` 0.32.1 + `websockets` 13.1 pinned for iOS Safari WebSocket handshake compatibility.

## 2026-06-29 — kokoro → edge-tts migration

### Changes
- `audio_handler.py`: Replaced `from kokoro import KPipeline` with `import edge_tts`
- `audio_handler.py`: Rewrote TTS class to use `edge_tts.Communicate` + `ffmpeg` subprocess
- Added `import os` and `import tempfile` for temp MP3 file management

### How it works
- `TTS.generate()` calls `edge_tts.Communicate(text, voice).save(mp3_path)` via `asyncio.run()` (called from thread pool via `asyncio.to_thread`)
- ffmpeg converts MP3 → raw PCM16 mono 24kHz (`pipe:1`)
- PCM16 bytes are converted to `np.float32` in [-1, 1] range (same return type as kokoro)
- Default voice: `en-US-AvaNeural` (good quality female)

### Why
- kokoro requires torch, which doesn't work on Python 3.14
- edge-tts is a pure Python library, already installed as a dependency
- ffmpeg is assumed available on PATH (platform standard)

### Latency note
- edge-tts generates the full utterance before producing any audio (unlike kokoro's streaming chunks)
- Each sentence is generated individually (caller already splits on `.?!\n`)
- Total latency per sentence: ~1-2s (TTS generation + ffmpeg conversion)
- Barge-in still works via `self._stop` flag checked before generation
