# fix-tunnel — Draft

## Status: awaiting-approval

## Root Cause Analysis

**Error:** Cloudflare error 1033 when opening tunnel URL on phone.

**Root cause:** `server.py:159-171` — `_start_tunnel()` uses `subprocess.run(timeout=20)`.

`subprocess.run()` BLOCKS until the process finishes OR times out. cloudflared runs forever (it's a long-lived daemon). After 20 seconds, `subprocess.run` raises `TimeoutExpired` and **kills the process**. The URL was captured from stderr, but the tunnel process is dead.

**Evidence:**
- `ps aux | grep cloudflared` shows an old process from Mon03PM (stale, not from current session)
- Testing `subprocess.run([cloudflared, "tunnel", ...], timeout=5)` raises `TimeoutExpired` — process never finishes
- The URL is captured but the process is killed immediately after

**Fix:** Replace `subprocess.run` with `subprocess.Popen` — start cloudflared in background, read stderr line-by-line to capture URL, keep process alive.

## Scope

ONE file: `voice_dani/server.py`
- Replace `_start_tunnel()` function (lines 153-171)
- Add `_tunnel_proc` global for cleanup
- Add tunnel cleanup in `lifespan()` shutdown

## Out of Scope

- Audio format mismatch (separate fix)
- Barge-in (separate fix)
- SayTTS (separate fix)
- Agent runner (separate fix)
- Mobile UI (separate fix)
