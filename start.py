import os
import sys
import subprocess
import time
import signal

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")


def main():
    print("=" * 60)
    print("  TikTok Downloader (Local)")
    print("  Starting Backend (FastAPI) and Frontend (Next.js)...")
    print("=" * 60)

    python_executable = sys.executable

    # 1. Start Backend
    print("[1/2] Launching FastAPI backend on http://127.0.0.1:8000 ...")
    backend_proc = subprocess.Popen(
        [python_executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=BACKEND_DIR
    )

    # 2. Start Frontend
    print("[2/2] Launching Next.js frontend on http://localhost:3000 ...")
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
    frontend_proc = subprocess.Popen(
        [npm_cmd, "run", "dev"],
        cwd=FRONTEND_DIR
    )

    print("\n" + "=" * 60)
    print("  Application launched successfully!")
    print("  - Frontend UI : http://localhost:3000")
    print("  - Backend API : http://127.0.0.1:8000")
    print("  - Downloads   : backend/downloads/")
    print("  Press Ctrl+C to stop both servers.")
    print("=" * 60 + "\n")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping application servers...")
        backend_proc.terminate()
        frontend_proc.terminate()
        backend_proc.wait()
        frontend_proc.wait()
        print("Servers stopped cleanly.")


if __name__ == "__main__":
    main()
