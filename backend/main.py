import io
import uuid
import asyncio
import zipfile
import urllib.parse
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from extractor import (
    extract_hd_download_url,
    validate_tiktok_url,
    fetch_profile_videos,
    HDNotAvailableError,
    InvalidURLError,
    TikDownloaderError
)
from downloader import stream_video_bytes, fetch_video_bytes, sanitize_filename

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

# In-memory download task stores
tasks_progress: Dict[str, Dict[str, Any]] = {}
batch_progress: Dict[str, Dict[str, Any]] = {}


class DownloadRequest(BaseModel):
    url: str


class BatchDownloadRequest(BaseModel):
    urls: List[str]


class BatchRetryRequest(BaseModel):
    batch_id: str
    item_indices: Optional[List[int]] = None


class BatchControlRequest(BaseModel):
    batch_id: str
    action: str  # "pause" | "resume" | "cancel"


class CancelTaskRequest(BaseModel):
    task_id: str


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


@app.get("/api/stream-video")
async def stream_video(
    url: Optional[str] = Query(None),
    cdn_url: Optional[str] = Query(None),
    filename: Optional[str] = Query(None)
):
    """
    Streams HD TikTok video directly to the browser without saving to disk.
    Triggers native browser download via Content-Disposition attachment header.
    """
    if not cdn_url or not filename:
        if not url:
            raise HTTPException(status_code=400, detail="TikTok video URL or cdn_url parameter is required.")
        try:
            meta = await extract_hd_download_url(url.strip())
            cdn_url = meta["download_url"]
            filename = meta["filename"]
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Failed to extract video: {str(exc)}")

    clean_filename = sanitize_filename(filename)
    encoded_filename = urllib.parse.quote(clean_filename)

    return StreamingResponse(
        stream_video_bytes(cdn_url),
        media_type="video/mp4",
        headers={
            "Content-Disposition": f'attachment; filename="{clean_filename}"; filename*=UTF-8\'\'{encoded_filename}'
        }
    )


@app.get("/api/batch-zip/{batch_id}")
async def get_batch_zip(batch_id: str):
    """
    Generates an in-memory ZIP archive of all completed videos in the batch on-demand.
    Bypasses saving files to server disk.
    """
    if batch_id not in batch_progress:
        raise HTTPException(status_code=404, detail="Batch task not found")

    b_data = batch_progress[batch_id]
    completed_items = [item for item in b_data.get("items", []) if item.get("status") == "completed" and item.get("cdn_url")]

    if not completed_items:
        raise HTTPException(status_code=400, detail="No completed video downloads found in this batch.")

    zip_buffer = io.BytesIO()

    try:
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zipf:
            for item in completed_items:
                cdn_url = item["cdn_url"]
                fname = item.get("filename") or f"video_{item['id']}.mp4"
                try:
                    video_bytes = await fetch_video_bytes(cdn_url)
                    zipf.writestr(fname, video_bytes)
                except Exception as e:
                    print(f"Failed to fetch bytes for {fname}: {e}")

        zip_buffer.seek(0)
        zip_filename = f"Tikfetch_batch_{batch_id[:8]}.zip"
        encoded_zip_name = urllib.parse.quote(zip_filename)

        return StreamingResponse(
            iter([zip_buffer.getvalue()]),
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{zip_filename}"; filename*=UTF-8\'\'{encoded_zip_name}'
            }
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate batch ZIP: {str(exc)}")


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


async def run_single_extraction_task(task_id: str, tiktok_url: str):
    tasks_progress[task_id] = {
        "task_id": task_id,
        "status": "extracting",
        "filename": "",
        "cdn_url": "",
        "download_stream_url": "",
        "error": ""
    }

    try:
        meta = await extract_hd_download_url(tiktok_url)
        if tasks_progress[task_id].get("status") == "cancelled":
            return

        cdn_url = meta["download_url"]
        filename = meta["filename"]
        stream_endpoint = f"/api/stream-video?cdn_url={urllib.parse.quote(cdn_url)}&filename={urllib.parse.quote(filename)}"

        tasks_progress[task_id].update({
            "status": "completed",
            "filename": filename,
            "cdn_url": cdn_url,
            "download_stream_url": stream_endpoint
        })

    except Exception as exc:
        if tasks_progress[task_id].get("status") != "cancelled":
            tasks_progress[task_id].update({
                "status": "error",
                "error": str(exc)
            })


