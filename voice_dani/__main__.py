"""Allow `python -m voice_dani` to start the server.

Prints the startup box (PIN, URL) in the main thread so CLI agents
capturing stdout (opencode, claude-code, codex, grok) see it
immediately. Server runs in a background daemon thread.
"""

import sys
import threading
import time
from .server import print_startup_box, run as _run_server

agent = "opencode"
if "--agent" in sys.argv:
    idx = sys.argv.index("--agent")
    if idx + 1 < len(sys.argv):
        agent = sys.argv[idx + 1]

tunnel = "--no-tunnel" not in sys.argv

# Print startup box in MAIN thread — flushed immediately so CLI agents
# capturing stdout see the PIN/URL right away, not buffered in a daemon thread.
info = print_startup_box(agent=agent, tunnel=tunnel)

# Run server in background daemon thread (uvicorn blocks forever)
# Pass startup_info so it doesn't re-find-port / re-print / re-tunnel.
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
