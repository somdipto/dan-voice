# Voice Dani — Testing Strategy

**Project:** Real-time voice pipeline: phone → STT → agent CLI → TTS → phone  
**Stack:** Python FastAPI, WebSocket, faster-whisper, macOS `say` TTS, vanilla JavaScript web app  
**Current coverage:** 15 integration tests (PIN lifecycle, HTTP, WS connect/reject, audio pipeline imports)  
**Gap:** No unit tests, no performance tests, no load tests, no frontend tests, no CI/CD

---

## Table of Contents

1. [Priority & Phasing](#1-priority--phasing)
2. [Unit Testing Audio Pipelines](#2-unit-testing-audio-pipelines)
3. [WebSocket Testing](#3-websocket-testing)
4. [Integration Testing](#4-integration-testing)
5. [Performance Testing](#5-performance-testing)
6. [Load Testing](#6-load-testing)
7. [Security Testing](#7-security-testing)
8. [Frontend Testing](#8-frontend-testing)
9. [CI/CD Integration](#9-cicd-integration)

---

## 1. Priority & Phasing

| Phase | What | Why now | Est. effort |
|-------|------|---------|-------------|
| **P0** | Unit tests for audio processing | Core logic (STT/TTS/resample) has zero coverage. Every refactor risks silent regressions. | 1 day |
| **P0** | CI/CD in GitHub Actions | No automated gate. Manual testing only. Blocks all other test investment. | 1 day |
| **P1** | Security tests (PIN brute-force, rate limiting) | 6-digit PIN → ~1:10⁶ guess. No rate limiting = trivially brute-forceable in production. | 0.5 day |
| **P1** | WebSocket integration tests (real audio frames) | Current integration tests never send audio bytes. The core relay path is untested. | 1 day |
| **P2** | Performance/latency benchmarks | Latency targets exist (STT <600ms, pipeline <1.5s) but no measurement infra. | 1 day |
| **P2** | Load tests | Concurrency is an architectural concern. FastAPI/uvicorn async handles it well, but we need a number. | 0.5 day |
| **P3** | Frontend tests | JS is ~300 lines, mostly DOM + WebSocket glue. Error-handling paths are the real risk. | 1 day |
| **P3** | E2E pipeline (real audio → real agent) | Requires mocking the agent CLI. Valuable but high setup cost. | 1.5 days |

---

## 2. Unit Testing Audio Pipelines

### Recommended tools

| Tool | Role |
|------|------|
| `pytest` | Already installed. Test runner. |
| `unittest.mock` / `pytest-mock` | Mock `WhisperModel` and `subprocess.run` |
| `numpy` | Generate synthetic audio for resample/pcm16 tests (already a dep) |

### Mock strategies

**STT (`transcribe`)** — two mock layers:

```python
# Strategy A: Mock at the faster-whisper boundary (recommended)
@pytest.fixture
def mock_whisper(mocker):
    mock_model = mocker.MagicMock(spec=WhisperModel)
    mock_segment = mocker.MagicMock()
    mock_segment.text = "hello world"
    mock_model.transcribe.return_value = ([mock_segment], None)
    mocker.patch("voice_dani.audio_handler._load_model", return_value=mock_model)

def test_transcribe_returns_text(mock_whisper):
    from voice_dani.audio_handler import transcribe
    audio = b"\x00\x00" * 16000  # 1 second of silence at 16kHz PCM16
    result = transcribe(audio)
    assert result == "hello world"

def test_transcribe_short_audio_returns_empty(mock_whisper):
    from voice_dani.audio_handler import transcribe
    audio = b"\x00\x00" * 800  # < 1600 samples
    result = transcribe(audio)
    assert result == ""

# Strategy B: Pre-recorded real audio fixture (one-time, for regression)
# Generate a 1-second sine sweep at 16kHz PCM16
@pytest.fixture(scope="session")
def real_test_audio():
    import numpy as np
    t = np.linspace(0, 1, 16000, endpoint=False)
    sweep = np.sin(2 * np.pi * 440 * t) * 0.5  # 440Hz tone
    # Clip and convert to PCM16
    sweep = np.clip(sweep, -1, 1)
    return (sweep * 32767).astype(np.int16).tobytes()
```

**TTS (`tts`)** — mock the subprocess:

```python
def test_tts_empty_text_returns_empty(mocker):
    from voice_dani.audio_handler import tts
    assert tts("") == b""
    assert tts("   ") == b""

def test_tts_parses_aiff_ssnd_chunk(mocker):
    # Build a valid AIFF-like byte buffer with an SSND chunk
    from voice_dani.audio_handler import tts
    ssnd_payload = b"\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04"
    aiff_header = b"FORM\x00\x00\x00\x14AIFF"  # minimal valid header
    fake_aiff = aiff_header + b"SSND\x00\x00\x00\x10" + b"\x00" * 8 + ssnd_payload

    mocker.patch("subprocess.run", return_value=mocker.MagicMock(returncode=0))
    mocker.patch("tempfile.NamedTemporaryFile", ...)
    mocker.patch("builtins.open", mock_open(read_data=fake_aiff))

    result = tts("hello")
    assert result == ssnd_payload
```

**Resample helpers** — pure numpy, no mocks needed:

```python
def test_resample_downsample():
    from voice_dani.audio_handler import _resample
    import numpy as np
    # 1 second at 48kHz
    audio = np.sin(np.linspace(0, 2 * np.pi * 440, 48000, dtype=np.float32))
    down = _resample(audio, 48000, 16000)
    assert len(down) == 16000  # 1/3 length
    assert down.dtype == np.float32

def test_resample_noop():
    from voice_dani.audio_handler import _resample
    audio = np.array([0.0, 0.5, 1.0], dtype=np.float32)
    result = _resample(audio, 16000, 16000)
    assert np.allclose(audio, result)

def test_pcm16_to_f32():
    from voice_dani.audio_handler import _pcm16_to_f32
    import numpy as np
    pcm = np.array([0, 16384, -16384, 32767, -32768], dtype=np.int16)
    f32 = _pcm16_to_f32(pcm.tobytes())
    assert f32.dtype == np.float32
    assert abs(f32[0]) < 0.000001     # 0 → 0
    assert f32[1] == pytest.approx(0.5, abs=1e-3)  # 16384 → 0.5
    assert f32[4] == pytest.approx(-1.0, abs=1e-3) # -32768 → -1.0
```

### What to assert

- `transcribe`: empty audio → `""`, normal audio → transcribed text, short audio → `""`
- `tts`: empty text → `b""`, `say` failure → `b""`, valid AIFF → raw PCM, timeout → `b""`
- `_resample`: same rate → identity, 48→16kHz → correct length, preserves shape/dtype
- `_pcm16_to_f32`: 0 → ~0.0, 16384 → ~0.5, -32768 → -1.0
- `run_agent`: yields tokens from stdout, handles missing binary, handles JSON parse errors

### Common pitfalls

- **Real audio in CI**: Don't. CI machines lack microphones (and ears). Always mock the model.
  - Exception: one smoke test with pre-recorded raw PCM16 committed to the repo.
- **Mocking `_load_model`** has global state (`_model`). Use `mocker.patch` with `autospec=True` and clean up in a fixture.
- **`say` command**: macOS-only. Tests must `@pytest.mark.skipif(not shutil.which("say"))`.
- **NumPy floating-point drift**: Use `pytest.approx()` for resample comparisons, never `==`.
- **Async `run_agent`**: Must use `pytest.mark.asyncio` and collect generator with `[tok async for tok in run_agent("hi")]`.

### Best practices

- **One synthetic audio fixture** (`scope="session"`) for all STT-related tests: 1s sine sweep at 16kHz in PCM16.
- **Refactor first**: extract `_pcm16_to_f32`, `_resample` into pure functions (already done). Add `transcribe` wrapper if needed for easier mocking.
- **Never test the model accuracy** in unit tests. That's an evaluation benchmark, not a unit test.
- **Cover the I/O boundary, not the algorithm**. Test that `transcribe` calls `_load_model().transcribe()`, not that whisper outputs correct text.

---

## 3. WebSocket Testing

### Recommended tools

| Tool | Role |
|------|------|
| `websockets` (library) | Already a dependency. Use for WS client in tests. |
| `httpx` | For HTTP pairing before WS. Already installed. |
| `pytest-asyncio` | Already configured with `asyncio_mode = "auto"`. |
| `asyncio.wait_for` | Timeout guard for WS message assertions. |

### Test structure

```python
class TestWebSocketSendAudio:
    """Core WebSocket tests that actually send audio bytes."""

    @pytest.mark.asyncio
    async def test_send_audio_silence_returns_transcript(self, server_url, valid_token):
        """Send PCM16 silence → server should respond with state/idle (no transcript for silence)."""
        uri = f"ws://127.0.0.1:{PORT}/ws?token={valid_token}"
        async with websockets.connect(uri) as ws:
            # Drain info + state messages
            info = json.loads(await asyncio.wait_for(ws.recv(), timeout=3))
            assert info["type"] == "info"

            state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3))
            assert state == {"type": "state", "value": "idle"}

            # Send a frame: 1-byte header (0x00) + PCM16 silence
            silence = b"\x00" + b"\x00\x00" * 4800  # 100ms of silence at 48kHz
            await ws.send(silence)

            # Should stay connected; may or may not respond (silence is < 3 chars)
            # Just verify no crash and connection is alive
            still_open = await asyncio.wait_for(ws.recv(), timeout=2)
            assert still_open is not None

    @pytest.mark.asyncio
    async def test_audio_without_token_rejected(self, server_url):
        uri = f"ws://127.0.0.1:{PORT}/ws"
        with pytest.raises(websockets.exceptions.ConnectionClosed):
            async with websockets.connect(uri) as ws:
                await ws.send(b"\x00" + b"\x00\x00" * 4800)

    @pytest.mark.asyncio
    async def test_rapid_messages_handled(self, server_url, valid_token):
        """Send multiple frames quickly — no crash, no memory blow."""
        uri = f"ws://127.0.0.1:{PORT}/ws?token={valid_token}"
        async with websockets.connect(uri) as ws:
            for _ in range(2):
                await asyncio.wait_for(ws.recv(), timeout=3)  # drain init
            # Fire 5 fast audio frames (without waiting for response)
            frame = b"\x00" + b"\x00\x00" * 4800
            for _ in range(5):
                await ws.send(frame)
            # Server should still be responsive
            try:
                resp = await asyncio.wait_for(ws.recv(), timeout=2)
                assert resp is not None
            except asyncio.TimeoutError:
                pass  # Connection alive = pass
```

### What to assert

- **Connect/reject**: Valid token → `info` message; invalid/missing → close code 4401
- **Audio bytes accepted**: Server doesn't crash on PCM16 frames
- **Text messages**: Server echoes/replies appropriately (or stays alive)
- **Disconnect handling**: Server recovers when client disconnects mid-session
- **Barge-in**: Send `{"type": "barge_in"}` → server resets state

### Common pitfalls

- **Server startup race**: The current test launches uvicorn in a thread with `time.sleep(1.5)`. This is fragile. Use a readiness probe instead: `httpx.get(...)` in a retry loop.
- **WS message framing**: The `websockets` library returns one complete message. The audio handler expects raw bytes with a 1-byte header. The test must format them correctly.
- **asyncio `wait_for` vs `TimeoutError`**: Always wrap WS receive in `wait_for` or tests hang forever on failed connections.
- **No assumption about STT output for silence**: Whisper may return `","` or garbage for silence. Don't assert `transcript` type; assert the connection stays alive.

### Best practices

- **Use `scope="session"` server fixture** (already done) to start uvicorn once.
- **Add a `valid_token` fixture** that creates + redeems a PIN, so tests don't repeat that logic.
- **Test close codes**: Use `pytest.raises` with the specific exception type (`ConnectionClosed` with `code=4401`).
- **Timeout all WS reads**: Never let `ws.recv()` block without a `wait_for`.

---

## 4. Integration Testing

### Recommended tools

| Tool | Role |
|------|------|
| `pytest` + `pytest-asyncio` | Async test runner |
| `httpx` | HTTP client for server REST API |
| `websockets` | WS client for audio relay |
| `subprocess` | Manage server lifecycle in CI |

### Full pipeline test without a real phone

```python
class TestFullAudioPipeline:
    """End-to-end: create PIN → redeem → WS connect → send audio → receive response."""

    @pytest.mark.asyncio
    async def test_send_audio_receive_tts_pcm(self, server_url, mocker):
        """Full relay test with mocked STT and agent."""
        # --- Layer 1: Mock STT (so we don't need real whisper) ---
        mock_segment = mocker.MagicMock()
        mock_segment.text = "what time is it"
        mock_model = mocker.MagicMock()
        mock_model.transcribe.return_value = ([mock_segment], None)
        mocker.patch("voice_dani.audio_handler._load_model", return_value=mock_model)

        # --- Layer 2: Mock agent (so we don't call real OpenCode CLI) ---
        async def fake_agent(*args, **kwargs):
            yield "I don't have a watch, but the server time is: "

        mocker.patch("voice_dani.audio_handler.run_agent", fake_agent)

        # --- Layer 3: Mock TTS (so we don't need `say`) ---
        fake_pcm = b"\x00\x00" * 48000  # 1 second of silence at 48kHz
        mocker.patch("voice_dani.audio_handler.tts", return_value=fake_pcm)

        # --- Proceed with real WS connection ---
        p = httpx.post(f"{server_url}/api/pair/create").json()["pin"]
        token = httpx.post(f"{server_url}/api/pair/redeem", json={"pin": p}).json()["session_token"]
        uri = f"ws://127.0.0.1:{PORT}/ws?token={token}"

        async with websockets.connect(uri) as ws:
            # Drain init messages
            for _ in range(2):
                await asyncio.wait_for(ws.recv(), timeout=3)

            # Send real PCM16 audio (sine sweep)
            sweep_pcm = _generate_test_audio(48000)  # 1s at 48kHz
            await ws.send(b"\x00" + sweep_pcm)

            # Expect transcript from mocked STT
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            assert msg["type"] == "transcript"
            assert "time" in msg["text"].lower()

            # Expect state: responding
            state = json.loads(await asyncio.wait_for(ws.recv(), timeout=3))
            assert state == {"type": "state", "value": "responding"}

            # Expect TTS audio frame (binary)
            audio_msg = await asyncio.wait_for(ws.recv(), timeout=5)
            assert isinstance(audio_msg, bytes)
            assert len(audio_msg) > 4

            # Expect response text
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            assert resp["type"] == "response"

            # Expect idle state
            idle = json.loads(await asyncio.wait_for(ws.recv(), timeout=3))
            assert idle == {"type": "state", "value": "idle"}
```

### What to assert

- Complete message sequence: `info → state(idle) → transcript → state(responding) → audio bytes → response → state(idle)`
- Audio frame format: 4-byte big-endian length prefix + PCM16 data
- Server handles all three input types: audio bytes, text JSON, barge-in JSON
- Server recovers from exceptions (the `except` in `websocket_relay`)

### Common pitfalls

- **Real agent CLI missing in CI**: OpenCode/Claude Code won't be installed. Always mock `run_agent`.
- **Real TTS (say) missing on Linux CI**: Always mock `tts`. Only test real `say` on macOS with `@pytest.mark.skipif`.
- **Global whisper state leakage**: `_model` is a module-level global. Mock it per-test or tests leak across runs.
- **Thread + asyncio mixing**: The current `server_url` fixture runs uvicorn in a thread. `pytest-asyncio` runs in the main thread's event loop. This works but the server fixture must be `scope="module"` to avoid recreating threads per test.

### Best practices

- **Replace thread-based server** with `TestClient` from Starlette for most tests. Keep the real-thread fixture only for WebSocket byte-level tests. This cuts test time from seconds to milliseconds.

```python
# FastAPI TestClient approach (fast, for non-WS tests)
from fastapi.testclient import TestClient

@pytest.fixture
def client():
    from voice_dani.server import app
    with TestClient(app) as c:
        yield c

def test_create_pin_fast(client):
    resp = client.post("/api/pair/create")
    assert resp.status_code == 200
```

- **Keep one real-server fixture** (`scope="session"`) for the WebSocket audio frame tests that need real byte-level relay.
- **Test error paths**: Invalid PIN, expired token, malformed audio, oversized message, concurrent disconnect.

---

## 5. Performance Testing

### Recommended tools

| Tool | Role |
|------|------|
| `pytest-benchmark` | Calibrated timing assertions in pytest |
| `time.perf_counter` | Lightweight manual instrumentation |
| `asyncio` event loop | Measure async latency |
| Structured logging | Already planned in `observability.py` |

### What to measure

| Metric | Target | Measurement point |
|--------|--------|-------------------|
| STT latency | <600ms | `transcribe()` wall time |
| TTS latency | <700ms | `tts()` wall time |
| Resample latency | <50ms | `_resample()` wall time |
| WS frame relay latency | <100ms | Byte in → byte out |
| End-to-end STT→audio | <1.5s | `handle_audio()` per-turn time |
| Memory usage | <500MB | `psutil` before/after |

### Test structure

```python
@pytest.mark.benchmark
def test_stt_latency(benchmark, mock_whisper):
    from voice_dani.audio_handler import transcribe
    audio = b"\x00\x00" * 48000  # 3 seconds of PCM16 silence

    # benchmark() calls the function many times and reports min/avg/max
    result = benchmark(transcribe, audio)
    assert result is not None

def test_pipeline_latency_manual(server_url, valid_token, mocker):
    """Manual timing with time.perf_counter for async operations."""
    import time

    # Mock STT to return immediately
    mock_segment = mocker.MagicMock()
    mock_segment.text = "hello world"
    mock_model = mocker.MagicMock()
    mock_model.transcribe.return_value = ([mock_segment], None)
    mocker.patch("voice_dani.audio_handler._load_model", return_value=mock_model)

    # Mock agent
    async def fast_agent(*args, **kwargs):
        yield "Hello back"
    mocker.patch("voice_dani.audio_handler.run_agent", fast_agent)

    # Mock TTS
    mocker.patch("voice_dani.audio_handler.tts", return_value=b"\x00\x00" * 24000)

    # Measure WS round-trip
    uri = f"ws://127.0.0.1:{PORT}/ws?token={valid_token}"
    async def measure():
        async with websockets.connect(uri) as ws:
            for _ in range(2):
                await asyncio.wait_for(ws.recv(), timeout=3)
            t0 = time.perf_counter()
            await ws.send(b"\x00" + b"\x00\x00" * 48000)
            # Wait for transcript (first response)
            await asyncio.wait_for(ws.recv(), timeout=10)
            t1 = time.perf_counter()
            return t1 - t0

    latency = asyncio.run(measure())
    assert latency < 2.0, f"STT→response took {latency:.3f}s"
```

### Common pitfalls

- **Benchmark with mocked STT tells you about overhead, not model speed**. That's fine — model speed is an evaluation concern.
- **First call is slow** (model loading, Python JIT warmup). Benchmark the 2nd–11th calls with `benchmark.pedantic`.
- **Timers in async code**: Use `time.perf_counter()` (not `time.time()`) for sub-millisecond precision.
- **CI machines are noisy**: Set generous thresholds (2x the target) in CI. Use tighter thresholds for local `--benchmark-only` runs.

### Best practices

- **Commit a `benchmarks/` directory** with `pytest-benchmark` config that outputs JSON for trend tracking.
- **Tag latency-critical tests** with `@pytest.mark.benchmark` and exclude them from the default `pytest` run.
- **Store baseline results in `benchmarks/baseline.json`** and compare in CI.
- **Use `asyncio.to_thread` latency** for `transcribe()` — this is the main async sync-point and a source of variability.

---

## 6. Load Testing

### Recommended tools

| Tool | Role |
|------|------|
| `asyncio` + raw websockets | Simulate concurrent clients without external tools |
| `locust` (optional) | Full load testing framework with WebSocket support |
| `psutil` | Monitor CPU/memory during load |

### Test structure (pure asyncio)

```python
@pytest.mark.asyncio
async def test_10_concurrent_connections(server_url):
    """Open 10 WS connections simultaneously. All should stay alive."""
    # Create 10 tokens
    tokens = []
    for _ in range(10):
        p = httpx.post(f"{server_url}/api/pair/create").json()["pin"]
        token = httpx.post(f"{server_url}/api/pair/redeem", json={"pin": p}).json()["session_token"]
        tokens.append(token)

    # Connect all at once
    async def connect_and_keep_alive(token):
        uri = f"ws://127.0.0.1:{PORT}/ws?token={token}"
        try:
            async with websockets.connect(uri, close_timeout=5) as ws:
                for _ in range(2):
                    await asyncio.wait_for(ws.recv(), timeout=3)
                await ws.send(b"\x00" + b"\x00\x00" * 4800)
                return True
        except Exception:
            return False

    results = await asyncio.gather(*[connect_and_keep_alive(t) for t in tokens])
    assert all(results), f"Only {sum(results)}/{len(tokens)} connections succeeded"

@pytest.mark.asyncio
async def test_concurrent_audio_doesnt_crash(server_url):
    """10 connections sending audio simultaneously. No crash, no memory leak."""
    tokens = []
    for _ in range(10):
        p = httpx.post(f"{server_url}/api/pair/create").json()["pin"]
        token = httpx.post(f"{server_url}/api/pair/redeem", json={"pin": p}).json()["session_token"]
        tokens.append(token)

    audio_frame = b"\x00" + b"\x00\x00" * 48000  # 1s of silence

    async def hammer(token):
        uri = f"ws://127.0.0.1:{PORT}/ws?token={token}"
        try:
            async with websockets.connect(uri, close_timeout=5) as ws:
                for _ in range(2):
                    await asyncio.wait_for(ws.recv(), timeout=3)
                for _ in range(5):
                    await ws.send(audio_frame)
                    await asyncio.sleep(0.01)
                return True
        except Exception:
            return False

    results = await asyncio.gather(*[hammer(t) for t in tokens])
    assert sum(results) > len(tokens) * 0.8  # 80%+ success rate
```

### With locust (dedicated load testing)

```python
# tests/locustfile.py
from locust import HttpUser, task, between
import websockets
import asyncio

class VoiceDaniUser(HttpUser):
    wait_time = between(1, 3)

    def on_start(self):
        resp = self.client.post("/api/pair/create")
        pin = resp.json()["pin"]
        resp = self.client.post("/api/pair/redeem", json={"pin": pin})
        self.token = resp.json()["session_token"]

    @task
    def connect_and_send_audio(self):
        async def run():
            uri = f"ws://localhost:7860/ws?token={self.token}"
            async with websockets.connect(uri) as ws:
                await asyncio.wait_for(ws.recv(), timeout=5)
                await ws.send(b"\x00" + b"\x00\x00" * 48000)
        asyncio.run(run())
```

### What to assert

- **Connection success rate**: >95% under N concurrent connections
- **No crash**: Server process stays alive after load (monitor with `psutil.pid_exists`)
- **Memory stability**: RSS doesn't grow unbounded across connection cycles (leak detection)
- **Response within timeout**: Every connection gets `info` + `state` within 3 seconds
- **Socket exhaustion**: Test with 100+ connections to verify file descriptor limits

### Common pitfalls

- **OS file descriptor limit**: macOS defaults to 256. Tests with 100+ connections may need `ulimit -n 4096`.
- **Port exhaustion**: Each WS client uses an ephemeral port. Reuse tokens/connections.
- **Test server and load client on same machine**: The server's CPU competes with the client. For real numbers, separate machines.
- **`asyncio.gather` with 100 coroutines**: Works but the event loop slows. Batch in groups of 20 with `asyncio.Semaphore(20)`.

### Best practices

- **Start simple**: A 10-line asyncio script tells you more than setting up Locust for the first iteration.
- **Monitor RSS memory** before/during/after load with `psutil.Process().memory_info().rss`.
- **Run load tests in a separate `@pytest.mark.load` marker**, excluded from default.
- **Set `close_timeout` on websockets** to avoid hanging tests when server is overwhelmed.

---

## 7. Security Testing

### Threat model

| Threat | Vector | Impact | Current defense |
|--------|--------|--------|-----------------|
| PIN brute-force | Repeated POST to `/api/pair/redeem` | Unauthorized session access | None in code. Backstop: Cloudflare WAF |
| Session token theft | Network sniffing, XSS | Persistent access (24h TTL) | TLS (if tunnel), 256-bit random token |
| WS token reuse | Intercept valid WS connection | Piggyback on active session | Single-use? No — token verified but not consumed |
| DoS via audio flood | Rapid WS audio frames | CPU exhaustion (STT is expensive) | None |
| Agent CLI injection | Crafted audio transcribed to shell commands | Arbitrary code execution | None (agent CLI receives text) |

### Recommended tools

| Tool | Role |
|------|------|
| `pytest` | Standard test runner |
| `hypothesis` | Property-based fuzzing for PIN inputs |
| `time` | Rate limit timing measurements |
| `asyncio` | Concurrent brute-force simulation |

### Test structure

```python
class TestSecurity:
    @pytest.mark.asyncio
    async def test_pin_brute_force_blocked(self, server_url):
        """Attempt 100 invalid PINs in rapid succession. Server should block or slow down."""
        start = time.perf_counter()
        attempts = 100
        successes = 0

        for _ in range(attempts):
            resp = httpx.post(f"{server_url}/api/pair/redeem", json={"pin": "000000"})
            if resp.status_code == 200:
                successes += 1

        elapsed = time.perf_counter() - start

        # Either rate-limited (took > 5s for 100 attempts) or all rejected
        assert successes == 0, f"{successes}/{attempts} invalid PINs were accepted"
        # If no explicit rate limit, check that 100 attempts took reasonable wall time
        # (not instant — at minimum Python overhead)
        assert elapsed > 0.5, f"100 attempts in {elapsed:.3f}s — too fast, no rate limit"

    @pytest.mark.asyncio
    async def test_token_reuse_prevented(self, server_url):
        """A session token should be usable for only one WS connection at a time."""
        p = httpx.post(f"{server_url}/api/pair/create").json()["pin"]
        token = httpx.post(f"{server_url}/api/pair/redeem", json={"pin": p}).json()["session_token"]

        # First connection succeeds
        uri = f"ws://127.0.0.1:{PORT}/ws?token={token}"
        async with websockets.connect(uri) as ws1:
            await asyncio.wait_for(ws1.recv(), timeout=3)

            # Second connection with same token should be rejected
            with pytest.raises(websockets.exceptions.ConnectionClosed):
                async with websockets.connect(uri) as ws2:
                    await asyncio.wait_for(ws2.recv(), timeout=3)

    @pytest.mark.asyncio
    async def test_pin_ttl_enforced(self, server_url, mocker):
        """PIN should expire after TTL."""
        import time
        from voice_dani.pairing import PairingManager

        mocker.patch.object(PairingManager, "PIN_TTL", 0)  # Expire immediately
        p = httpx.post(f"{server_url}/api/pair/create").json()["pin"]
        await asyncio.sleep(0.1)  # Let TTL lapse
        resp = httpx.post(f"{server_url}/api/pair/redeem", json={"pin": p})
        assert resp.status_code == 401

    def test_pin_format_accepted(self):
        """PIN must be exactly 6 digits. Property-based test."""
        from hypothesis import given, strategies as st
        from voice_dani.pairing import PairingManager

        pm = PairingManager()

        @given(st.text(min_size=1, max_size=10))
        def test_redeem_random_strings(pin_attempt):
            result = pm.redeem(pin_attempt)
            # Should not crash on any input. Returns None for invalid.
            assert result is None or isinstance(result, str)

        test_redeem_random_strings()
```

### What to assert

- 100 invalid PINs → 100x 401, not a single 200
- Token reuse → second WS connection rejected (code 4401)
- PIN expiry: POST after TTL → 401
- Malformed PIN payload (missing `pin` key, wrong types) → 422 or 401, never 500
- Large payloads (100KB+ JSON) → rejected gracefully (FastAPI has default limits)
- Audio payloads > 10MB → rejected (WS message size limit)

### Common pitfalls

- **Rate limiting not implemented yet**: Security tests will fail (soft). Document expected behavior; make tests `@pytest.mark.skipif` with a note next to the rate-limiting issue.
- **WAF is not testable locally**: Cloudflare WAF rate limiting is a production concern. The test suite should verify the *application-level* defense, assuming WAF is a backstop.
- **Token reuse**: Currently `verify()` is purely TTL-based. It doesn't consume the token. A second WS connection with the same token succeeds. This may be by design (browser reconnects). If intended, document it. If not, fix it.

### Best practices

- **Never assert that `PairingManager` "probably won't" have collisions** — test with a `@given` from hypothesis the property that `create_pin()` always returns a unique 6-digit string.
- **Test the auth boundary, not the crypto**: `secrets.token_urlsafe(32)` is 256-bit. Test that the interface rejects bad tokens, not that the entropy is sufficient.
- **Session fixation**: After PIN redemption, the old PIN must be invalidated (currently done via `pop`). Test this: redeem same PIN twice → second fails.
- **Add a `@pytest.mark.security` marker** to exclude from default test runs; include in nightly CI.

---

## 8. Frontend Testing

### Recommended tools

| Tool | Role |
|------|------|
| **Playwright** | Browser automation — ideal for WebSocket + MediaRecorder flows |
| `@playwright/test` | JS test runner with `expect` matchers |
| `pytest-playwright` | Python wrapper if you prefer pytest |
| `node:test` or Vitest | Lightweight for pure JS logic testing |

### Why Playwright

- Can open real browser pages (Chrome, Safari, Firefox)
- Can intercept WebSocket messages (`page.routeWebSocket`)
- Can mock `navigator.mediaDevices.getUserMedia` (fake microphone input)
- Can test mobile viewport (`iPhone 14` preset)
- Can run headless on CI

### Test structure

```typescript
// tests/frontend/ws-relay.spec.ts
import { test, expect } from '@playwright/test';

test.describe('PIN entry and WebSocket connection', () => {
  test('shows PIN screen on load', async ({ page }) => {
    await page.goto('http://localhost:7860/');
    await expect(page.locator('#pin-screen')).toBeVisible();
    await expect(page.locator('#live-screen')).toBeHidden();
  });

  test('enables connect button when all 6 digits entered', async ({ page }) => {
    await page.goto('http://localhost:7860/');
    const inputs = page.locator('.pin-digit');
    for (let i = 0; i < 6; i++) {
      await inputs.nth(i).fill(`${i}`);
    }
    await expect(page.locator('#connect-btn')).toBeEnabled();
  });

  test('displays error on invalid PIN', async ({ page }) => {
    // Mock the redeem API to return 401
    await page.route('**/api/pair/redeem', (route) => {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Invalid or expired PIN' }),
      });
    });

    await page.goto('http://localhost:7860/');
    const inputs = page.locator('.pin-digit');
    for (let i = 0; i < 6; i++) {
      await inputs.nth(i).fill(`${i}`);
    }
    await page.locator('#connect-btn').click();
    await expect(page.locator('#pin-error')).toHaveText('Invalid or expired PIN');
  });

  test('connects via WebSocket with valid token', async ({ page }) => {
    // Mock API responses
    await page.route('**/api/pair/redeem', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session_token: 'test-token-12345' }),
      });
    });

    // Mock getUserMedia (mic permission)
    await page.context().grantPermissions(['microphone']);

    await page.goto('http://localhost:7860/');
    const inputs = page.locator('.pin-digit');
    for (let i = 0; i < 6; i++) {
      await inputs.nth(i).fill(`${i}`);
    }
    await page.locator('#connect-btn').click();
    // Should transition to live screen
    await expect(page.locator('#live-screen')).toBeVisible({ timeout: 5000 });
  });

  test('receives and renders chat messages', async ({ page }) => {
    // Intercept WebSocket to simulate server messages
    await page.routeWebSocket('**/ws*', (ws) => {
      ws.send(JSON.stringify({ type: 'info', text: 'Connected' }));
      ws.send(JSON.stringify({ type: 'state', value: 'idle' }));
    });

    await page.goto('http://localhost:7860/');
    // ... fill PIN, connect ...
    const chat = page.locator('#chat');
    await expect(chat).toContainText('Connected');
  });
});
```

### What to assert

- **PIN screen**: 6 input fields rendered, focused on mount, digit-only input enforced
- **PIN paste**: 6-digit paste fills all fields, targets correct input
- **Connect button**: disabled until 6 digits, shows "Connecting…" during attempt
- **Error handling**: invalid PIN → error text visible; connection failure → retry button enabled
- **WS message parsing**: transcript → user message appended; response → agent message appended; state → orb + status text updated
- **Audio playback**: AudioContext created on interaction; PCM16 frames decoded and played
- **Disconnect**: cleanup → PIN screen shown, mic stopped, `localStorage` cleared, orb reset
- **Session persistence**: `localStorage` token reloaded on page re-entry (skip PIN if valid)

### Mobile-specific

- **Viewport meta**: `width=device-width, initial-scale=1` renders correctly on iPhone/Android emulation
- **Touch events**: Tap-to-unlock, tap-to-barge work on touch without hover dependency
- **MediaRecorder**: Verify `audio/webm;codecs=opus` MIME type is supported (fallback path if not)
- **AudioContext unlock**: The `unlockAudio()` path must work — test with `page.context().grantPermissions(['microphone'])`

### Common pitfalls

- **`getUserMedia` in headless**: Playwright requires `--use-fake-ui-for-media-stream` and `--use-fake-device-for-media-stream` Chrome flags. These are needed for mic simulation.
- **WebSocket mocking in Playwright**: `page.routeWebSocket` is the right API but requires Playwright 1.40+. For older versions, mock at the server level.
- **AudioContext in headless**: Browsers may not fully support Web Audio API in headless mode. Use `headless: false` or test with `chromium.launch({ channel: 'chrome' })`.
- **Mobile emulation**: Playwright's `iPhone 14` device preset is good but doesn't emulate all Safari quirks. Supplement with physical device testing for audio paths.

### Best practices

- **Mock the server layer** (HTTP + WS), not the transport. Tests should run against mock data in Playwright, not against a real FastAPI server.
- **Use Playwright's `trace viewer`** for debugging flaky frontend tests: `--trace on`.
- **Keep JS logic tests separate** from browser tests. Use Vitest for pure function tests (`$`, `setOrbState`, `showScreen`).
- **Test error paths explicitly**: WS disconnect at each stage (before connect, mid-conversation), API 500, mic permission denied (assert graceful degradation).

---

## 9. CI/CD Integration

### Recommended setup

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]

jobs:
  test-backend:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.11", "3.12", "3.13"]

    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v4

      - name: Set up Python ${{ matrix.python-version }}
        uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}

      - name: Install dependencies
        run: uv sync --group dev

      - name: Lint
        run: uv run ruff check voice_dani web tests

      - name: Type check
        run: uv run mypy voice_dani

      - name: Run tests
        run: uv run pytest -x --cov=voice_dani --cov-report=xml --cov-report=term
        env:
          CI: "true"

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          file: ./coverage.xml

  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Install Playwright
        run: |
          npm init -y
          npm install @playwright/test
          npx playwright install chromium

      - name: Start server
        run: |
          uv sync --group dev
          uv run uvicorn voice_dani.server:app --host 127.0.0.1 --port 7860 &
          sleep 3

      - name: Run frontend tests
        run: npx playwright test tests/frontend/
```

### Phase-in plan

```
Week 1 (P0):
  - [x] Create `.github/workflows/test.yml` with Python lint + type-check + pytest
  - [ ] Make it PASS on every push

Week 2 (P1):
  - [ ] Add `pytest-cov` and Codecov badge to README
  - [ ] Add security test job (nightly, not blocking PRs initially)
  - [ ] Add `pytest --benchmark-only` job (weekly)

Week 3 (P2):
  - [ ] Add frontend Playwright tests
  - [ ] Add load test job (manual trigger only)
```

### Pre-commit hooks

Add to `Makefile` and wire with `pre-commit`:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.7.0
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.13
    hooks:
      - id: mypy
        additional_dependencies: [types-all]
```

### Marker policy

```ini
# pyproject.toml
[tool.pytest.ini_options]
markers =
    slow: tests that take >10s
    benchmark: performance/latency tests
    security: security boundary tests
    load: concurrent connection tests
    network: tests requiring external services
```

Default CI runs: `pytest -x --ignore=tests/benchmarks -m "not benchmark and not load"`
Nightly CI runs: `pytest -x --benchmark-only`
Security run: `pytest -x -m security`

---

## Summary: The One-Page Concierge Sheet

```
                    NOW (P0, 1-2 days)                SOON (P1, 1.5 days)              LATER (P2-3, 2 days)
                    ─────────────────                 ─────────────────                ─────────────────
UNIT TESTS          audio_handler.py:                 run_agent.py:                    _observability.py:
                    _resample, _pcm16_to_f32,         mock subprocess,                 structured log parsing
                    transcribe (mocked),              test JSON parsing,
                    tts (mocked)                      test fallback binary

INTEGRATION         TestClient for REST               Mocked full pipeline              E2E with real audio
                    WS connect/reject +                (STT→agent→TTS).                 (committed .wav fixture)
                    byte-level audio send              Assert message sequence

PERFORMANCE         ─                                 1st benchmark of                   pytest-benchmark
                    (deferred: mock first)             transcribe + tts                  tracking in CI

SECURITY            ─                                 PIN brute-force test              Hypothesis fuzz
                    (deferred: needs rate limit)       Token reuse test                  on PairingManager

LOAD                ─                                 10-concurrent-asyncio             Locust suite
                    (deferred: mock first)             test + memory monitor             (100 virtual users)

FRONTEND            ─                                 Playwright setup                  Mock WS tests,
                    (deferred: needs CI base)          + PIN screen tests                getusermedia tests

CI/CD               GitHub Actions:                    + coverage upload                 + Playwright job
                    ruff + mypy + pytest               + marker exclusions               + load/security jobs
```

---

## Next action (do first)

Edit `.env.example` to add a `CI` variable, then create `.github/workflows/test.yml` with the lint + type-check + pytest job. Run it manually with `act` or push to a branch. Once green, the rest of this strategy can layer on incrementally.
