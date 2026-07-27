import unittest
from extractor import (
    parse_hd_link_from_html,
    validate_tiktok_url,
    extract_tiktok_metadata,
    HDNotAvailableError,
    InvalidURLError
)


class TestTikTokExtractor(unittest.TestCase):
    
    def test_valid_tiktok_urls(self):
        valid_urls = [
            "https://www.tiktok.com/@username/video/123456789",
            "https://vm.tiktok.com/ZSj1aXy2q/",
            "https://vt.tiktok.com/ZSj1aXy2q/",
            "http://tiktok.com/@test/video/987654321"
        ]
        for url in valid_urls:
            self.assertEqual(validate_tiktok_url(url), url)

    def test_invalid_tiktok_urls(self):
        invalid_urls = [
            "https://google.com",
            "not_a_url",
            "https://youtube.com/watch?v=12345"
        ]
        for url in invalid_urls:
            with self.assertRaises(InvalidURLError):
                validate_tiktok_url(url)

    def test_extract_tiktok_metadata_filename(self):
        url = "https://www.tiktok.com/@khaby.lame/video/6987114400584731909"
        meta = extract_tiktok_metadata(url)
        self.assertEqual(meta["username"], "khaby.lame")
        self.assertEqual(meta["video_id"], "6987114400584731909")
        self.assertEqual(meta["filename"], "Tikfetch_@khaby.lame_6987114400584731909.mp4")

    def test_parse_hd_link_success(self):
        sample_html = """
        <div class="download-links">
            <a href="https://tik-cdn.com/download_hd.mp4" class="btn btn-hd">Download MP4 HD</a>
            <a href="https://tik-cdn.com/download_sd.mp4" class="btn">Download MP4 [1]</a>
            <a href="https://tik-cdn.com/download_audio.mp3" class="btn">Download MP3</a>
        </div>
        """
        hd_link = parse_hd_link_from_html(sample_html)
        self.assertEqual(hd_link, "https://tik-cdn.com/download_hd.mp4")

    def test_parse_hd_link_missing_raises_hd_error(self):
        sample_html_no_hd = """
        <div class="download-links">
            <a href="https://tik-cdn.com/download_sd.mp4" class="btn">Download MP4 [1]</a>
            <a href="https://tik-cdn.com/download_sd2.mp4" class="btn">Download MP4 [2]</a>
            <a href="https://tik-cdn.com/download_audio.mp3" class="btn">Download MP3</a>
        </div>
        """
        with self.assertRaises(HDNotAvailableError) as ctx:
            parse_hd_link_from_html(sample_html_no_hd)
        self.assertEqual(str(ctx.exception), "HD version is not available for this video.")


if __name__ == "__main__":
    unittest.main()
