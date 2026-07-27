import re
import urllib.parse
from bs4 import BeautifulSoup
from curl_cffi.requests import AsyncSession
import yt_dlp


class TikDownloaderError(Exception):
    """Base exception for TikDownloader errors."""
    pass


class HDNotAvailableError(TikDownloaderError):
    """Exception raised when HD version is not found."""
    pass


class InvalidURLError(TikDownloaderError):
    """Exception raised when TikTok URL is invalid."""
    pass


def validate_tiktok_url(url: str) -> str:
    """Validates and normalizes a TikTok URL."""
    if not url or not isinstance(url, str):
        raise InvalidURLError("Please provide a valid TikTok video URL.")
    
    url = url.strip()
    tiktok_pattern = r'https?://(?:www\.|vm\.|vt\.|m\.)?tiktok\.com/'
    if not re.search(tiktok_pattern, url, re.IGNORECASE):
        raise InvalidURLError("Invalid TikTok URL format. Please paste a valid TikTok link.")
    
    return url


def extract_tiktok_metadata(tiktok_url: str, html_content: str = "") -> dict:
    """
    Extracts TikTok username and video ID from URL and HTML content.
    Generates standardized filename: Tikfetch_@username_videoID.mp4
    """
    username = ""
    video_id = ""

    # 1. Extract username from TikTok URL (@username)
    user_match = re.search(r'@([a-zA-Z0-9_\.]+)', tiktok_url)
    if user_match:
        username = user_match.group(1)

    # Extract video_id from URL (/video/123456789)
    id_match = re.search(r'/video/(\d+)', tiktok_url)
    if id_match:
        video_id = id_match.group(1)

    # 2. Search username in HTML content if missing
    if not username and html_content:
        soup = BeautifulSoup(html_content, "html.parser")
        text = soup.get_text()
        found_at = re.search(r'@([a-zA-Z0-9_\.]+)', text)
        if found_at:
            username = found_at.group(1)
        else:
            for img in soup.find_all("img"):
                alt = img.get("alt", "")
                if "@" in alt:
                    found_alt = re.search(r'@([a-zA-Z0-9_\.]+)', alt)
                    if found_alt:
                        username = found_alt.group(1)
                        break

    clean_user = username.strip().lstrip("@") if username else "video"
    
    if not video_id:
        short_match = re.search(r'tiktok\.com/([a-zA-Z0-9]+)', tiktok_url)
        if short_match:
            video_id = short_match.group(1)
        else:
            video_id = "hd"

    filename = f"Tikfetch_@{clean_user}_{video_id}.mp4"
    return {
        "username": clean_user,
        "video_id": video_id,
        "filename": filename
    }


def fetch_profile_videos(username_or_url: str, limit: int = 0) -> dict:
    """
    Extracts profile videos list using yt-dlp flat extraction.
    If limit is 0, fetches all available videos on the user profile.
    """
    cleaned = username_or_url.strip()
    match = re.search(r'@([a-zA-Z0-9_\.]+)', cleaned)
    if match:
        username = match.group(1)
    else:
        username = cleaned.lstrip("@").split("/")[0].split("?")[0]

    if not username:
        raise InvalidURLError("Please provide a valid TikTok username or profile URL.")

    profile_url = f"https://www.tiktok.com/@{username}"
    ydl_opts = {
        'extract_flat': True,
        'quiet': True,
        'no_warnings': True,
        'ignoreerrors': True,
        'socket_timeout': 20,
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    }

    if limit and limit > 0:
        ydl_opts['playlistend'] = limit

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(profile_url, download=False)
            entries = info.get('entries', []) or []
            
            videos = []
            for item in entries:
                if item:
                    v_id = item.get('id')
                    v_url = item.get('url') or item.get('webpage_url')
                    if not v_url and v_id:
                        v_url = f"https://www.tiktok.com/@{username}/video/{v_id}"
                    
                    v_title = item.get('title') or f"Video {v_id}"
                    thumbnails = item.get('thumbnails', [])
                    cover = thumbnails[0].get('url') if thumbnails else ""

                    videos.append({
                        "id": v_id,
                        "title": v_title,
                        "url": v_url,
                        "cover": cover,
                        "view_count": item.get('view_count', 0),
                        "like_count": item.get('like_count', 0)
                    })

            return {
                "username": username,
                "profile_url": profile_url,
                "total": len(videos),
                "videos": videos
            }
    except Exception as exc:
        raise TikDownloaderError(f"Failed to fetch profile for @{username}: {str(exc)}")


