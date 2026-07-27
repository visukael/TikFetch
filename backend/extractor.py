import re
import urllib.parse
from bs4 import BeautifulSoup
from curl_cffi.requests import AsyncSession


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


async def extract_hd_download_url(tiktok_url: str) -> str:
    """
    Requests tikdownloader.io/api/ajaxSearch using Chrome browser TLS impersonation
    to bypass Cloudflare anti-bot checks, then extracts the HD download URL.
    Only searches for 'Download MP4 HD' button.
    Raises HDNotAvailableError if HD version is not available.
    """
    valid_url = validate_tiktok_url(tiktok_url)
    
    home_url = "https://tikdownloader.io/"
    api_endpoint = "https://tikdownloader.io/api/ajaxSearch"

    async with AsyncSession(impersonate="chrome", timeout=20.0) as session:
        try:
            # Step 1: Visit homepage to collect session cookies and page tokens
            home_res = await session.get(home_url)
            if home_res.status_code != 200:
                raise TikDownloaderError(f"TikDownloader homepage returned HTTP status {home_res.status_code}.")

            home_html = home_res.text
            token_m = re.search(r'k_token="([^"]+)"', home_html)
            exp_m = re.search(r'k_exp="([^"]+)"', home_html)

            k_token = token_m.group(1) if token_m else ""
            k_exp = exp_m.group(1) if exp_m else ""

            # Step 2: Perform POST search
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
    return hd_url


def parse_hd_link_from_html(html_content: str) -> str:
    """
    Parses HTML content and searches exclusively for 'Download MP4 HD' button.
    """
    soup = BeautifulSoup(html_content, "lxml" if "lxml" in BeautifulSoup.__dict__ else "html.parser")
    
    anchors = soup.find_all("a")
    
    for anchor in anchors:
        text = anchor.get_text(strip=True)
        # Strictly match 'Download MP4 HD' (case-insensitive)
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
