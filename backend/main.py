import os
import uuid
import asyncio
from typing import Dict, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl

from extractor import (
    extract_hd_download_url,
    HDNotAvailableError,
    InvalidURLError,
    TikDownloaderError
)
from downloader import download_file, ensure_download_dir, DOWNLOAD_DIR

app = FastAPI(title="TikTok HD Downloader API", version="1.0.0")

# CORS middleware for local frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"]
)

# Ensure downloads directory exists and mount for static access
ensure_download_dir()
app.mount("/downloads", StaticFiles(directory=DOWNLOAD_DIR), name="downloads")

# In-memory download task progress store
tasks_progress: Dict[str, Dict[str, Any]] = {}


class DownloadRequest(BaseModel):
    url: str


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "TikTok HD Downloader"}


@app.get("/api/progress/{task_id}")
async def get_progress(task_id: str):
    if task_id not in tasks_progress:
        raise HTTPException(status_code=404, detail="Task not found")
    return tasks_progress[task_id]


@app.get("/api/download-file/{filename}")
async def get_download_file(filename: str):
    """
    Serves the file with Content-Disposition: attachment header
    to trigger native browser file download directly.
    """
    file_path = os.path.join(DOWNLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=file_path,
        filename=filename,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


async def run_download_task(task_id: str, tiktok_url: str):
    tasks_progress[task_id] = {
        "task_id": task_id,
        "status": "extracting",
        "downloaded_bytes": 0,
        "total_bytes": 0,
        "percentage": 0.0,
        "speed_mbps": 0.0,
        "filename": "",
        "file_path": "",
        "file_size": 0,
        "download_url": "",
        "error": ""
    }

    def progress_cb(data: dict):
        tasks_progress[task_id].update({
            "status": "downloading",
            "downloaded_bytes": data.get("downloaded_bytes", 0),
            "total_bytes": data.get("total_bytes", 0),
            "percentage": data.get("percentage", 0.0),
            "speed_mbps": data.get("speed_mbps", 0.0)
        })

    try:
        # Step 1: Extract MP4 HD URL from TikDownloader
        hd_url = await extract_hd_download_url(tiktok_url)
        
        # Step 2: Download file to server cache
        result = await download_file(
            file_url=hd_url,
            progress_callback=progress_cb
        )

        filename = result["filename"]
        download_url = f"/api/download-file/{filename}"

        tasks_progress[task_id].update({
            "status": "completed",
            "percentage": 100.0,
            "filename": filename,
            "file_path": result["file_path"],
            "file_size": result["file_size"],
            "download_url": download_url
        })

    except HDNotAvailableError as exc:
        tasks_progress[task_id].update({
            "status": "error",
            "error": str(exc)
        })
    except InvalidURLError as exc:
        tasks_progress[task_id].update({
            "status": "error",
            "error": str(exc)
        })
    except TikDownloaderError as exc:
        tasks_progress[task_id].update({
            "status": "error",
            "error": str(exc)
        })
    except Exception as exc:
        tasks_progress[task_id].update({
            "status": "error",
            "error": f"Download failed: {str(exc)}"
        })


@app.post("/api/download")
async def start_download(req: DownloadRequest, background_tasks: BackgroundTasks):
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="TikTok video URL is required.")

    task_id = str(uuid.uuid4())
    background_tasks.add_task(run_download_task, task_id, req.url.strip())
    
    return {
        "status": "started",
        "task_id": task_id
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
