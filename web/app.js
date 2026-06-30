// Voice Dani — phone-side web app.
// PIN entry → WebSocket session → chat + voice.

// Register service worker for PWA
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/static/sw.js").catch(() => {});
}

const $ = (id) => document.getElementById(id);

const pinScreen = $("pin-screen");
const liveScreen = $("live-screen");
const pinInputs = Array.from(document.querySelectorAll(".pin-digit"));
const connectBtn = $("connect-btn");
const pinError = $("pin-error");
const liveOrb = $("live-orb");
const liveStatus = $("live-status");
const liveAgent = $("live-agent");
const chat = $("chat");
const textInput = $("text-input");
const sendBtn = $("send-btn");
const bargeBtn = $("barge-btn");
const disconnectBtn = $("disconnect-btn");
const newChatBtn = $("new-chat-btn");

let ws = null;
let audioCtx = null;
let micStream = null;
let isUnlocked = false;
let sessionToken = null;
let currentAgent = "Claude";
let recording = false;
let stopRecording = null;

const haptic = (pattern = "light") => {
  if (!navigator.vibrate) return;
  const patterns = { light: [10], medium: [20], heavy: [30], error: [50, 30, 50] };
  navigator.vibrate(patterns[pattern] || [10]);
};

const setOrbState = (orb, state) => {
  orb.className = `orb orb--${state}`;
};

const setPinError = (msg) => {
  pinError.textContent = msg;
  pinError.hidden = !msg;
};

const showScreen = (screen) => {
  pinScreen.hidden = screen !== "pin";
  liveScreen.hidden = screen !== "live";
};

const enableConnect = () => {
  connectBtn.disabled = pinInputs.every((i) => i.value.length === 1);
};

pinInputs.forEach((input, idx) => {
  input.addEventListener("input", (e) => {
    const val = e.target.value.replace(/\D/g, "");
    e.target.value = val;
    if (val && idx < 5) pinInputs[idx + 1].focus();
    enableConnect();
    setPinError("");
    haptic("light");
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !input.value && idx > 0) {
      pinInputs[idx - 1].focus();
    }
  });

  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "").slice(0, 6);
    text.split("").forEach((ch, i) => {
      if (i < 6) pinInputs[i].value = ch;
    });
    if (text.length) pinInputs[Math.min(text.length, 5)].focus();
    enableConnect();
  });
});

async function unlockAudio() {
  if (isUnlocked) return;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
  }
  if (audioCtx.state === "suspended") await audioCtx.resume();
  const buf = audioCtx.createBuffer(1, 1, 22050);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  src.start(0);
  isUnlocked = true;
}

async function redeemPin(pin) {
  const res = await fetch("/api/pair/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin, user_agent: navigator.userAgent }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    if (res.status === 410) clearSession();
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

function sessionKey() {
  return "voice-dani:session";
}

function saveSession(token) {
  try { localStorage.setItem(sessionKey(), token); } catch {}
}

function loadSession() {
  try { return localStorage.getItem(sessionKey()); } catch { return null; }
}

function clearSession() {
  try { localStorage.removeItem(sessionKey()); } catch {}
}

async function startRecording() {
  if (recording) return;
  recording = true;
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: { ideal: 48000 },
      channelCount: 1,
    },
  });

  // Use AudioContext to capture raw PCM16 instead of MediaRecorder (WebM/Opus)
  // This avoids the format mismatch: phone now sends raw PCM16 at 48kHz mono,
  // which the server expects after stripping the 1-byte header.
  const rawCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
  const source = rawCtx.createMediaStreamSource(micStream);
  const processor = rawCtx.createScriptProcessor(4096, 1, 1);

  let sampleBuffer = [];

  processor.onaudioprocess = (e) => {
    if (!recording) return;
    const input = e.inputBuffer.getChannelData(0);
    // Float32 [-1,1] → Int16 PCM
    const pcm16 = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      pcm16[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
    }
    sampleBuffer.push(pcm16);
  };

  source.connect(processor);
  processor.connect(rawCtx.destination); // Required for processing to work

  stopRecording = () => {
    recording = false;
    source.disconnect();
    processor.disconnect();
    rawCtx.close();

    // Concatenate all buffers and send as single ArrayBuffer
    if (sampleBuffer.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
      const totalLen = sampleBuffer.reduce((sum, b) => sum + b.length, 0);
      const combined = new Int16Array(totalLen);
      let off = 0;
      for (const buf of sampleBuffer) {
        combined.set(buf, off);
        off += buf.length;
      }
      // 1-byte format header (0x00 = PCM16) + raw PCM16 data
      const frame = new Uint8Array(1 + combined.byteLength);
      frame[0] = 0x00;
      new Int16Array(frame.buffer, 1).set(combined);
      ws.send(frame.buffer);
    }
    sampleBuffer = [];
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  };
}

