"use client";

import { useState, useCallback } from "react";
import { Globe, Clock, AlertCircle, Loader2, RefreshCw } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BrowserScreenshotEvent = {
  type: "browser_screenshot";
  filename: string;
  session_name: string;
  status: "started" | "completed" | "failed";
  error?: string;
  timestamp: string;
  session_id: string;
  correlation_id?: string;
};

export type BrowserNavigateEvent = {
  type: "browser_navigate";
  url: string;
  session_name: string;
  status: "started" | "completed" | "failed";
  error?: string;
  timestamp: string;
  session_id: string;
  correlation_id?: string;
};

export interface BrowserPreviewProps {
  /** Current screenshot filename (relative to workspace) */
  screenshotPath?: string;
  /** Current URL being displayed */
  currentUrl?: string;
  /** Browser session name */
  sessionName?: string;
  /** Screenshot timestamp */
  screenshotTimestamp?: string;
  /** Loading state */
  isLoading?: boolean;
  /** Error message if screenshot failed */
  error?: string;
  /** CSS class name */
  className?: string;
  /** Height of the preview area */
  height?: number;
  /** Callback when screenshot needs to be refreshed */
  onRefresh?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BrowserPreview({
  screenshotPath,
  currentUrl,
  sessionName = "default",
  screenshotTimestamp,
  isLoading = false,
  error,
  className = "",
  height = 400,
  onRefresh,
}: BrowserPreviewProps) {
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  
  // Derive image URL from screenshot path
  const imageUrl = screenshotPath ? `/api/workspace/files/${screenshotPath}` : null;

  // ── Handle image load events ──────────────────────────────────────────────
  const handleImageLoad = useCallback(() => {
    setImageLoading(false);
    setImageError(null);
  }, []);

  const handleImageError = useCallback(() => {
    setImageLoading(false);
    setImageError("Failed to load screenshot");
  }, []);

  // ── Handle image start loading ────────────────────────────────────────────
  const handleImageStartLoad = useCallback(() => {
    setImageLoading(true);
    setImageError(null);
  }, []);

  // ── Format timestamp ──────────────────────────────────────────────────────
  const formatTimestamp = useCallback((timestamp?: string) => {
    if (!timestamp) return "Unknown time";
    
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch {
      return "Invalid timestamp";
    }
  }, []);

  // ── Format URL for display ────────────────────────────────────────────────
  const formatUrl = useCallback((url?: string) => {
    if (!url) return "No URL";
    
    try {
      const urlObj = new URL(url);
      return urlObj.hostname + urlObj.pathname + urlObj.search;
    } catch {
      return url;
    }
  }, []);

  // ── Render no-screenshot state ────────────────────────────────────────────
  const renderNoScreenshot = () => (
    <div className="flex h-full items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <Globe className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600 mb-4" />
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          No browser screenshot available
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Screenshots will appear here when the agent takes them
        </p>
      </div>
    </div>
  );

  // ── Render error state ────────────────────────────────────────────────────
  const renderError = (errorMessage: string) => (
    <div className="flex h-full items-center justify-center bg-red-50 dark:bg-red-900/20">
      <div className="text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-red-500 dark:text-red-400 mb-4" />
        <p className="text-sm text-red-600 dark:text-red-400 mb-2">
          Screenshot Error
        </p>
        <p className="text-xs text-red-500 dark:text-red-300 mb-4">
          {errorMessage}
        </p>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        )}
      </div>
    </div>
  );

  // ── Render loading state ──────────────────────────────────────────────────
  const renderLoading = () => (
    <div className="flex h-full items-center justify-center bg-blue-50 dark:bg-blue-900/20">
      <div className="text-center">
        <Loader2 className="mx-auto h-8 w-8 text-blue-500 dark:text-blue-400 animate-spin mb-4" />
        <p className="text-sm text-blue-600 dark:text-blue-400">
          Taking screenshot...
        </p>
      </div>
    </div>
  );

  return (
    <div className={`browser-preview-container ${className}`}>
      {/* Browser toolbar */}
      <div className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Browser session indicator */}
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {sessionName}
            </span>
          </div>
          
          {/* URL bar (read-only) */}
          <div className="flex-1 min-w-0">
            <div className="px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 truncate">
              {formatUrl(currentUrl)}
            </div>
          </div>
        </div>

        {/* Timestamp and refresh */}
        <div className="flex items-center gap-2 ml-3">
          {screenshotTimestamp && (
            <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <Clock className="w-3 h-3" />
              <span>{formatTimestamp(screenshotTimestamp)}</span>
            </div>
          )}
          
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              title="Refresh screenshot"
            >
              <RefreshCw className={`w-4 h-4 text-gray-600 dark:text-gray-400 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Screenshot display area */}
      <div 
        className="browser-screenshot-area relative overflow-hidden bg-white dark:bg-gray-900"
        style={{ height: `${height}px` }}
      >
        {/* Loading state */}
        {(isLoading || imageLoading) && renderLoading()}
        
        {/* Error state */}
        {!isLoading && !imageLoading && (error || imageError) && 
          renderError(error || imageError || "Unknown error")}
        
        {/* No screenshot state */}
        {!isLoading && !imageLoading && !error && !imageError && !imageUrl && 
          renderNoScreenshot()}
        
        {/* Screenshot image */}
        {!isLoading && !error && imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={screenshotPath} // Reset component when path changes
            src={imageUrl}
            alt="Browser screenshot"
            className={`w-full h-full object-contain ${imageLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-200`}
            onLoadStart={handleImageStartLoad}
            onLoad={handleImageLoad}
            onError={handleImageError}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Utility functions ─────────────────────────────────────────────────────────

/**
 * Converts browser screenshot event to props for BrowserPreview component
 */
export function screenshotEventToProps(
  event: BrowserScreenshotEvent,
  currentUrl?: string
): Partial<BrowserPreviewProps> {
  return {
    screenshotPath: event.status === "completed" ? event.filename : undefined,
    sessionName: event.session_name,
    screenshotTimestamp: event.timestamp,
    isLoading: event.status === "started",
    error: event.status === "failed" ? event.error || "Screenshot failed" : undefined,
    currentUrl,
  };
}

/**
 * Converts browser navigate event to URL for BrowserPreview component
 */
export function navigateEventToUrl(event: BrowserNavigateEvent): string | undefined {
  return event.status === "completed" ? event.url : undefined;
}