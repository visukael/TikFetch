import os
import re
import time
from typing import Callable, Optional
import httpx
from curl_cffi.requests import AsyncSession


DOWNLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "downloads")


def ensure_download_dir() -> str:
    """Ensures the downloads directory exists."""
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    return DOWNLOAD_DIR


def sanitize_filename(filename: str) -> str:
    """Sanitizes filename for cross-platform compatibility."""
    sanitized = re.sub(r'[\\/*?:"<>|]', "", filename)
    return sanitized or f"tiktok_hd_{int(time.time())}.mp4"


async def download_file(
    file_url: str,
    output_filename: Optional[str] = None,
    progress_callback: Optional[Callable[[dict], None]] = None
) -> dict:
    """
    Downloads the original HD file directly without modification or transcoding.
    Uses httpx with curl_cffi fallback to ensure resilient CDN access.
    Saves directly to backend/downloads/.
    """
    downloads_path = ensure_download_dir()
    
    if not output_filename:
        timestamp = int(time.time())
        output_filename = f"tiktok_hd_{timestamp}.mp4"
    else:
        output_filename = sanitize_filename(output_filename)
        if not output_filename.endswith(".mp4"):
            output_filename += ".mp4"
            
    file_path = os.path.join(downloads_path, output_filename)

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Encoding": "identity",
        "Referer": "https://tikdownloader.io/"
    }

    download_success = False
    last_error = ""

    # Strategy 1: Fast HTTPX async download
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True, verify=False) as client:
            async with client.stream("GET", file_url, headers=headers) as response:
                if response.status_code == 200:
                    total_bytes = int(response.headers.get("Content-Length", 0))
                    downloaded_bytes = 0
                    start_time = time.time()

                    with open(file_path, "wb") as f:
                        async for chunk in response.aiter_bytes(chunk_size=1024 * 64):
                            if chunk:
                                f.write(chunk)
                                downloaded_bytes += len(chunk)
                                
                                elapsed = time.time() - start_time
                                speed_bps = downloaded_bytes / elapsed if elapsed > 0 else 0
                                percentage = round((downloaded_bytes / total_bytes * 100), 2) if total_bytes > 0 else 0.0

                                if progress_callback:
                                    progress_callback({
                                        "status": "downloading",
                                        "downloaded_bytes": downloaded_bytes,
                                        "total_bytes": total_bytes,
                                        "percentage": percentage,
                                        "speed_mbps": round(speed_bps / (1024 * 1024), 2)
                                    })
                    download_success = True
                else:
                    last_error = f"HTTP status {response.status_code}"
    except Exception as exc:
        last_error = str(exc)

    # Strategy 2: curl_cffi AsyncSession fallback
    if not download_success:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass

        try:
            async with AsyncSession(impersonate="chrome", timeout=60.0, verify=False) as session:
                response = await session.get(file_url, headers=headers, stream=True)
                if response.status_code == 200:
                    total_bytes = int(response.headers.get("Content-Length", 0))
                    downloaded_bytes = 0
                    start_time = time.time()

                    with open(file_path, "wb") as f:
                        async for chunk in response.aiter_content(1024 * 64):
                            if chunk:
                                f.write(chunk)
                                downloaded_bytes += len(chunk)
                                
                                elapsed = time.time() - start_time
                                speed_bps = downloaded_bytes / elapsed if elapsed > 0 else 0
                                percentage = round((downloaded_bytes / total_bytes * 100), 2) if total_bytes > 0 else 0.0

                                if progress_callback:
                                    progress_callback({
                                        "status": "downloading",
                                        "downloaded_bytes": downloaded_bytes,
                                        "total_bytes": total_bytes,
                                        "percentage": percentage,
                                        "speed_mbps": round(speed_bps / (1024 * 1024), 2)
                                    })
                    download_success = True
                else:
                    last_error = f"Fallback HTTP status {response.status_code}"
        except Exception as exc:
            last_error = str(exc)

    if not download_success:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        raise Exception(f"Could not connect to video CDN server: {last_error}")

    file_size = os.path.getsize(file_path)
    return {
        "status": "completed",
        "filename": output_filename,
        "file_path": file_path,
        "file_size": file_size,
        "download_dir": downloads_path
    }
