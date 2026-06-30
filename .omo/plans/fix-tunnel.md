# fix-tunnel - Work Plan

## TL;DR (For humans)

**What you'll get:** Cloudflare tunnel stays alive after startup. Phone opens the URL and sees the web UI instead of error 1033.

**Why this approach:** `subprocess.run(timeout=20)` kills cloudflared after 20 seconds. Replace with `subprocess.Popen` so the process stays alive in the background.

**What it will NOT do:** Fix audio format, barge-in, TTS quality, or agent execution. Those are separate issues.

**Effort:** Quick (5 min fix + 5 min verification)
**Risk:** Low — single function replacement, no behavior change
**Decisions to sanity-check:** None — the bug is clear, the fix is mechanical

Your next move: approve, or flag if you want the other bugs fixed in the same plan.

---

> TL;DR (machine): Quick fix — replace subprocess.run with Popen in _start_tunnel(), 1 file, low risk.

## Scope
### Must have
- `_start_tunnel()` uses `Popen` instead of `run` so cloudflared stays alive
- Tunnel process is cleaned up on server shutdown
- Verification: tunnel URL loads on phone

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No audio format changes
- No barge-in changes
- No TTS changes
- No agent runner changes
- No new dependencies
- No UI changes

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after + manual QA
- Evidence: .omo/evidence/task-<N>-fix-tunnel.<ext>

## Execution strategy
### Parallel execution waves
> Single wave — one file, one function.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | — | 2 | — |
| 2 | 1 | — | — |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [ ] 1. Fix `_start_tunnel()` in server.py
  What to do / Must NOT do:
  - Replace `_start_tunnel()` (lines 153-171) with Popen version
  - Add `_tunnel_proc: subprocess.Popen | None = None` global
  - Use `Popen` with `stderr=PIPE`, read line-by-line, extract URL
  - Return URL when found, kill process if timeout
  - Add `if _tunnel_proc: _tunnel_proc.kill()` to `lifespan()` shutdown
  - Do NOT change any other function
  - Do NOT add imports beyond what's needed (select is stdlib)
  Parallelization: Wave 1 | Blocked by: none | Blocks: 2
  References: server.py:153-171 (current broken _start_tunnel), server.py:37-54 (lifespan shutdown)
  Acceptance criteria (agent-executable): `python -c "from voice_dani.server import _start_tunnel; print('OK')"` succeeds
  QA scenarios:
    - happy: Start server → cloudflared process visible in `ps aux` → URL loads in curl
    - failure: Kill cloudflared manually → server still runs, no crash
    Evidence: .omo/evidence/task-1-fix-tunnel.txt
  Commit: Y | fix(server): keep cloudflared alive with Popen instead of run

- [ ] 2. Verify tunnel works end-to-end
  What to do / Must NOT do:
  - Kill all stale cloudflared and voice_dani processes
  - Run `python -m voice_dani --no-tunnel` (verify server starts)
  - Run `python -m voice_dani` (verify tunnel starts and URL is printed)
  - Verify `ps aux | grep cloudflared` shows a running process
  - Verify `curl <tunnel-url>` returns the HTML page
  - Do NOT test audio, STT, or agent — just the tunnel
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: none
  References: server.py:198-236 (print_startup_box)
  Acceptance criteria (agent-executable): `curl <tunnel-url>` returns HTML with "Voice Dani"
  QA scenarios:
    - happy: Server prints URL → curl returns HTML → cloudflared alive after 60s
    - failure: If tunnel fails, server still starts on localhost
    Evidence: .omo/evidence/task-2-fix-tunnel.txt
  Commit: N/A (verification only)

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit — confirm only server.py was changed, no new deps
- [ ] F2. Code quality review — confirm Popen stderr reading is correct, no resource leaks
- [ ] F3. Real manual QA — start server, open URL on phone, confirm UI loads
- [ ] F4. Scope fidelity — confirm no audio/TTS/agent changes leaked in

## Commit strategy
Single commit: `fix(server): keep cloudflared alive with Popen instead of run`

## Success criteria
- `python -m voice_dani` prints a tunnel URL
- `ps aux | grep cloudflared` shows a running process
- `curl <tunnel-url>` returns the HTML page
- Phone opens URL and sees the PIN entry screen
- No error 1033
