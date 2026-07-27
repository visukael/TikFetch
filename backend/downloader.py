import os
import re
import time
from typing import AsyncGenerator, Optional
import httpx
from curl_cffi.requests import AsyncSession


def sanitize_filename(filename: str) -> str:
    """Sanitizes filename for cross-platform compatibility."""
    sanitized = re.sub(r'[\\/*?:"<>|]', "", filename)
    return sanitized or f"tiktok_hd_{int(time.time())}.mp4"


async def stream_video_bytes(file_url: str) -> AsyncGenerator[bytes, None]:
    """
    Asynchronously streams video bytes directly from TikTok CDN.
    Bypasses saving files to local disk.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Encoding": "identity",
        "Referer": "https://tikdownloader.io/"
    }

    stream_started = False

    # Strategy 1: HTTPX stream
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True, verify=False) as client:
            async with client.stream("GET", file_url, headers=headers) as response:
                if response.status_code == 200:
                    stream_started = True
                    async for chunk in response.aiter_bytes(chunk_size=1024 * 64):
                        if chunk:
                            yield chunk
                    return
    except Exception:
        pass

    # Strategy 2: curl_cffi AsyncSession stream fallback
    if not stream_started:
        try:
            async with AsyncSession(impersonate="chrome", timeout=60.0, verify=False) as session:
                response = await session.get(file_url, headers=headers, stream=True)
                if response.status_code == 200:
                    async for chunk in response.aiter_content(1024 * 64):
                        if chunk:
                            yield chunk
                    return
                else:
                    raise Exception(f"CDN response status code {response.status_code}")
        except Exception as exc:
            raise Exception(f"Could not stream video from CDN: {str(exc)}")


async def fetch_video_bytes(file_url: str) -> bytes:
    """
    Fetches raw video bytes in memory for zip packaging without writing to disk.
    """
    chunks = []
    async for chunk in stream_video_bytes(file_url):
        chunks.append(chunk)
    return b"".join(chunks)