function stopRecordingNow() {
  if (!recording) return;
  recording = false;
  if (stopRecording) {
    stopRecording();
    stopRecording = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
}

function appendMessage(role, text) {
  const wrap = document.createElement("div");
  wrap.className = `message message--${role}`;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  wrap.innerHTML = `
    <div class="message-bubble">${text}</div>
    <div class="message-time">${time}</div>
  `;
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
}

function sendText() {
  const text = textInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "text", text }));
  appendMessage("user", text);
  textInput.value = "";
  sendBtn.disabled = true;
}

connectBtn.addEventListener("click", async () => {
  const pin = pinInputs.map((i) => i.value).join("");
  if (pin.length !== 6) return;
  connectBtn.disabled = true;
  connectBtn.textContent = "Connecting…";
  setPinError("");

  try {
    let token = loadSession();
    if (!token) {
      const redeemed = await redeemPin(pin);
      token = redeemed.session_token;
      saveSession(token);
    }
    // Unlock audio without blocking UI
    unlockAudio().catch(() => {});
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = async () => {
      setOrbState(liveOrb, "idle");
      liveStatus.textContent = "Connected";
      liveStatus.style.color = "var(--success)";
      showScreen("live");
      haptic("medium");
      await startRecording();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "transcript" && msg.text) {
            appendMessage("user", msg.text);
            setOrbState(liveOrb, "listening");
            liveStatus.textContent = "Thinking…";
            haptic("light");
          } else if (msg.type === "response" && msg.text) {
            appendMessage("agent", msg.text);
            setOrbState(liveOrb, "idle");
            liveStatus.textContent = "Connected";
            haptic("medium");
            (async () => { await startRecording(); })();
          } else if (msg.type === "state" && msg.value) {
            setOrbState(liveOrb, msg.value);
            if (msg.value === "listening") liveStatus.textContent = "Listening…";
            else if (msg.value === "responding") liveStatus.textContent = "Speaking…";
            else if (msg.value === "idle") liveStatus.textContent = "Connected";
          } else if (msg.type === "error" && msg.text) {
            setOrbState(liveOrb, "error");
            liveStatus.textContent = msg.text;
            liveStatus.style.color = "var(--error)";
            haptic("error");
          }
        } catch {}
        return;
      }
      // Server sends PCM16 audio frames (4-byte length prefix + data)
      if (!audioCtx) return;
      const view = new DataView(ev.data);
      let off = 0;
      while (off + 4 <= ev.data.byteLength) {
        const len = view.getUint32(off, false);
        off += 4;
        if (off + len > ev.data.byteLength) break;
        const pcm16 = new Int16Array(ev.data.slice(off, off + len));
        off += len;
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;
        const buffer = audioCtx.createBuffer(1, float32.length, 48000);
        buffer.copyToChannel(float32, 0);
        const src = audioCtx.createBufferSource();
        src.buffer = buffer;
        src.connect(audioCtx.destination);
        src.start(0);
      }
    };

    ws.onclose = (ev) => {
      if (ev.code === 4401) clearSession();
      setOrbState(liveOrb, "idle");
      liveStatus.textContent = "Disconnected";
      liveStatus.style.color = "var(--fg-muted)";
      showScreen("pin");
      pinInputs.forEach((i) => (i.value = ""));
      pinInputs[0].focus();
      enableConnect();
      connectBtn.textContent = "Connect";
      stopRecordingNow();
      if (audioCtx) audioCtx.close();
      audioCtx = null;
      ws = null;
      isUnlocked = false;
    };

    ws.onerror = (e) => {
      console.error(e);
      setPinError("Connection failed. Try again.");
      connectBtn.disabled = false;
      connectBtn.textContent = "Connect";
      haptic("error");
    };
  } catch (err) {
    console.error(err);
    setPinError(err.message || "Invalid PIN");
    connectBtn.disabled = false;
    connectBtn.textContent = "Connect";
  }
});

textInput.addEventListener("input", () => {
  sendBtn.disabled = !textInput.value.trim();
});

textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendText();
  }
});

sendBtn.addEventListener("click", sendText);

bargeBtn.addEventListener("click", () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "barge_in" }));
    stopRecordingNow();
    startRecording().catch(() => {});
    setOrbState(liveOrb, "listening");
    liveStatus.textContent = "Listening…";
    haptic("heavy");
  }
});

function disconnect() {
  if (ws) ws.close();
  stopRecordingNow();
  if (audioCtx) audioCtx.close();
  audioCtx = null;
  ws = null;
  isUnlocked = false;
  clearSession();
  chat.innerHTML = "";
  showScreen("pin");
  pinInputs.forEach((i) => (i.value = ""));
  pinInputs[0].focus();
  enableConnect();
  connectBtn.textContent = "Connect";
}

disconnectBtn.addEventListener("click", disconnect);
newChatBtn.addEventListener("click", disconnect);

pinInputs[0].focus();