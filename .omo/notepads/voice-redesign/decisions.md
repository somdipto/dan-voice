# Decisions

## 2026-06-29 — Architecture

- **PIN pairing**: Generate 6-digit numeric code, display on CLI, enter on phone. No URL tokens.
- **Server**: Single FastAPI app in `voice_dani/server.py`. Serves static web files + API endpoints.
- **Audio**: Use WebAssembly Opus decoder (opus-decoder npm) in browser for TTS playback.
- **Text input**: Add text message input field to mobile UI, send via WebSocket JSON.
- **Mobile UI**: Complete redesign with premium dark theme, glass morphism, smooth animations.