async def extract_hd_download_url(tiktok_url: str) -> dict:
    """
    Requests tikdownloader.io/api/ajaxSearch using Chrome browser TLS impersonation
    to bypass Cloudflare anti-bot checks, then extracts the HD download URL and video metadata.
    Only searches for 'Download MP4 HD' button.
    Raises HDNotAvailableError if HD version is not available.
    """
    valid_url = validate_tiktok_url(tiktok_url)
    
    home_url = "https://tikdownloader.io/"
    api_endpoint = "https://tikdownloader.io/api/ajaxSearch"

    async with AsyncSession(impersonate="chrome", timeout=20.0) as session:
        try:
            home_res = await session.get(home_url)
            if home_res.status_code != 200:
                raise TikDownloaderError(f"TikDownloader homepage returned HTTP status {home_res.status_code}.")

            home_html = home_res.text
            token_m = re.search(r'k_token="([^"]+)"', home_html)
            exp_m = re.search(r'k_exp="([^"]+)"', home_html)

            k_token = token_m.group(1) if token_m else ""
            k_exp = exp_m.group(1) if exp_m else ""

            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "X-Requested-With": "XMLHttpRequest",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Referer": "https://tikdownloader.io/",
                "Origin": "https://tikdownloader.io"
            }
            
            payload = {
                "q": valid_url,
                "lang": "en"
            }
            if k_token:
                payload["token"] = k_token
            if k_exp:
                payload["exp"] = k_exp

            response = await session.post(api_endpoint, data=payload, headers=headers)
        except Exception as exc:
            if isinstance(exc, TikDownloaderError):
                raise exc
            raise TikDownloaderError(f"Network error connecting to TikDownloader: {str(exc)}")

    if response.status_code != 200:
        raise TikDownloaderError(f"TikDownloader service returned HTTP status code {response.status_code}.")

    try:
        json_resp = response.json()
    except Exception:
        raise TikDownloaderError("Failed to parse JSON response from TikDownloader service.")

    if json_resp.get("status") != "ok":
        error_msg = json_resp.get("msg") or "TikDownloader returned an unsuccessful status."
        raise TikDownloaderError(f"Extraction failed: {error_msg}")

    html_data = json_resp.get("data")
    if not html_data:
        msg = json_resp.get("msg")
        if msg:
            raise TikDownloaderError(msg)
        raise TikDownloaderError("No video HTML returned in TikDownloader response.")

    hd_url = parse_hd_link_from_html(html_data)
    meta = extract_tiktok_metadata(valid_url, html_data)
    meta["download_url"] = hd_url
    
    return meta


def parse_hd_link_from_html(html_content: str) -> str:
    """
    Parses HTML content and searches exclusively for 'Download MP4 HD' button.
    """
    soup = BeautifulSoup(html_content, "lxml" if "lxml" in BeautifulSoup.__dict__ else "html.parser")
    
    anchors = soup.find_all("a")
    
    for anchor in anchors:
        text = anchor.get_text(strip=True)
        if re.search(r'\bDownload\s+MP4\s+HD\b', text, re.IGNORECASE):
            href = anchor.get("href")
            if href and href.startswith("http"):
                return href
    
    for element in soup.find_all(["button", "a"]):
        title_or_text = element.get_text(strip=True) or element.get("title", "")
        if "Download MP4 HD" in title_or_text or "MP4 HD" in title_or_text:
            href = element.get("href") or element.get("data-url")
            if href and href.startswith("http"):
                return href

    raise HDNotAvailableError("HD version is not available for this video.")
