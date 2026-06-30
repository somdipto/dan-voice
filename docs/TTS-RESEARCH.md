# TTS Options for Voice Dani

Research completed 2026-06-30. Evaluated against Voice Dani requirements: **<500ms latency**, cross-platform (macOS/Linux/Windows), offline, pip-installable, Python 3.11+, good voice quality.

---

## Comparison Table

| Criteria | **Piper TTS** | **Kokoro TTS** | **Kitten TTS** | **edge-tts** | **Coqui TTS** | **Bark (Suno)** | **Wispr** |
|---|---|---|---|---|---|---|---|
| **pip install** | `piper-tts` | `kokoro` | GitHub wheel only | `edge-tts` | `coqui-tts` | `git+https://...` | N/A (STT only) |
| **Latency (M2 Mac, CPU)** | **~150ms** ✅ | ~1,200ms ❌ | ~315ms ⚠️ | ~200ms* ✅ | ~500ms+ ❌ | 5-30s ❌❌ | N/A |
| **RTF (real-time factor)** | **0.077** (fastest) | 1.13 (slower than real-time) | 0.39 (moderate) | N/A (streaming) | 0.45 | >2.0 | N/A |
| **Voice quality** | Good (MOS 4.2) | **Excellent** (#1 Arena) | Good for size | **Excellent** (broadcast) | Very good | Excellent | N/A |
| **Offline capable** | ✅ Yes | ✅ Yes | ✅ Yes | ❌ **No** (cloud) | ✅ Yes | ✅ Yes | N/A |
| **Cross-platform** | ✅ All | ✅ All (+espeak-ng) | ✅ All | ✅ All (needs net) | ⚠️ Needs PyTorch | ⚠️ Needs GPU | N/A |
| **Dependency weight** | **Light** (ONNX) | **Heavy** (PyTorch ~2GB) | **Light** (ONNX) | **Tiny** (~31KB) | **Very heavy** (PyTorch ~2GB) | **Very heavy** (PyTorch ~2GB + 12GB VRAM) | N/A |
| **First model download** | 10-80MB | ~350MB | 25-80MB | None (streaming) | ~1-2GB | ~12GB | N/A |
| **RAM at inference** | ~150MB | ~500MB+ | ~100MB | ~50MB | ~800MB+ | ~12GB+ | N/A |
| **Voices** | 100+ (30+ langs) | 54 (8 langs) | 8 (English only) | 400+ (100+ langs) | 1100+ langs | Multilingual | N/A |
| **License** | GPL-3.0 (was MIT) | Apache 2.0 | Apache 2.0 | MIT (wrapper) | MPL-2.0 | MIT | N/A |
| **GitHub stars** | 11k+ | 7.5k+ | 14k+ | 10k+ | 2.2k (fork) | 36k+ | N/A |
| **Last commit** | Apr 2026 ✅ | Aug 2025 ✅ | Jun 2026 ✅ | Mar 2026 ✅ | Jun 2026 ✅ | Apr 2023 ❌ | N/A |
| **Active maintenance** | ✅ (OHF fork) | ✅ (very active) | ✅ (very active, preview) | ✅ | ✅ (community fork) | ❌ Abandoned | N/A |
| **Known issues** | GPL license change; old repo archived | Needs PyTorch + espeak-ng; slow on CPU alone | Not on PyPI; preview quality; 8 voices only | **Requires internet**; unofficial MS endpoint | Company shut down; very heavy | Needs GPU; abandoned; massive | N/A |

\* edge-tts latency is network-dependent. Actual first-byte time on a good connection is ~200-400ms, but this is NOT offline.

---

## Detailed Analysis

### 1. Piper TTS — BEST MATCH ⭐
- **Stars**: 11,163 (rhasspy/piper, archived Oct 2025) → active fork at OHF-Voice/piper1-gpl
- **pip**: `pip install piper-tts`
- **Speed**: 0.15s on M2 MacBook Pro CPU — fastest of all options. 0.53s on Raspberry Pi 5. RTF 0.077-0.15.
- **Quality**: MOS 4.2-4.3. Not as natural as Kokoro or edge-tts, but very good.
- **Matches current code**: Output is 22050 Hz PCM16 — exactly the `PIPER_RATE = 22050` already defined in `audio_handler.py`. Drop-in replacement.
- **Already in pyproject.toml** as `[project.optional-dependencies] tts-piper = ["piper-tts>=1.3.0"]`.
- **License note**: Original rhasspy/piper was MIT. The current active fork is GPL-3.0. Verify license compatibility.
- **Dependencies**: ONNX Runtime (~50MB), bundled espeak-ng. No GPU needed. Very light.

### 2. Kokoro TTS — BEST QUALITY OFFLINE
- **Stars**: 7,564 (hexgrad/kokoro), 2,400 (kokoro-onnx)
- **pip**: `pip install kokoro soundfile` + system `espeak-ng`
- **Speed**: 1.2s on M2 MacBook Pro CPU (ONNX). RTF > 1.0 on CPU — doesn't meet <500ms requirement.
- **Quality**: **Best offline quality**. #1 on TTS Spaces Arena leaderboard. 82M params. Apache 2.0.
- **Downsides**: Needs PyTorch (~2GB install) unless using ONNX version. CPU inference is too slow for real-time conversation. Additional espeak-ng system dependency.
- **ONNX version**: `kokoro-onnx` package exists (2.4k stars) with ~80MB quantized model, but still slower than Piper on CPU.

### 3. Kitten TTS — PROMISING BUT IMMATURE
- **Stars**: 14,180
- **Stars**: 14,180
- **pip**: `pip install <github-release-wheel>` — NOT on PyPI
- **Speed**: ~315ms initial latency, ~5x real-time on CPU. Close to the 500ms target.
- **Quality**: Good for model size, but only 8 English voices. Developer preview (v0.8.1).
- **Downsides**: Not on PyPI (install from git release URL). Developer preview — APIs unstable. Limited to English. Quality doesn't match Piper or Kokoro.
- **Best for**: Edge deployment (Raspberry Pi Zero, embedded). Good future candidate once mature.

### 4. edge-tts — CLOUD-BASED (NOT OFFLINE)
- **Stars**: 10,451
- **pip**: `pip install edge-tts`
- **Speed**: Very fast (streaming). First audio in ~200-400ms over good connection.
- **Quality**: **Excellent** — Microsoft Neural voices (Ava, Guy, etc.) — broadcast quality.
- **Downsides**: **Requires internet**. Calls unofficial Microsoft endpoint that could break at any time.
- **Verdict**: Eliminated by offline requirement, but worth noting as a fallback for highest quality when online.

### 5. Coqui TTS — TOO HEAVY
- **Stars**: 2,227 (idiap fork, original abandoned)
- **pip**: `pip install coqui-tts` (NOT `TTS`)
- **Speed**: RTF 0.45 on Pi — 3x slower than Piper. XTTSv2 can stream at <200ms but requires GPU.
- **Quality**: Very good with XTTSv2. But dependency cost is extreme.
- **Downsides**: Requires PyTorch (2GB+), company shut down, very heavy, complex install.
- **Verdict**: Overkill and over-weight for a real-time voice interface.

### 6. Bark — TOO SLOW, ABANDONED
- **Stars**: 36k+
- **pip**: `pip install git+https://github.com/suno-ai/bark.git`
- **Speed**: Needs 12GB VRAM for reasonable speed. Terrible on CPU. Not real-time capable.
- **Quality**: Best emotional expressiveness (laughs, cries). But unusably slow for conversation.
- **Downsides**: Abandoned by Suno (no updates since Apr 2023). Requires GPU. Massive memory.
- **Verdict**: Not suitable for Voice Dani's use case.

### 7. Wispr — NOT TTS
- "Wispr" is **Wispr Flow** — a dictation/STT tool, not TTS. There is no Wispr TTS product.
- Not relevant.

---

## Recommendation: Piper TTS ⭐

### Primary choice: Piper TTS

| Requirement | Piper meets it? |
|---|---|
| Latency < 500ms | ✅ **~150ms** on M2 Mac, ~530ms on Pi 5 |
| Cross-platform (macOS/Linux/Windows) | ✅ |
| Voice quality (natural) | ✅ MOS 4.2 (good, not perfect) |
| pip install | ✅ `pip install piper-tts` |
| Offline capable | ✅ Fully local |
| Python 3.11+ | ✅ (requires >=3.9) |

### Why Piper wins:

1. **Speed**: 0.15s on M2 Mac CPU — fastest local option by a wide margin. Kokoro is 8x slower.
2. **Already compatible**: Outputs PCM16 at 22050 Hz — exactly `PIPER_RATE = 22050` already in `audio_handler.py`. The code already has Piper's sample rate hardcoded.
3. **Already in pyproject.toml**: `tts-piper` optional dependency exists. Just needs to be promoted to default.
4. **Lightweight**: ONNX Runtime is small (~50MB). No PyTorch. No GPU needed.
5. **Proven**: Default TTS in Home Assistant. Battle-tested on Raspberry Pi.
6. **Cross-platform**: Works identically on macOS, Linux, and Windows.

### Action to adopt:

```bash
# 1. Install
pip install piper-tts

# 2. Download a voice model (~10-75MB)
# en_US-lessac-medium is a good default
# https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0/en/en_US/lessac/medium

# 3. Replace in audio_handler.py:
#    tts() function → Piper Python API
#    Remove macOS `say` command dependency
```

### If voice quality is paramount and PyTorch is acceptable:

**Kokoro TTS** (via `kokoro-onnx` for lighter install) — but expect ~1.2s latency on CPU, which exceeds the 500ms target. Would need GPU to meet latency requirements.

### If internet is available for higher quality:

**edge-tts** as a quality upgrade path — pip-installable, tiny, excellent Microsoft voices, but requires internet and uses an unofficial endpoint.

---

## Migration path for `audio_handler.py`

The current `tts()` function:
- Uses macOS `say` command (~200ms, macOS-only)
- Returns PCM16 at 22050 Hz
- Has `PIPER_RATE = 22050` already defined

Piper's Python API would replace it cleanly:
```python
# After: pip install piper-tts
import piper
import numpy as np

_voice = None

def _load_piper():
    global _voice
    if _voice is None:
        _voice = piper.PiperVoice.load("en_US-lessac-medium.onnx")
    return _voice

def tts(text: str) -> bytes:
    voice = _load_piper()
    audio_stream = voice.synthesize(text)
    # Returns PCM16 at 22050 Hz — matches existing PIPER_RATE
    return np.frombuffer(audio_stream, dtype=np.int16).tobytes()
```

No pipeline changes needed — the resampling from 22050 → 48000 already exists in `handle_audio()`.
