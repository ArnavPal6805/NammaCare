#!/bin/bash
# NammaCare startup script
# Usage: bash run.sh
#
# Starts two processes:
#   1. FastAPI backend on http://127.0.0.1:8000
#   2. Static frontend server on http://127.0.0.1:5500

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5500}"

is_port_free() {
    python3 - "$1" <<'PY'
import socket
import sys

port = int(sys.argv[1])
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.settimeout(0.2)
    raise SystemExit(0 if sock.connect_ex(("127.0.0.1", port)) != 0 else 1)
PY
}

if ! is_port_free "$FRONTEND_PORT"; then
    for candidate in 5501 5502 5503 5504 5505; do
        if is_port_free "$candidate"; then
            FRONTEND_PORT="$candidate"
            break
        fi
    done
fi

if ! is_port_free "$BACKEND_PORT"; then
    for candidate in 8001 8002 8003 8004 8005; do
        if is_port_free "$candidate"; then
            BACKEND_PORT="$candidate"
            break
        fi
    done
fi

# Create / activate venv
if [ ! -d "venv" ]; then
    echo "[run.sh] Creating virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

echo "[run.sh] Starting FastAPI backend on http://127.0.0.1:${BACKEND_PORT} ..."
uvicorn main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload &
BACKEND_PID=$!

echo "[run.sh] Starting frontend server on http://127.0.0.1:${FRONTEND_PORT} ..."
python3 - "$FRONTEND_PORT" <<'PY' &
import http.server
import socketserver
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


port = int(sys.argv[1])
with socketserver.TCPServer(("0.0.0.0", port), NoCacheHandler) as httpd:
    print(f"Serving HTTP on 0.0.0.0 port {port} (http://0.0.0.0:{port}/) ...")
    httpd.serve_forever()
PY
FRONTEND_PID=$!

echo ""
echo "  Backend  → http://127.0.0.1:${BACKEND_PORT}"
echo "  Frontend → http://127.0.0.1:${FRONTEND_PORT}/index.html"
echo ""
echo "Press Ctrl+C to stop both servers."

# Wait and forward SIGINT / SIGTERM to children
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
