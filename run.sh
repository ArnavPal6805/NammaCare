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

# Create / activate venv
if [ ! -d "venv" ]; then
    echo "[run.sh] Creating virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

echo "[run.sh] Starting FastAPI backend on http://127.0.0.1:8000 ..."
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

echo "[run.sh] Starting frontend server on http://127.0.0.1:5500 ..."
python3 -m http.server 5500 &
FRONTEND_PID=$!

echo ""
echo "  Backend  → http://127.0.0.1:8000"
echo "  Frontend → http://127.0.0.1:5500/index.html"
echo ""
echo "Press Ctrl+C to stop both servers."

# Wait and forward SIGINT / SIGTERM to children
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
