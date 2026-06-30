"""Allow `python -m voice_dani` or `dan-voice` to start the server.

Prints the startup box (PIN, URL) in the main thread so CLI agents
capturing stdout (opencode, claude-code, codex, grok) see it
immediately. Server runs in a background daemon thread.
"""

import sys
import threading
import time
from .server import print_startup_box, run as _run_server


def run(agent: str = "opencode", tunnel: bool = True) -> None:
    """Entry point for both `python -m voice_dani` and `dan-voice` CLI."""
    # Print startup box in MAIN thread — flushed immediately so CLI agents
    # capturing stdout see the PIN/URL right away, not buffered in a daemon thread.
    info = print_startup_box(agent=agent, tunnel=tunnel)

    # Run server in background daemon thread (uvicorn blocks forever)
    server_thread = threading.Thread(
        target=lambda: _run_server(agent=agent, tunnel=False, startup_info=info),
        daemon=True,
    )
    server_thread.start()

    # Keep main alive — Ctrl-C to stop
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nVoice Dani stopped.")
        sys.exit(0)


# Expose callable for entry point: dan-voice = voice_dani.__main__:run
def app() -> None:
    """CLI entry point that parses sys.argv."""
    agent = "opencode"
    if "--agent" in sys.argv:
        idx = sys.argv.index("--agent")
        if idx + 1 < len(sys.argv):
            agent = sys.argv[idx + 1]
    tunnel = "--no-tunnel" not in sys.argv
    run(agent=agent, tunnel=tunnel)


if __name__ == "__main__":
    app()
