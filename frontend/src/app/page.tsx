"use client";

import { useState, useEffect, useRef } from "react";
import { Download, AlertCircle, CheckCircle2, Clipboard, X, Loader2, Video, Layers, Archive, RefreshCw, User, CheckSquare, Square, Eye, Heart, Play, Pause, RotateCcw, StopCircle, ExternalLink, Sparkles, ArrowRight } from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

interface DownloadProgress {
  task_id: string;
  status: "extracting" | "completed" | "error" | "cancelled";
  filename: string;
  cdn_url: string;
  download_stream_url?: string;
  error: string;
}

interface BatchItem {
  id: number;
  url: string;
  status: "pending" | "extracting" | "completed" | "error" | "cancelled";
  filename: string;
  cdn_url: string;
  download_url: string;
  error: string;
}

interface BatchProgress {
  batch_id: string;
  status: "processing" | "paused" | "completed" | "partial_error" | "error" | "cancelled";
  total: number;
  completed_count: number;
  failed_count: number;
  items: BatchItem[];
}

interface ProfileVideo {
  id: string;
  title: string;
  url: string;
  cover: string;
  view_count: number;
  like_count: number;
}

interface ProfileData {
  username: string;
  profile_url: string;
  total: number;
  videos: ProfileVideo[];
}

