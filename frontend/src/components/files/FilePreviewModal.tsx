"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  X, 
  Download, 
  Eye, 
  FileText, 
  Code, 
  Image as ImageIcon, 
  AlertCircle,
  Loader2,
  Copy,
  Check
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FileMetadata = {
  name: string;
  path: string;
  size: number;
  type: string;
  modified: string;
  extension: string;
};

export interface FilePreviewModalProps {
  /** File to preview */
  file: FileMetadata | null;
  /** Whether modal is open */
  isOpen: boolean;
  /** Callback to close modal */
  onClose: () => void;
  /** Callback to download file */
  onDownload?: (file: FileMetadata) => void;
  /** CSS class name */
  className?: string;
}

// ── File content fetching ─────────────────────────────────────────────────────

type FileContent = {
  content: string;
  type: "text" | "binary" | "image";
  error?: string;
};

const fetchFileContent = async (filePath: string): Promise<FileContent> => {
  try {
    const response = await fetch(`/api/workspace/files/${filePath}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }
    
    const contentType = response.headers.get("content-type") || "";
    
    // Handle images
    if (contentType.startsWith("image/")) {
      return {
        content: `/api/workspace/files/${filePath}`,
        type: "image",
      };
    }
    
    // Handle text content
    if (contentType.startsWith("text/") || 
        contentType.includes("json") || 
        contentType.includes("javascript") ||
        contentType.includes("xml")) {
      const text = await response.text();
      return {
        content: text,
        type: "text",
      };
    }
    
    // Binary files
    return {
      content: "Binary file - cannot preview",
      type: "binary",
    };
    
  } catch (error) {
    return {
      content: "",
      type: "text",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

// ── Syntax highlighting ───────────────────────────────────────────────────────

const getLanguageFromExtension = (extension: string): string => {
  const languageMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    java: "java",
    cpp: "cpp",
    c: "c",
    h: "c",
    css: "css",
    scss: "scss",
    html: "html",
    xml: "xml",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sh: "bash",
    sql: "sql",
  };
  
  return languageMap[extension.toLowerCase()] || "plaintext";
};

const highlightCode = (code: string, language: string): string => {
  try {
    if (language === "plaintext") {
      return hljs.highlightAuto(code).value;
    }
    return hljs.highlight(code, { language }).value;
  } catch {
    return hljs.highlightAuto(code).value;
  }
};

// ── CSV table rendering ───────────────────────────────────────────────────────

const parseCSV = (csvText: string): string[][] => {
  const lines = csvText.split('\n').filter(line => line.trim());
  return lines.map(line => {
    // Simple CSV parsing - doesn't handle quoted commas
    return line.split(',').map(cell => cell.trim());
  });
};

const CSVTable = ({ csvText }: { csvText: string }) => {
  const rows = parseCSV(csvText);
  
  if (rows.length === 0) {
    return <p className="text-gray-500">Empty CSV file</p>;
  }
  
  const headers = rows[0];
  const dataRows = rows.slice(1);
  
  return (
    <div className="overflow-auto max-h-96">
      <table className="w-full border-collapse border border-gray-300 dark:border-gray-600 text-sm">
        <thead>
          <tr className="bg-gray-100 dark:bg-gray-800">
            {headers.map((header, index) => (
              <th
                key={index}
                className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-left font-medium text-gray-900 dark:text-gray-100"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, rowIndex) => (
            <tr key={rowIndex} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────

export function FilePreviewModal({
  file,
  isOpen,
  onClose,
  onDownload,
  className = "",
}: FilePreviewModalProps) {
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Load file content when file changes ───────────────────────────────────
  useEffect(() => {
    if (!file || !isOpen) {
      return;
    }

    const loadContent = async () => {
      setIsLoading(true);
      setFileContent(null);
      const content = await fetchFileContent(file.path);
      setFileContent(content);
      setIsLoading(false);
    };

    loadContent();
  }, [file, isOpen]);

  // ── Handle copy to clipboard ──────────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    if (!fileContent?.content || fileContent.type !== "text") return;
    
    try {
      await navigator.clipboard.writeText(fileContent.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy content:", error);
    }
  }, [fileContent]);

  // ── Handle download ───────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!file) return;
    onDownload?.(file);
  }, [file, onDownload]);

  // ── Handle modal close ────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    setFileContent(null);
    setCopied(false);
    onClose();
  }, [onClose]);

  // ── Handle backdrop click ─────────────────────────────────────────────────
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }, [handleClose]);

  // ── Format file size ──────────────────────────────────────────────────────
  const formatFileSize = (bytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  };

  // ── Format timestamp ──────────────────────────────────────────────────────
  const formatTimestamp = (timestamp: string): string => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return "Unknown";
    }
  };

  // ── Render file content ───────────────────────────────────────────────────
  const renderFileContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500">Loading file content...</p>
          </div>
        </div>
      );
    }

    if (!fileContent) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="text-center text-gray-500">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No content to display</p>
          </div>
        </div>
      );
    }

    if (fileContent.error) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="text-center text-red-500">
            <AlertCircle className="w-8 h-8 mx-auto mb-2" />
            <p className="text-sm">Failed to load file</p>
            <p className="text-xs mt-1">{fileContent.error}</p>
          </div>
        </div>
      );
    }

    // Handle different content types
    if (fileContent.type === "image") {
      return (
        <div className="flex items-center justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileContent.content}
            alt={file?.name}
            className="max-w-full max-h-96 object-contain rounded border border-gray-300 dark:border-gray-600"
          />
        </div>
      );
    }

    if (fileContent.type === "binary") {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="text-center text-gray-500">
            <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Binary file - cannot preview</p>
            <p className="text-xs mt-1">Use download to save the file</p>
          </div>
        </div>
      );
    }

    // Handle text content
    const content = fileContent.content;
    const extension = file?.extension || "";

    // Markdown rendering
    if (extension === "md") {
      return (
        <div className="prose prose-sm dark:prose-invert max-w-none p-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
        </div>
      );
    }

    // CSV table rendering
    if (extension === "csv") {
      return (
        <div className="p-4">
          <CSVTable csvText={content} />
        </div>
      );
    }

    // Code syntax highlighting
    if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'css', 'scss', 'html', 'xml', 'json', 'yaml', 'yml'].includes(extension)) {
      const language = getLanguageFromExtension(extension);
      const highlightedCode = highlightCode(content, language);
      
      return (
        <div className="relative">
          <pre className="hljs p-4 text-sm overflow-auto max-h-96 bg-gray-900 text-gray-100 rounded">
            <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
          </pre>
        </div>
      );
    }

    // Plain text
    return (
      <div className="p-4">
        <pre className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap font-mono bg-gray-50 dark:bg-gray-900 p-4 rounded border border-gray-200 dark:border-gray-700 overflow-auto max-h-96">
          {content}
        </pre>
      </div>
    );
  };

  if (!isOpen || !file) return null;

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 ${className}`}
      onClick={handleBackdropClick}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl max-h-[90vh] w-full mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {file.type === "image" ? (
                <ImageIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              ) : file.type === "code" ? (
                <Code className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              ) : (
                <FileText className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              )}
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
                {file.name}
              </h2>
            </div>
            
            <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
              <span>{formatFileSize(file.size)}</span>
              <span>•</span>
              <span>{formatTimestamp(file.modified)}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Copy button (for text content) */}
            {fileContent?.type === "text" && (
              <button
                onClick={handleCopy}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                title="Copy content"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-600" />
                ) : (
                  <Copy className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                )}
              </button>
            )}
            
            {/* Download button */}
            <button
              onClick={handleDownload}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              title="Download file"
            >
              <Download className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
            
            {/* Close button */}
            <button
              onClick={handleClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              title="Close"
            >
              <X className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {renderFileContent()}
        </div>
      </div>
    </div>
  );
}