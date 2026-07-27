import os
import uuid
import asyncio
import zipfile
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from extractor import (
    extract_hd_download_url,
    validate_tiktok_url,
    fetch_profile_videos,
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

# In-memory download task stores
tasks_progress: Dict[str, Dict[str, Any]] = {}
batch_progress: Dict[str, Dict[str, Any]] = {}


class DownloadRequest(BaseModel):
    url: str


class BatchDownloadRequest(BaseModel):
    urls: List[str]


class ProfileRequest(BaseModel):
    username_or_url: str
    limit: Optional[int] = 0


class PreviewRequest(BaseModel):
    url: str


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "TikTok HD Downloader"}


@app.get("/api/progress/{task_id}")
async def get_progress(task_id: str):
    if task_id not in tasks_progress:
        raise HTTPException(status_code=404, detail="Task not found")
    return tasks_progress[task_id]


@app.get("/api/batch-progress/{batch_id}")
async def get_batch_progress(batch_id: str):
    if batch_id not in batch_progress:
        raise HTTPException(status_code=404, detail="Batch task not found")
    return batch_progress[batch_id]


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


@app.post("/api/profile")
async def get_user_profile(req: ProfileRequest):
    if not req.username_or_url or not req.username_or_url.strip():
        raise HTTPException(status_code=400, detail="TikTok username or profile URL is required.")

    try:
        limit = req.limit if req.limit is not None and req.limit >= 0 else 0
        data = await asyncio.to_thread(fetch_profile_videos, req.username_or_url.strip(), limit)
        return data
    except TikDownloaderError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch profile videos: {str(exc)}")


@app.post("/api/preview-url")
async def get_preview_url(req: PreviewRequest):
    """
    Extracts the direct HD MP4 CDN stream URL for direct HTML5 video playback.
    """
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="TikTok video URL is required.")

    try:
        meta = await extract_hd_download_url(req.url.strip())
        return {
            "status": "ok",
            "download_url": meta["download_url"],
            "filename": meta["filename"],
            "username": meta["username"]
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


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
        meta = await extract_hd_download_url(tiktok_url)
        result = await download_file(
            file_url=meta["download_url"],
            output_filename=meta["filename"],
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

    except Exception as exc:
        tasks_progress[task_id].update({
            "status": "error",
            "error": str(exc)
        })


async def run_batch_download_task(batch_id: str, raw_urls: List[str]):
    valid_items = []
    for idx, raw_u in enumerate(raw_urls):
        cleaned = raw_u.strip()
        if cleaned:
            valid_items.append({"index": idx, "url": cleaned})

    batch_data = {
        "batch_id": batch_id,
        "status": "processing",
        "total": len(valid_items),
        "completed_count": 0,
        "failed_count": 0,
        "items": [
            {
                "id": item["index"],
                "url": item["url"],
                "status": "pending",
                "filename": "",
                "file_size": 0,
                "download_url": "",
                "error": ""
            }
            for item in valid_items
        ],
        "zip_url": ""
    }
    batch_progress[batch_id] = batch_data

    semaphore = asyncio.Semaphore(2)  # Limit concurrent extractions
    successful_file_paths = []

    async def process_single_item(item_info):
        async with semaphore:
            item_idx = item_info["index"]
            item_url = item_info["url"]

            batch_progress[batch_id]["items"][item_idx]["status"] = "extracting"

            try:
                meta = await extract_hd_download_url(item_url)
                batch_progress[batch_id]["items"][item_idx]["status"] = "downloading"
                
                result = await download_file(
                    file_url=meta["download_url"],
                    output_filename=meta["filename"]
                )

                filename = result["filename"]
                file_path = result["file_path"]
                file_size = result["file_size"]
                download_url = f"/api/download-file/{filename}"

                batch_progress[batch_id]["items"][item_idx].update({
                    "status": "completed",
                    "filename": filename,
                    "file_size": file_size,
                    "download_url": download_url
                })
                batch_progress[batch_id]["completed_count"] += 1
                successful_file_paths.append(file_path)

            except Exception as exc:
                batch_progress[batch_id]["items"][item_idx].update({
                    "status": "error",
                    "error": str(exc)
                })
                batch_progress[batch_id]["failed_count"] += 1

    await asyncio.gather(*[process_single_item(item) for item in valid_items])

    if successful_file_paths:
        zip_filename = f"Tikfetch_batch_{batch_id[:8]}.zip"
        zip_path = os.path.join(DOWNLOAD_DIR, zip_filename)
        try:
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
                for fpath in successful_file_paths:
                    if os.path.exists(fpath):
                        zipf.write(fpath, arcname=os.path.basename(fpath))
            batch_progress[batch_id]["zip_url"] = f"/api/download-file/{zip_filename}"
        except Exception as e:
            print("Failed to build ZIP archive:", e)

    if batch_progress[batch_id]["failed_count"] == 0:
        batch_progress[batch_id]["status"] = "completed"
    elif batch_progress[batch_id]["completed_count"] > 0:
        batch_progress[batch_id]["status"] = "partial_error"
    else:
        batch_progress[batch_id]["status"] = "error"


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


@app.post("/api/batch-download")
async def start_batch_download(req: BatchDownloadRequest, background_tasks: BackgroundTasks):
    if not req.urls or len(req.urls) == 0:
        raise HTTPException(status_code=400, detail="At least one TikTok video URL is required.")

    urls_list = []
    for u in req.urls:
        lines = u.replace(",", "\n").replace(" ", "\n").split("\n")
        for line in lines:
            line_str = line.strip()
            if line_str and "tiktok.com" in line_str.lower():
                urls_list.append(line_str)

    if not urls_list:
        raise HTTPException(status_code=400, detail="No valid TikTok URLs found in the request.")

    batch_id = str(uuid.uuid4())
    background_tasks.add_task(run_batch_download_task, batch_id, urls_list)

    return {
        "status": "started",
        "batch_id": batch_id,
        "total_urls": len(urls_list)
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
