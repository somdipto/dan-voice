"""Minimal FastAPI server for Voice Dani."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import config
from .pairing import PairingManager

log = logging.getLogger(__name__)

_ROOT = Path(__file__).parent.parent
WEB_DIR = _ROOT / "web"

pairing_manager = PairingManager()

# Track active connections
_active_connections: set[WebSocket] = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown."""
    # Startup
    log.info("Voice Dani server starting...")
    # Start cleanup task
    cleanup_task = asyncio.create_task(_cleanup_loop())
    yield
    # Shutdown
    log.info("Voice Dani server shutting down...")
    cleanup_task.cancel()
    # Close all active connections
    for ws in list(_active_connections):
        try:
            await ws.close(code=1001, reason="Server shutting down")
        except Exception:
            pass
    _active_connections.clear()


app = FastAPI(title="Voice Dani", version="0.2.0", lifespan=lifespan)


async def _cleanup_loop():
    """Periodically cleanup expired PINs and tokens."""
    while True:
        await asyncio.sleep(60)
        try:
            pairing_manager.cleanup_expired()
        except Exception as e:
            log.error(f"Cleanup error: {e}")


@app.get("/", response_class=HTMLResponse)
async def index():
    if WEB_DIR.exists() and (WEB_DIR / "index.html").exists():
        return HTMLResponse(content=(WEB_DIR / "index.html").read_text(encoding="utf-8"))
    return HTMLResponse(content="<html><body><h1>Voice Dani</h1><p>Web UI not found.</p></body></html>")


@app.get("/health")
async def health():
    """Health check endpoint."""
    return JSONResponse({
        "status": "healthy",
        "version": "0.2.0",
        "active_connections": len(_active_connections),
        "timestamp": time.time(),
    })


@app.get("/ready")
async def ready():
    """Readiness check endpoint."""
    return JSONResponse({"status": "ready"})


@app.post("/api/pair/create")
async def pair_create():
    return {"pin": pairing_manager.create_pin()}


@app.post("/api/pair/redeem")
async def pair_redeem(req: dict):
    pin = req.get("pin", "")
    client_ip = req.get("client_ip", "unknown")
    token = pairing_manager.redeem(pin, client_ip)
    if token is None:
        raise HTTPException(status_code=401, detail="Invalid or expired PIN")
    return {"session_token": token}


@app.websocket("/ws")
async def websocket_relay(websocket: WebSocket):
    token = (websocket.query_params.get("token") or "").strip()
    if not token or not pairing_manager.verify(token):
        await websocket.close(code=4401, reason="Invalid or expired token")
        return

    await websocket.accept()
    _active_connections.add(websocket)
    await websocket.send_json({"type": "info", "text": "Connected"})

    # Start heartbeat task
    heartbeat_task = asyncio.create_task(_heartbeat(websocket))

    try:
        from .audio_handler import handle_audio
        await handle_audio(websocket, agent="opencode")
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "text": str(e)})
        except Exception:
            pass
    finally:
        heartbeat_task.cancel()
        _active_connections.discard(websocket)


async def _heartbeat(ws: WebSocket):
    """Send periodic heartbeats to keep connection alive."""
    while True:
        await asyncio.sleep(config.server.heartbeat_interval)
        try:
            await ws.send_json({"type": "heartbeat", "timestamp": time.time()})
        except Exception:
            break


if WEB_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


def _start_tunnel(port: int) -> str | None:
    cloudflared = shutil.which("cloudflared")
    if not cloudflared:
        return None

    try:
        result = subprocess.run(
            [cloudflared, "tunnel", "--url", f"http://127.0.0.1:{port}"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            timeout=config.server.tunnel_timeout,
        )
        match = re.search(r"(https://[a-z0-9-]+\.trycloudflare\.com)", result.stderr)
        return match.group(1) if match else None
    except subprocess.TimeoutExpired:
        return None
    except Exception:
        return None


def _find_port(host: str, port: int) -> int:
    """Find first available port."""
    for p in range(port, port + config.server.port_range):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, p))
                return p
            except OSError:
                continue
    return port


def _check_tts() -> str:
    """Check if TTS is available. Returns backend name."""
    try:
        from .tts import create_tts_backend
        backend = create_tts_backend()
        log.info(f"TTS backend: {backend.name}")
        return backend.name
    except Exception as e:
        log.error(f"TTS init failed: {e}")
        return "none"


def print_startup_box(
    host: str = "127.0.0.1",
    port: int = 7860,
    tunnel: bool = True,
    agent: str = "opencode",
) -> dict:
    """Find a port, create a PIN, optionally start tunnel, print box, flush."""
    actual_port = _find_port(host, port)

    public_url = None
    if tunnel:
        public_url = _start_tunnel(actual_port)

    pin = pairing_manager.create_pin()
    tts_backend = _check_tts()

    print()
    print("  ┌─────────────────────────────────────────────┐")
    print("  │             Voice Dani — ready               │")
    print("  ├─────────────────────────────────────────────┤")
    if public_url:
        print(f"  │  Public URL:  {public_url:<30s} │")
    print(f"  │  Local URL:   http://{host}:{actual_port:<20} │")
    print(f"  │  PIN:         {pin:<30} │")
    print(f"  │  TTS:         {tts_backend:<30} │")
    print("  ├─────────────────────────────────────────────┤")
    print("  │  Open the URL on your phone, enter the PIN  │")
    print("  │  to connect.                                │")
    print("  └─────────────────────────────────────────────┘")
    print()
    sys.stdout.flush()

    return {
        "host": host,
        "port": actual_port,
        "pin": pin,
        "public_url": public_url,
        "agent": agent,
    }


def run(
    host: str = "127.0.0.1",
    port: int = 7860,
    tunnel: bool = True,
    agent: str = "opencode",
    startup_info: dict | None = None,
) -> None:
    """Start the server. Blocks on uvicorn."""
    import uvicorn

    if startup_info is None:
        startup_info = print_startup_box(host=host, port=port, tunnel=tunnel, agent=agent)

    # Set up signal handlers for graceful shutdown
    def signal_handler(sig, frame):
        log.info(f"Received signal {sig}, shutting down...")
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    uvicorn.run(
        app,
        host=startup_info["host"],
        port=startup_info["port"],
        log_level=config.server.log_level,
        ws="websockets",
    )


if __name__ == "__main__":
    run()