export default function Home() {
  const [mode, setMode] = useState<"single" | "batch" | "profile">("single");
  
  // Single Download states
  const [url, setUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  // Batch Download states
  const [batchUrlsText, setBatchUrlsText] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [isGeneratingZip, setIsGeneratingZip] = useState(false);
  const [retryingItemIds, setRetryingItemIds] = useState<Set<number>>(new Set());

  // Profile Search states
  const [profileInput, setProfileInput] = useState("");
  const [profileLimit, setProfileLimit] = useState<number>(0); // 0 = All Videos
  const [isFetchingProfile, setIsFetchingProfile] = useState(false);
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());

  // Video Preview Modal state
  const [previewVideo, setPreviewVideo] = useState<ProfileVideo | null>(null);
  const [previewCdnUrl, setPreviewCdnUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Error state
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const triggerBrowserDownload = (fileDownloadUrl: string, filename: string) => {
    const fullUrl = fileDownloadUrl.startsWith("http") ? fileDownloadUrl : `${API_BASE_URL}${fileDownloadUrl}`;
    const link = document.createElement("a");
    link.href = fullUrl;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Poll single task progress
  useEffect(() => {
    if (!taskId) return;

    const checkProgress = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/progress/${taskId}`);
        if (!res.ok) throw new Error("Failed to fetch progress update.");
        const data: DownloadProgress = await res.json();
        setProgress(data);

        if (data.status === "completed") {
          setIsSubmitting(false);
          stopPolling();
          if (data.download_stream_url && data.filename) {
            triggerBrowserDownload(data.download_stream_url, data.filename);
          }
        } else if (data.status === "error" || data.status === "cancelled") {
          setIsSubmitting(false);
          if (data.status === "error") {
            setErrorMsg(data.error || "Download error occurred.");
          }
          stopPolling();
        }
      } catch (err: any) {
        setErrorMsg(err.message || "Failed to communicate with backend.");
        setIsSubmitting(false);
        stopPolling();
      }
    };

    checkProgress();
    pollIntervalRef.current = setInterval(checkProgress, 500);

    return () => stopPolling();
  }, [taskId]);

  // Poll batch task progress
  useEffect(() => {
    if (!batchId) return;

    const checkBatchProgress = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/batch-progress/${batchId}`);
        if (!res.ok) throw new Error("Failed to fetch batch progress update.");
        const data: BatchProgress = await res.json();
        setBatchProgress(data);

        if (data.status === "completed" || data.status === "partial_error" || data.status === "error" || data.status === "cancelled") {
          setIsSubmitting(false);
          stopPolling();
        }
      } catch (err: any) {
        setErrorMsg(err.message || "Failed to communicate with backend.");
        setIsSubmitting(false);
        stopPolling();
      }
    };

    checkBatchProgress();
    pollIntervalRef.current = setInterval(checkBatchProgress, 800);

    return () => stopPolling();
  }, [batchId]);

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const openPreviewModal = async (video: ProfileVideo) => {
    setPreviewVideo(video);
    setPreviewCdnUrl(null);
    setPreviewError(null);
    setIsLoadingPreview(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/preview-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: video.url }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to extract CDN video preview URL.");
      setPreviewCdnUrl(data.download_url);
    } catch (err: any) {
      setPreviewError(err.message || "Failed to load direct CDN video stream.");
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handlePasteSingle = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch (err) {
      console.error("Clipboard access error:", err);
    }
  };

  const handlePasteBatch = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setBatchUrlsText((prev) => (prev ? `${prev}\n${text.trim()}` : text.trim()));
    } catch (err) {
      console.error("Clipboard access error:", err);
    }
  };

  const handlePasteProfile = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setProfileInput(text.trim());
    } catch (err) {
      console.error("Clipboard access error:", err);
    }
  };

  const parseBatchUrls = (text: string) => {
    if (!text) return [];
    return text
      .replace(/,/g, "\n")
      .replace(/ /g, "\n")
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.toLowerCase().includes("tiktok.com"));
  };

  const detectedBatchCount = parseBatchUrls(batchUrlsText).length;

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setErrorMsg(null);
    setProgress(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to initiate download.");
      setTaskId(data.task_id);
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMsg(err.message || "Could not connect to backend server.");
    }
  };

  const handleCancelSingleTask = async () => {
    if (!taskId) return;
    try {
      await fetch(`${API_BASE_URL}/api/cancel-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId }),
      });
      setIsSubmitting(false);
      setProgress((prev) => (prev ? { ...prev, status: "cancelled" } : null));
    } catch (err) {
      console.error("Failed to cancel single task:", err);
    }
  };

  const handleBatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const urls = parseBatchUrls(batchUrlsText);
    if (urls.length === 0) {
      setErrorMsg("Please paste at least one valid TikTok video URL.");
      return;
    }

    setErrorMsg(null);
    setBatchProgress(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/batch-download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to initiate batch download.");
      setBatchId(data.batch_id);
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMsg(err.message || "Could not connect to backend server.");
    }
  };

  const handleBatchControl = async (action: "pause" | "resume" | "cancel") => {
    if (!batchId) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/batch-control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id: batchId, action }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Failed to ${action} batch task.`);
      
      if (action === "cancel") {
        setIsSubmitting(false);
      }
    } catch (err: any) {
      setErrorMsg(err.message || `Error performing ${action} action.`);
    }
  };

  const handleRetryItem = async (itemId?: number) => {
    if (!batchId) return;

    setErrorMsg(null);
    setIsSubmitting(true);
    if (itemId !== undefined) {
      setRetryingItemIds((prev) => new Set(prev).add(itemId));
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/batch-retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_id: batchId,
          item_indices: itemId !== undefined ? [itemId] : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to retry batch items.");
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMsg(err.message || "Failed to retry items.");
    } finally {
      if (itemId !== undefined) {
        setRetryingItemIds((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      }
    }
  };

  const handleDownloadManualZip = () => {
    if (!batchId) return;
    setIsGeneratingZip(true);
    triggerBrowserDownload(`/api/batch-zip/${batchId}`, `Tikfetch_batch_${batchId.slice(0, 8)}.zip`);
    setTimeout(() => setIsGeneratingZip(false), 4000);
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileInput.trim()) return;

    setErrorMsg(null);
    setProfileData(null);
    setSelectedUrls(new Set());
    setIsFetchingProfile(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username_or_url: profileInput.trim(), limit: profileLimit }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to fetch user profile videos.");
      
      setProfileData(data);
      if (data.videos && data.videos.length > 0) {
        setSelectedUrls(new Set(data.videos.map((v: ProfileVideo) => v.url)));
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Could not fetch user profile videos.");
    } finally {
      setIsFetchingProfile(false);
    }
  };

  const toggleSelectVideo = (videoUrl: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(videoUrl)) {
        next.delete(videoUrl);
      } else {
        next.add(videoUrl);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!profileData || !profileData.videos) return;
    if (selectedUrls.size === profileData.videos.length) {
      setSelectedUrls(new Set());
    } else {
      setSelectedUrls(new Set(profileData.videos.map((v) => v.url)));
    }
  };

  const handleDownloadSelected = () => {
    if (selectedUrls.size === 0) return;
    const urlsArray = Array.from(selectedUrls);
    setBatchUrlsText(urlsArray.join("\n"));
    setMode("batch");
    
    setErrorMsg(null);
    setBatchProgress(null);
    setIsSubmitting(true);

    fetch(`${API_BASE_URL}/api/batch-download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: urlsArray }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.batch_id) {
          setBatchId(data.batch_id);
        } else {
          throw new Error("Failed to start batch download.");
        }
      })
      .catch((err) => {
        setIsSubmitting(false);
        setErrorMsg(err.message || "Error starting batch download.");
      });
  };

  const resetAll = () => {
    setUrl("");
    setBatchUrlsText("");
    setProfileInput("");
    setProfileData(null);
    setSelectedUrls(new Set());
    setTaskId(null);
    setBatchId(null);
    setProgress(null);
    setBatchProgress(null);
    setErrorMsg(null);
    setIsSubmitting(false);
  };

  const formatCount = (num: number) => {
    if (!num) return "0";
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#fafafa] text-[#09090b] selection:bg-[#09090b] selection:text-[#fafafa]">
      
      {/* Sticky Header Navbar */}
      <header className="sticky top-0 z-40 bg-[#ffffff]/80 backdrop-blur-md border-b border-[#e4e4e7] transition-all">
        <div className="max-w-[840px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => resetAll()}>
            <div className="w-8 h-8 rounded-[12px] bg-[#09090b] text-[#fafafa] flex items-center justify-center font-bold text-[14px]">
              T
            </div>
            <span className="font-bold text-[16px] tracking-[-0.03em] text-[#09090b]">
              Tikfetch
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#f4f4f5] border border-[#e4e4e7] text-[#71717a] rounded-full text-[11px] font-mono font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
              Direct Streaming Engine
            </span>
          </div>
        </div>
      </header>

      {/* Main Responsive Body */}
      <main className="flex-1 flex flex-col items-center justify-start p-4 sm:p-6 md:py-10 max-w-[840px] mx-auto w-full space-y-6">
        
        {/* Hero Banner Section */}
        <div className="text-center space-y-3 pt-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#f4f4f5] border border-[#e4e4e7] text-[#09090b] rounded-[18px] text-[12px] font-medium tracking-[0.03em]">
            <Sparkles className="w-3.5 h-3.5 text-[#09090b]" />
            <span>High Performance TikTok Extractor</span>
          </div>
          
          <h1 className="text-[32px] sm:text-[44px] font-bold text-[#09090b] tracking-[-0.04em] leading-[1.15]">
            TikTok HD Video Downloader
          </h1>
          
          <p className="text-[14px] text-[#71717a] max-w-[480px] mx-auto leading-[1.5]">
            Download original quality HD TikTok videos via direct browser stream. No server storage needed.
          </p>
        </div>

        {/* Segmented Mode Switcher Tabs */}
        <div className="w-full bg-[#ffffff] border border-[#e4e4e7] p-1.5 rounded-[22px] shadow-xs flex gap-1">
          <button
            type="button"
            onClick={() => { setMode("single"); setErrorMsg(null); }}
            disabled={isSubmitting || isFetchingProfile}
            className={`flex-1 py-2.5 px-3 rounded-[16px] text-[13px] sm:text-[14px] font-semibold flex items-center justify-center gap-1.5 transition-all ${
              mode === "single"
                ? "bg-[#09090b] text-[#fafafa] shadow-sm"
                : "text-[#71717a] hover:text-[#09090b] hover:bg-[#f4f4f5]"
            }`}
          >
            <Video className="w-4 h-4" />
            <span>Single Video</span>
          </button>

          <button
            type="button"
            onClick={() => { setMode("batch"); setErrorMsg(null); }}
            disabled={isSubmitting || isFetchingProfile}
            className={`flex-1 py-2.5 px-3 rounded-[16px] text-[13px] sm:text-[14px] font-semibold flex items-center justify-center gap-1.5 transition-all ${
              mode === "batch"
                ? "bg-[#09090b] text-[#fafafa] shadow-sm"
                : "text-[#71717a] hover:text-[#09090b] hover:bg-[#f4f4f5]"
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Batch Download</span>
          </button>

          <button
            type="button"
            onClick={() => { setMode("profile"); setErrorMsg(null); }}
            disabled={isSubmitting || isFetchingProfile}
            className={`flex-1 py-2.5 px-3 rounded-[16px] text-[13px] sm:text-[14px] font-semibold flex items-center justify-center gap-1.5 transition-all ${
              mode === "profile"
                ? "bg-[#09090b] text-[#fafafa] shadow-sm"
                : "text-[#71717a] hover:text-[#09090b] hover:bg-[#f4f4f5]"
            }`}
          >
            <User className="w-4 h-4" />
            <span>User Profile</span>
          </button>
        </div>

        {/* SINGLE DOWNLOAD FORM CARD */}
        {mode === "single" && (
          <div className="w-full bg-[#ffffff] rounded-[28px] border border-[#e4e4e7] p-5 sm:p-6 shadow-sm space-y-4 animate-fade-in">
            <form onSubmit={handleSingleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="tiktok-url" className="text-[12px] font-bold text-[#71717a] uppercase tracking-[0.05em]">
                  TikTok Video Link
                </label>
                
                <div className="relative flex items-center">
                  <input
                    id="tiktok-url"
                    type="text"
                    placeholder="https://www.tiktok.com/@username/video/..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full bg-[#f4f4f5] text-[#09090b] placeholder-[#a1a1aa] text-[14px] font-medium rounded-[18px] px-4 py-3.5 pr-24 border border-transparent focus:border-[#e4e4e7] focus:bg-[#ffffff] focus:outline-none focus:ring-2 focus:ring-[#09090b] disabled:opacity-50 transition"
                  />
                  
                  <div className="absolute right-2 flex items-center gap-1">
                    {url ? (
                      <button
                        type="button"
                        onClick={() => setUrl("")}
                        disabled={isSubmitting}
                        className="p-1.5 text-[#71717a] hover:text-[#09090b] rounded-[16px] transition"
                        title="Clear input"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handlePasteSingle}
                        disabled={isSubmitting}
                        className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-semibold bg-[#ffffff] hover:bg-[#f4f4f5] border border-[#e4e4e7] text-[#09090b] rounded-[14px] transition shadow-2xs"
                      >
                        <Clipboard className="w-3.5 h-3.5 text-[#71717a]" />
                        <span>Paste</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !url.trim()}
                className="w-full bg-[#09090b] hover:bg-[#18181b] active:scale-[0.99] disabled:bg-[#e4e4e7] disabled:text-[#a1a1aa] disabled:cursor-not-allowed text-[#fafafa] font-semibold text-[14px] py-3.5 px-4 rounded-[18px] flex items-center justify-center gap-2 transition shadow-xs"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#fafafa]" />
                    <span>Extracting Direct Stream...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Download MP4 HD Stream</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* BATCH DOWNLOAD FORM CARD */}
        {mode === "batch" && (
          <div className="w-full bg-[#ffffff] rounded-[28px] border border-[#e4e4e7] p-5 sm:p-6 shadow-sm space-y-4 animate-fade-in">
            <form onSubmit={handleBatchSubmit} className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center text-[12px]">
                  <label htmlFor="batch-urls" className="font-bold text-[#71717a] uppercase tracking-[0.05em]">
                    TikTok Video Links (1 link per line)
                  </label>
                  <span className="font-mono font-medium text-[#09090b] bg-[#f4f4f5] border border-[#e4e4e7] px-2.5 py-0.5 rounded-[14px]">
                    {detectedBatchCount} {detectedBatchCount === 1 ? "link" : "links"} detected
                  </span>
                </div>

                <div className="relative">
                  <textarea
                    id="batch-urls"
                    rows={5}
                    placeholder={"https://www.tiktok.com/@username/video/123456789\nhttps://vm.tiktok.com/ZSj1aXy2q/\nhttps://www.tiktok.com/@user/video/987654321"}
                    value={batchUrlsText}
                    onChange={(e) => setBatchUrlsText(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full bg-[#f4f4f5] text-[#09090b] placeholder-[#a1a1aa] text-[13px] font-mono rounded-[18px] p-4 border border-transparent focus:border-[#e4e4e7] focus:bg-[#ffffff] focus:outline-none focus:ring-2 focus:ring-[#09090b] disabled:opacity-50 transition resize-y"
                  />
                  <button
                    type="button"
                    onClick={handlePasteBatch}
                    disabled={isSubmitting}
                    className="absolute right-3 bottom-4 flex items-center gap-1 px-3 py-1.5 text-[12px] font-semibold bg-[#ffffff] border border-[#e4e4e7] hover:bg-[#f4f4f5] text-[#09090b] rounded-[14px] transition shadow-2xs"
                  >
                    <Clipboard className="w-3.5 h-3.5 text-[#71717a]" />
                    <span>Paste Links</span>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || detectedBatchCount === 0}
                className="w-full bg-[#09090b] hover:bg-[#18181b] active:scale-[0.99] disabled:bg-[#e4e4e7] disabled:text-[#a1a1aa] disabled:cursor-not-allowed text-[#fafafa] font-semibold text-[14px] py-3.5 px-4 rounded-[18px] flex items-center justify-center gap-2 transition shadow-xs"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#fafafa]" />
                    <span>Processing Batch ({detectedBatchCount} Videos)...</span>
                  </>
                ) : (
                  <>
                    <Archive className="w-4 h-4" />
                    <span>Process Batch ({detectedBatchCount} Videos)</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* USER PROFILE SEARCH & EXPLORER FORM CARD */}
        {mode === "profile" && (
          <div className="w-full bg-[#ffffff] rounded-[28px] border border-[#e4e4e7] p-5 sm:p-6 shadow-sm space-y-4 animate-fade-in">
            <form onSubmit={handleProfileSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-2">
                  <label htmlFor="profile-username" className="text-[12px] font-bold text-[#71717a] uppercase tracking-[0.05em]">
                    TikTok Username or Profile Link
                  </label>
                  
                  <div className="relative flex items-center">
                    <input
                      id="profile-username"
                      type="text"
                      placeholder="@khaby.lame or https://www.tiktok.com/@username"
                      value={profileInput}
                      onChange={(e) => setProfileInput(e.target.value)}
                      disabled={isFetchingProfile}
                      className="w-full bg-[#f4f4f5] text-[#09090b] placeholder-[#a1a1aa] text-[14px] font-medium rounded-[18px] px-4 py-3.5 pr-24 border border-transparent focus:border-[#e4e4e7] focus:bg-[#ffffff] focus:outline-none focus:ring-2 focus:ring-[#09090b] disabled:opacity-50 transition"
                    />
                    
                    <div className="absolute right-2 flex items-center gap-1">
                      {profileInput ? (
                        <button
                          type="button"
                          onClick={() => setProfileInput("")}
                          disabled={isFetchingProfile}
                          className="p-1.5 text-[#71717a] hover:text-[#09090b] rounded-[16px] transition"
                          title="Clear input"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handlePasteProfile}
                          disabled={isFetchingProfile}
                          className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-semibold bg-[#ffffff] hover:bg-[#f4f4f5] border border-[#e4e4e7] text-[#09090b] rounded-[14px] transition shadow-2xs"
                        >
                          <Clipboard className="w-3.5 h-3.5 text-[#71717a]" />
                          <span>Paste</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="profile-limit" className="text-[12px] font-bold text-[#71717a] uppercase tracking-[0.05em]">
                    Fetch Limit
                  </label>
                  <select
                    id="profile-limit"
                    value={profileLimit}
                    onChange={(e) => setProfileLimit(Number(e.target.value))}
                    disabled={isFetchingProfile}
                    className="w-full bg-[#f4f4f5] text-[#09090b] text-[14px] font-semibold rounded-[18px] px-3.5 py-3.5 border border-transparent focus:border-[#e4e4e7] focus:bg-[#ffffff] focus:outline-none focus:ring-2 focus:ring-[#09090b] disabled:opacity-50 transition cursor-pointer"
                  >
                    <option value={0}>All Available Videos</option>
                    <option value={30}>Max 30 Videos</option>
                    <option value={50}>Max 50 Videos</option>
                    <option value={100}>Max 100 Videos</option>
                    <option value={200}>Max 200 Videos</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={isFetchingProfile || !profileInput.trim()}
                className="w-full bg-[#09090b] hover:bg-[#18181b] active:scale-[0.99] disabled:bg-[#e4e4e7] disabled:text-[#a1a1aa] disabled:cursor-not-allowed text-[#fafafa] font-semibold text-[14px] py-3.5 px-4 rounded-[18px] flex items-center justify-center gap-2 transition shadow-xs"
              >
                {isFetchingProfile ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#fafafa]" />
                    <span>Fetching User Videos...</span>
                  </>
                ) : (
                  <>
                    <User className="w-4 h-4" />
                    <span>Fetch User Videos</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* PROFILE VIDEOS SELECTION POSTER GRID */}
        {mode === "profile" && profileData && (
          <div className="w-full bg-[#ffffff] border border-[#e4e4e7] rounded-[28px] p-5 sm:p-6 shadow-sm space-y-5 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#e4e4e7]">
              <div>
                <h3 className="text-[18px] font-bold text-[#09090b] flex items-center gap-2">
                  <span>@{profileData.username}</span>
                  <span className="text-[12px] font-mono font-semibold text-[#71717a] bg-[#f4f4f5] border border-[#e4e4e7] px-2.5 py-0.5 rounded-[14px]">
                    {profileData.total} videos
                  </span>
                </h3>
                <p className="text-[13px] text-[#71717a] mt-0.5">
                  Click cards to select for batch download or click play to preview stream.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="px-3.5 py-2 bg-[#f4f4f5] hover:bg-[#e4e4e7] text-[#09090b] rounded-[16px] text-[13px] font-semibold flex items-center gap-2 transition"
                >
                  {selectedUrls.size === profileData.videos.length ? (
                    <>
                      <CheckSquare className="w-4 h-4 text-[#09090b]" />
                      <span>Deselect All</span>
                    </>
                  ) : (
                    <>
                      <Square className="w-4 h-4 text-[#71717a]" />
                      <span>Select All ({profileData.videos.length})</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Selection Status & Action Bar */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-mono text-[#71717a]">
                Selected: <strong className="text-[#09090b]">{selectedUrls.size}</strong> / {profileData.videos.length}
              </span>

              <button
                type="button"
                onClick={handleDownloadSelected}
                disabled={selectedUrls.size === 0 || isSubmitting}
                className="bg-[#09090b] hover:bg-[#18181b] active:scale-[0.99] disabled:bg-[#e4e4e7] disabled:text-[#a1a1aa] disabled:cursor-not-allowed text-[#fafafa] font-semibold text-[13px] sm:text-[14px] py-2.5 px-5 rounded-[16px] flex items-center justify-center gap-2 transition shadow-xs"
              >
                <Download className="w-4 h-4" />
                <span>Download Selected ({selectedUrls.size})</span>
              </button>
            </div>

            {/* Poster Card Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 max-h-[540px] overflow-y-auto pr-1">
              {profileData.videos.map((video) => {
                const isSelected = selectedUrls.has(video.url);
                return (
                  <div
                    key={video.id}
                    className={`group relative rounded-[20px] overflow-hidden border transition-all duration-200 select-none flex flex-col ${
                      isSelected
                        ? "border-[#09090b] ring-2 ring-[#09090b] shadow-md bg-[#ffffff]"
                        : "border-[#e4e4e7] bg-[#fafafa] hover:border-[#09090b]"
                    }`}
                  >
                    <div 
                      className="relative aspect-[3/4] w-full bg-[#18181b] overflow-hidden cursor-pointer"
                      onClick={() => toggleSelectVideo(video.url)}
                    >
                      {video.cover ? (
                        <img
                          src={video.cover}
                          alt={video.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = "none";
                          }}
                        />
                      ) : null}

                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />

                      <div className="absolute top-2.5 left-2.5 z-10">
                        <div
                          className={`w-7 h-7 rounded-[10px] flex items-center justify-center transition-all ${
                            isSelected
                              ? "bg-[#09090b] text-[#fafafa] shadow-md"
                              : "bg-[#ffffff]/80 backdrop-blur-xs text-[#71717a] border border-[#e4e4e7]"
                          }`}
                        >
                          {isSelected ? (
                            <CheckCircle2 className="w-4 h-4 text-[#fafafa]" />
                          ) : (
                            <Square className="w-4 h-4 text-[#71717a]" />
                          )}
                        </div>
                      </div>

                      <div className="absolute top-2.5 right-2.5 z-10">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openPreviewModal(video);
                          }}
                          className="w-7 h-7 bg-[#09090b]/80 hover:bg-[#09090b] text-[#fafafa] rounded-[10px] flex items-center justify-center transition backdrop-blur-xs shadow-xs"
                          title="Preview CDN stream"
                        >
                          <Play className="w-3.5 h-3.5 text-[#fafafa] ml-0.5" />
                        </button>
                      </div>

                      <div className="absolute bottom-2.5 left-2.5 right-2.5 z-10 text-white space-y-1">
                        <div className="flex items-center gap-2 text-[11px] font-mono text-[#ffffff]/90">
                          {video.view_count > 0 && (
                            <span className="flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded-[10px] backdrop-blur-xs">
                              <Eye className="w-3 h-3 text-[#fafafa]" />
                              {formatCount(video.view_count)}
                            </span>
                          )}
                          {video.like_count > 0 && (
                            <span className="flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded-[10px] backdrop-blur-xs">
                              <Heart className="w-3 h-3 text-[#fafafa]" />
                              {formatCount(video.like_count)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div 
                      className="p-2.5 bg-[#ffffff] cursor-pointer flex-1 flex flex-col justify-between"
                      onClick={() => toggleSelectVideo(video.url)}
                    >
                      <p className="text-[12px] font-medium text-[#09090b] line-clamp-2 leading-[1.3]">
                        {video.title || `TikTok Video ${video.id}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* MOBILE STICKY FLOATING ACTION BAR FOR PROFILE SELECTION */}
        {mode === "profile" && profileData && selectedUrls.size > 0 && (
          <div className="fixed bottom-4 left-4 right-4 z-40 sm:hidden animate-fade-in">
            <div className="bg-[#09090b] text-[#fafafa] p-3 rounded-[20px] shadow-2xl flex items-center justify-between gap-3 border border-[#27272a]">
              <span className="text-[13px] font-medium px-2">
                Selected: <strong className="font-mono">{selectedUrls.size}</strong> videos
              </span>
              <button
                type="button"
                onClick={handleDownloadSelected}
                disabled={isSubmitting}
                className="bg-[#ffffff] text-[#09090b] hover:bg-[#f4f4f5] px-4 py-2.5 rounded-[14px] text-[13px] font-bold flex items-center gap-1.5 transition"
              >
                <Download className="w-4 h-4 text-[#09090b]" />
                <span>Download</span>
              </button>
            </div>
          </div>
        )}

        {/* DIRECT CDN VIDEO PREVIEW MODAL DIALOG */}
        {previewVideo && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-[#ffffff] border border-[#e4e4e7] rounded-[28px] max-w-[460px] w-full p-5 space-y-4 shadow-2xl relative">
              <div className="flex items-start justify-between gap-3 border-b border-[#e4e4e7] pb-3">
                <div className="min-w-0 pr-2">
                  <h3 className="text-[15px] font-bold text-[#09090b] truncate">
                    {previewVideo.title || `CDN Video Stream`}
                  </h3>
                  <p className="text-[12px] font-mono text-[#71717a]">
                    Direct Stream HD
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setPreviewVideo(null);
                    setPreviewCdnUrl(null);
                    setPreviewError(null);
                  }}
                  className="p-1.5 text-[#71717a] hover:text-[#09090b] hover:bg-[#f4f4f5] rounded-[16px] transition shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="w-full bg-[#09090b] rounded-[20px] overflow-hidden aspect-[9/16] max-h-[460px] relative flex items-center justify-center">
                {isLoadingPreview ? (
                  <div className="flex flex-col items-center gap-2.5 text-[#fafafa] text-[13px] p-6 text-center">
                    <Loader2 className="w-7 h-7 animate-spin text-[#fafafa]" />
                    <span>Extracting Direct HD CDN Stream...</span>
                  </div>
                ) : previewError ? (
                  <div className="flex flex-col items-center gap-2.5 text-[#ef4444] text-[13px] p-6 text-center">
                    <AlertCircle className="w-7 h-7 text-[#ef4444]" />
                    <span>{previewError}</span>
                  </div>
                ) : previewCdnUrl ? (
                  <video
                    src={previewCdnUrl}
                    controls
                    autoPlay
                    playsInline
                    className="w-full h-full object-contain rounded-[20px]"
                  />
                ) : null}
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    toggleSelectVideo(previewVideo.url);
                  }}
                  className={`flex-1 py-2.5 px-4 rounded-[16px] text-[13px] font-semibold flex items-center justify-center gap-2 transition ${
                    selectedUrls.has(previewVideo.url)
                      ? "bg-[#09090b] text-[#fafafa]"
                      : "bg-[#f4f4f5] hover:bg-[#e4e4e7] text-[#09090b]"
                  }`}
                >
                  {selectedUrls.has(previewVideo.url) ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-[#fafafa]" />
                      <span>Selected for Download</span>
                    </>
                  ) : (
                    <>
                      <Square className="w-4 h-4 text-[#71717a]" />
                      <span>Select Video</span>
                    </>
                  )}
                </button>

                {previewCdnUrl && (
                  <a
                    href={previewCdnUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2.5 bg-[#f4f4f5] hover:bg-[#e4e4e7] text-[#09090b] rounded-[16px] flex items-center justify-center transition"
                    title="Open Raw CDN URL"
                  >
                    <ExternalLink className="w-4 h-4 text-[#71717a]" />
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ERROR ALERT CARD */}
        {errorMsg && (
          <div className="w-full bg-[#ffffff] border border-[#fecdd3] rounded-[24px] p-5 shadow-xs flex items-start gap-3.5 animate-fade-in">
            <div className="p-2 bg-[#fff1f2] rounded-[16px] text-[#ef4444] shrink-0 mt-0.5">
              <AlertCircle className="w-5 h-5 text-[#ef4444]" />
            </div>
            
            <div className="flex-1 text-[14px] space-y-1">
              <div className="font-bold text-[#09090b]">Error Encountered</div>
              <div className="text-[#71717a] leading-[1.45]">{errorMsg}</div>
            </div>

            <button
              onClick={() => setErrorMsg(null)}
              className="text-[#71717a] hover:text-[#09090b] text-[12px] font-semibold underline shrink-0 pt-0.5"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* SINGLE PROGRESS DISPLAY CARD */}
        {mode === "single" && progress && progress.status !== "completed" && progress.status !== "error" && progress.status !== "cancelled" && (
          <div className="w-full bg-[#ffffff] border border-[#e4e4e7] rounded-[28px] p-5 sm:p-6 shadow-sm space-y-4 animate-fade-in">
            <div className="flex items-center justify-between text-[14px]">
              <div className="flex items-center gap-2 font-semibold text-[#09090b]">
                <Loader2 className="w-4 h-4 text-[#09090b] animate-spin" />
                <span>Locating MP4 HD video source stream...</span>
              </div>
              <button
                type="button"
                onClick={handleCancelSingleTask}
                className="px-3 py-1.5 bg-[#f4f4f5] hover:bg-[#e4e4e7] text-[#09090b] rounded-[14px] text-[12px] font-semibold transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* SINGLE SUCCESS CARD */}
        {mode === "single" && progress && progress.status === "completed" && (
          <div className="w-full bg-[#ffffff] border border-[#e4e4e7] rounded-[28px] p-5 sm:p-6 shadow-sm space-y-4 animate-fade-in">
            <div className="flex items-start gap-3.5">
              <div className="p-2 bg-[#f4f4f5] rounded-[16px] text-[#09090b]">
                <CheckCircle2 className="w-5 h-5 text-[#09090b]" />
              </div>
              
              <div className="space-y-1">
                <h3 className="text-[16px] font-bold text-[#09090b]">
                  Download Ready
                </h3>
                <p className="text-[14px] text-[#71717a]">
                  Direct browser stream has been triggered automatically.
                </p>
              </div>
            </div>

            <div className="bg-[#f4f4f5] rounded-[18px] p-4 space-y-3 text-[14px] border border-[#e4e4e7]">
              <div className="flex items-center justify-between">
                <span className="text-[#71717a] text-[12px] uppercase font-bold tracking-[0.05em]">Filename</span>
                <span className="font-mono font-medium text-[#09090b] text-[13px] truncate max-w-[260px]">
                  {progress.filename}
                </span>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              {progress.download_stream_url && (
                <button
                  onClick={() => triggerBrowserDownload(progress.download_stream_url!, progress.filename)}
                  className="w-full bg-[#09090b] hover:bg-[#18181b] text-[#fafafa] font-semibold text-[14px] py-3.5 px-4 rounded-[18px] flex items-center justify-center gap-2 transition shadow-xs"
                >
                  <Download className="w-4 h-4" />
                  <span>Download MP4 Video Stream Again</span>
                </button>
              )}

              <button
                onClick={resetAll}
                className="w-full bg-[#f4f4f5] hover:bg-[#e4e4e7] text-[#09090b] font-semibold text-[14px] py-3.5 px-4 rounded-[18px] flex items-center justify-center gap-2 transition"
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#71717a]" />
                <span>Download Another Video</span>
              </button>
            </div>
          </div>
        )}

        {/* BATCH PROGRESS DISPLAY & CONTROL CARD */}
        {mode === "batch" && batchProgress && (
          <div className="w-full bg-[#ffffff] border border-[#e4e4e7] rounded-[28px] p-5 sm:p-6 shadow-sm space-y-5 animate-fade-in">
            <div className="flex items-center justify-between gap-3 text-[14px]">
              <div className="flex items-center gap-2 font-bold text-[#09090b] min-w-0">
                {batchProgress.status === "processing" ? (
                  <Loader2 className="w-4 h-4 text-[#09090b] animate-spin shrink-0" />
                ) : batchProgress.status === "paused" ? (
                  <Pause className="w-4 h-4 text-[#71717a] shrink-0" />
                ) : batchProgress.status === "cancelled" ? (
                  <StopCircle className="w-4 h-4 text-[#ef4444] shrink-0" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-[#09090b] shrink-0" />
                )}
                <span className="truncate">
                  {batchProgress.status === "processing"
                    ? `Processing Batch (${batchProgress.completed_count + batchProgress.failed_count} / ${batchProgress.total})`
                    : batchProgress.status === "paused"
                    ? "Batch Processing Paused"
                    : batchProgress.status === "cancelled"
                    ? "Batch Processing Cancelled"
                    : "Batch Processing Complete"}
                </span>
              </div>

              {/* Action Control Buttons */}
              <div className="flex items-center gap-1.5 shrink-0">
                {batchProgress.status === "processing" && (
                  <button
                    type="button"
                    onClick={() => handleBatchControl("pause")}
                    className="px-2.5 py-1.5 bg-[#f4f4f5] hover:bg-[#e4e4e7] text-[#09090b] rounded-[14px] text-[12px] font-semibold flex items-center gap-1 transition"
                  >
                    <Pause className="w-3.5 h-3.5 text-[#09090b]" />
                    <span>Pause</span>
                  </button>
                )}

                {batchProgress.status === "paused" && (
                  <button
                    type="button"
                    onClick={() => handleBatchControl("resume")}
                    className="px-2.5 py-1.5 bg-[#09090b] hover:bg-[#18181b] text-[#fafafa] rounded-[14px] text-[12px] font-semibold flex items-center gap-1 transition"
                  >
                    <Play className="w-3.5 h-3.5 text-[#fafafa]" />
                    <span>Resume</span>
                  </button>
                )}

                {(batchProgress.status === "processing" || batchProgress.status === "paused") && (
                  <button
                    type="button"
                    onClick={() => handleBatchControl("cancel")}
                    className="px-2.5 py-1.5 bg-[#fff1f2] hover:bg-[#ffe4e6] text-[#ef4444] rounded-[14px] text-[12px] font-semibold flex items-center gap-1 transition"
                  >
                    <X className="w-3.5 h-3.5 text-[#ef4444]" />
                    <span>Cancel</span>
                  </button>
                )}

                <span className="text-[#71717a] font-mono text-[12px] ml-1">
                  {batchProgress.completed_count} / {batchProgress.total} Ready
                </span>
              </div>
            </div>

            <div className="w-full bg-[#f4f4f5] rounded-[18px] h-2.5 overflow-hidden p-0.5 border border-[#e4e4e7]">
              <div
                className={`h-full transition-all duration-300 ease-out rounded-[18px] ${
                  batchProgress.status === "paused"
                    ? "bg-[#71717a]"
                    : batchProgress.status === "cancelled"
                    ? "bg-[#ef4444]"
                    : "bg-[#09090b]"
                }`}
                style={{
                  width: `${((batchProgress.completed_count + batchProgress.failed_count) / batchProgress.total) * 100}%`,
                }}
              />
            </div>

            {/* Top-Level Retry All Failed Button */}
            {batchProgress.failed_count > 0 && batchProgress.status !== "processing" && batchProgress.status !== "paused" && (
              <div className="flex justify-between items-center p-3 bg-[#fff1f2] border border-[#fecdd3] rounded-[18px]">
                <div className="text-[13px] text-[#9f1239] font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-[#9f1239]" />
                  <span>{batchProgress.failed_count} item(s) failed extraction</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRetryItem()}
                  className="px-3 py-1.5 bg-[#9f1239] hover:bg-[#881337] text-[#ffffff] rounded-[14px] text-[12px] font-semibold flex items-center gap-1.5 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retry All Failed</span>
                </button>
              </div>
            )}

            {/* Itemized Batch List */}
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1 text-[13px]">
              {batchProgress.items.map((item) => (
                <div
                  key={item.id}
                  className="bg-[#f4f4f5] border border-[#e4e4e7] rounded-[18px] p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-[#71717a]">#{item.id + 1}</span>
                      <span className="font-medium text-[#09090b] truncate text-[13px]">
                        {item.filename || item.url}
                      </span>
                    </div>
                    {item.error && (
                      <div className="text-[#ef4444] text-[11px] truncate">{item.error}</div>
                    )}
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {item.status === "completed" && (
                      <span className="px-2.5 py-1 bg-[#09090b] text-[#fafafa] rounded-[14px] text-[11px] font-semibold">
                        Ready
                      </span>
                    )}

                    {(item.status === "extracting" || item.status === "pending") && (
                      <span className="px-2.5 py-1 bg-[#ffffff] text-[#09090b] border border-[#e4e4e7] rounded-[14px] text-[11px] font-semibold flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin text-[#09090b]" />
                        <span className="capitalize">{item.status}</span>
                      </span>
                    )}

                    {item.status === "cancelled" && (
                      <span className="px-2.5 py-1 bg-[#ffffff] text-[#71717a] border border-[#e4e4e7] rounded-[14px] text-[11px] font-semibold">
                        Cancelled
                      </span>
                    )}

                    {item.status === "error" && (
                      <div className="flex items-center gap-1.5">
                        <span className="px-2.5 py-1 bg-[#ffffff] text-[#ef4444] border border-[#e4e4e7] rounded-[14px] text-[11px] font-semibold">
                          Failed
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRetryItem(item.id)}
                          disabled={retryingItemIds.has(item.id)}
                          className="px-2.5 py-1 bg-[#09090b] hover:bg-[#18181b] text-[#fafafa] rounded-[12px] text-[11px] font-semibold flex items-center gap-1 transition"
                          title="Retry this item"
                        >
                          <RotateCcw className={`w-3 h-3 ${retryingItemIds.has(item.id) ? "animate-spin" : ""}`} />
                          <span>Retry</span>
                        </button>
                      </div>
                    )}

                    {/* Preview Button */}
                    <button
                      type="button"
                      onClick={() => openPreviewModal({ id: item.id.toString(), title: item.filename || item.url, url: item.url, cover: "", view_count: 0, like_count: 0 })}
                      className="p-1.5 text-[#09090b] hover:bg-[#e4e4e7] rounded-[14px] transition"
                      title="Preview Video Stream"
                    >
                      <Play className="w-4 h-4" />
                    </button>

                    {item.download_url && (
                      <button
                        type="button"
                        onClick={() => triggerBrowserDownload(item.download_url, item.filename)}
                        className="p-1.5 text-[#09090b] hover:bg-[#e4e4e7] rounded-[14px] transition"
                        title="Download MP4 Stream"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Batch ZIP & Reset Buttons */}
            {batchProgress.status !== "processing" && batchProgress.status !== "paused" && (
              <div className="space-y-2 pt-2 border-t border-[#e4e4e7]">
                {batchProgress.completed_count > 0 && (
                  <button
                    type="button"
                    onClick={handleDownloadManualZip}
                    disabled={isGeneratingZip}
                    className="w-full bg-[#09090b] hover:bg-[#18181b] active:scale-[0.99] disabled:bg-[#e4e4e7] text-[#fafafa] font-semibold text-[14px] py-3.5 px-4 rounded-[18px] flex items-center justify-center gap-2 transition shadow-xs"
                  >
                    {isGeneratingZip ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-[#fafafa]" />
                        <span>Packaging ZIP File in Memory...</span>
                      </>
                    ) : (
                      <>
                        <Archive className="w-4 h-4" />
                        <span>Download Batch as ZIP (.zip)</span>
                      </>
                    )}
                  </button>
                )}

                <button
                  onClick={resetAll}
                  className="w-full bg-[#f4f4f5] hover:bg-[#e4e4e7] text-[#09090b] font-semibold text-[14px] py-3.5 px-4 rounded-[18px] flex items-center justify-center gap-2 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#71717a]" />
                  <span>Start New Download</span>
                </button>
              </div>
            )}
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="w-full border-t border-[#e4e4e7] py-4 bg-[#ffffff]">
        <div className="max-w-[840px] mx-auto px-4 text-center text-[12px] font-mono text-[#71717a]">
          Tikfetch &bull; High-Performance TikTok Video Extractor
        </div>
      </footer>

    </div>
  );
}