async def process_single_batch_item(batch_id: str, item_info, semaphore: asyncio.Semaphore):
    async with semaphore:
        b_data = batch_progress.get(batch_id)
        if not b_data:
            return

        # Check pause or cancel before starting
        while b_data.get("status") == "paused":
            await asyncio.sleep(0.5)

        if b_data.get("status") == "cancelled":
            b_data["items"][item_info["index"]]["status"] = "cancelled"
            return

        item_idx = item_info["index"]
        item_url = item_info["url"]

        b_data["items"][item_idx]["status"] = "extracting"
        b_data["items"][item_idx]["error"] = ""

        try:
            meta = await extract_hd_download_url(item_url)
            
            # Check pause/cancel after extraction
            if b_data.get("status") == "cancelled":
                b_data["items"][item_idx]["status"] = "cancelled"
                return

            cdn_url = meta["download_url"]
            filename = meta["filename"]
            stream_url = f"/api/stream-video?cdn_url={urllib.parse.quote(cdn_url)}&filename={urllib.parse.quote(filename)}"

            b_data["items"][item_idx].update({
                "status": "completed",
                "filename": filename,
                "cdn_url": cdn_url,
                "download_url": stream_url
            })
            b_data["completed_count"] += 1

        except Exception as exc:
            if b_data.get("status") != "cancelled":
                b_data["items"][item_idx].update({
                    "status": "error",
                    "error": str(exc)
                })
                b_data["failed_count"] += 1


async def run_batch_download_task(batch_id: str, raw_urls: List[str]):
    valid_items = []
    for idx, raw_u in enumerate(raw_urls):
        cleaned = raw_u.strip()
        if cleaned:
            valid_items.append({"index": idx, "url": cleaned})

    batch_progress[batch_id] = {
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
                "cdn_url": "",
                "download_url": "",
                "error": ""
            }
            for item in valid_items
        ]
    }

    semaphore = asyncio.Semaphore(3)
    await asyncio.gather(*[process_single_batch_item(batch_id, item, semaphore) for item in valid_items])

    b_data = batch_progress[batch_id]
    if b_data["status"] == "cancelled":
        for item in b_data["items"]:
            if item["status"] == "pending" or item["status"] == "extracting":
                item["status"] = "cancelled"
    elif b_data["failed_count"] == 0:
        b_data["status"] = "completed"
    elif b_data["completed_count"] > 0:
        b_data["status"] = "partial_error"
    else:
        b_data["status"] = "error"


@app.post("/api/download")
async def start_download(req: DownloadRequest, background_tasks: BackgroundTasks):
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="TikTok video URL is required.")

    task_id = str(uuid.uuid4())
    background_tasks.add_task(run_single_extraction_task, task_id, req.url.strip())
    
    return {
        "status": "started",
        "task_id": task_id
    }


@app.post("/api/cancel-task")
async def cancel_single_task(req: CancelTaskRequest):
    if req.task_id in tasks_progress:
        tasks_progress[req.task_id]["status"] = "cancelled"
        return {"status": "cancelled", "task_id": req.task_id}
    raise HTTPException(status_code=404, detail="Task not found.")


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


@app.post("/api/batch-control")
async def control_batch_task(req: BatchControlRequest):
    """
    Pause, resume, or cancel an active batch download task.
    """
    if req.batch_id not in batch_progress:
        raise HTTPException(status_code=404, detail="Batch task not found.")

    b_data = batch_progress[req.batch_id]
    action = req.action.lower().strip()

    if action == "pause":
        if b_data["status"] == "processing":
            b_data["status"] = "paused"
            return {"status": "paused", "batch_id": req.batch_id}
    elif action == "resume":
        if b_data["status"] == "paused":
            b_data["status"] = "processing"
            return {"status": "processing", "batch_id": req.batch_id}
    elif action == "cancel":
        b_data["status"] = "cancelled"
        for item in b_data["items"]:
            if item["status"] in ["pending", "extracting"]:
                item["status"] = "cancelled"
        return {"status": "cancelled", "batch_id": req.batch_id}
    else:
        raise HTTPException(status_code=400, detail="Invalid action. Use 'pause', 'resume', or 'cancel'.")

    return {"status": b_data["status"], "batch_id": req.batch_id}


@app.post("/api/batch-retry")
async def retry_batch_items(req: BatchRetryRequest, background_tasks: BackgroundTasks):
    if req.batch_id not in batch_progress:
        raise HTTPException(status_code=404, detail="Batch task not found.")

    b_data = batch_progress[req.batch_id]
    items_to_retry = []

    for item in b_data["items"]:
        if item["status"] in ["error", "cancelled"]:
            if req.item_indices is None or item["id"] in req.item_indices:
                items_to_retry.append({"index": item["id"], "url": item["url"]})

    if not items_to_retry:
        return {"status": "ignored", "message": "No failed items to retry."}

    b_data["status"] = "processing"
    for item_info in items_to_retry:
        idx = item_info["index"]
        b_data["items"][idx]["status"] = "pending"
        b_data["items"][idx]["error"] = ""
        b_data["failed_count"] = max(0, b_data["failed_count"] - 1)

    async def run_retry_task():
        semaphore = asyncio.Semaphore(3)
        await asyncio.gather(*[process_single_batch_item(req.batch_id, item, semaphore) for item in items_to_retry])
        
        if b_data["failed_count"] == 0:
            b_data["status"] = "completed"
        elif b_data["completed_count"] > 0:
            b_data["status"] = "partial_error"
        else:
            b_data["status"] = "error"

    background_tasks.add_task(run_retry_task)
    return {"status": "retrying", "retried_count": len(items_to_retry)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
