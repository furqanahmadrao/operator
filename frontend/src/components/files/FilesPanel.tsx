"use client";

import { useState, useCallback, useMemo } from "react";
import { 
  Folder, 
  FolderOpen, 
  File, 
  FileText, 
  Code, 
  Image, 
  Download, 
  Clock, 
  HardDrive,
  ChevronRight,
  ChevronDown,
  Search,
  X,
  Eye,
  AlertCircle
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FileOperationEvent = {
  type: "file_created" | "file_modified" | "file_deleted";
  path: string;
  size_bytes?: number;
  file_type?: string;
  timestamp: string;
  session_id: string;
  correlation_id?: string;
};

export type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
  children?: FileTreeNode[];
  expanded?: boolean;
};

export type FileMetadata = {
  name: string;
  path: string;
  size: number;
  type: string;
  modified: string;
  extension: string;
};

export interface FilesPanelProps {
  /** File tree data */
  fileTree?: FileTreeNode[];
  /** Recent file operations */
  recentOperations?: FileOperationEvent[];
  /** Loading state */
  isLoading?: boolean;
  /** Error message */
  error?: string;
  /** CSS class name */
  className?: string;
  /** Height of the panel */
  height?: number;
  /** Callback when file is selected for preview */
  onFilePreview?: (file: FileMetadata) => void;
  /** Callback when file is downloaded */
  onFileDownload?: (file: FileMetadata) => void;
  /** Callback to refresh file tree */
  onRefresh?: () => void;
}

// ── File type detection ───────────────────────────────────────────────────────

const FILE_TYPE_ICONS = {
  // Code files
  js: Code,
  ts: Code,
  jsx: Code,
  tsx: Code,
  py: Code,
  java: Code,
  cpp: Code,
  c: Code,
  h: Code,
  css: Code,
  scss: Code,
  html: Code,
  xml: Code,
  json: Code,
  yaml: Code,
  yml: Code,
  
  // Text files
  txt: FileText,
  md: FileText,
  rst: FileText,
  
  // Images
  png: Image,
  jpg: Image,
  jpeg: Image,
  gif: Image,
  svg: Image,
  webp: Image,
  
  // Default
  default: File,
};

const getFileIcon = (filename: string) => {
  const extension = filename.split('.').pop()?.toLowerCase() || '';
  return FILE_TYPE_ICONS[extension as keyof typeof FILE_TYPE_ICONS] || FILE_TYPE_ICONS.default;
};

const getFileType = (filename: string): string => {
  const extension = filename.split('.').pop()?.toLowerCase() || '';
  
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h'].includes(extension)) {
    return 'code';
  }
  if (['txt', 'md', 'rst'].includes(extension)) {
    return 'text';
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(extension)) {
    return 'image';
  }
  if (['json', 'yaml', 'yml', 'xml'].includes(extension)) {
    return 'data';
  }
  if (['css', 'scss', 'html'].includes(extension)) {
    return 'web';
  }
  if (['csv'].includes(extension)) {
    return 'spreadsheet';
  }
  
  return 'unknown';
};

// ── Utility functions ─────────────────────────────────────────────────────────

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return "0 B";
  
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatTimestamp = (timestamp: string): string => {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  } catch {
    return "Unknown";
  }
};

// ── Component ─────────────────────────────────────────────────────────────────

export function FilesPanel({
  fileTree = [],
  recentOperations = [],
  isLoading = false,
  error,
  className = "",
  height = 400,
  onFilePreview,
  onFileDownload,
  onRefresh,
}: FilesPanelProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"tree" | "recent">("tree");

  // ── Handle node expansion ─────────────────────────────────────────────────
  const toggleNodeExpansion = useCallback((path: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  }, []);

  // ── Filter files based on search ──────────────────────────────────────────
  const filteredFileTree = useMemo(() => {
    if (!searchTerm) return fileTree;
    
    const filterNode = (node: FileTreeNode): FileTreeNode | null => {
      const matchesSearch = node.name.toLowerCase().includes(searchTerm.toLowerCase());
      
      if (node.type === "file") {
        return matchesSearch ? node : null;
      }
      
      // For directories, include if name matches or any child matches
      const filteredChildren = node.children?.map(filterNode).filter((child): child is FileTreeNode => child !== null) || [];
      
      if (matchesSearch || filteredChildren.length > 0) {
        return {
          ...node,
          children: filteredChildren,
          expanded: true, // Auto-expand when searching
        };
      }
      
      return null;
    };
    
    return fileTree.map(filterNode).filter(Boolean) as FileTreeNode[];
  }, [fileTree, searchTerm]);

  // ── Handle file selection ─────────────────────────────────────────────────
  const handleFileSelect = useCallback((node: FileTreeNode) => {
    if (node.type === "file") {
      setSelectedFile(node.path);
      
      const metadata: FileMetadata = {
        name: node.name,
        path: node.path,
        size: node.size || 0,
        type: getFileType(node.name),
        modified: node.modified || new Date().toISOString(),
        extension: node.name.split('.').pop() || '',
      };
      
      onFilePreview?.(metadata);
    }
  }, [onFilePreview]);

  // ── Handle file download ──────────────────────────────────────────────────
  const handleFileDownload = useCallback((node: FileTreeNode) => {
    if (node.type === "file") {
      const metadata: FileMetadata = {
        name: node.name,
        path: node.path,
        size: node.size || 0,
        type: getFileType(node.name),
        modified: node.modified || new Date().toISOString(),
        extension: node.name.split('.').pop() || '',
      };
      
      onFileDownload?.(metadata);
    }
  }, [onFileDownload]);

  // ── Render file tree node ─────────────────────────────────────────────────
  const renderTreeNode = (node: FileTreeNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedNodes.has(node.path);
    const isSelected = selectedFile === node.path;
    const Icon = node.type === "directory" 
      ? (isExpanded ? FolderOpen : Folder)
      : getFileIcon(node.name);

    return (
      <div key={node.path} className="select-none">
        {/* Node row */}
        <div
          className={`flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer ${
            isSelected ? 'bg-blue-100 dark:bg-blue-900/30' : ''
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => {
            if (node.type === "directory") {
              toggleNodeExpansion(node.path);
            } else {
              handleFileSelect(node);
            }
          }}
        >
          {/* Expand/collapse icon for directories */}
          {node.type === "directory" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleNodeExpansion(node.path);
              }}
              className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3 text-gray-500" />
              ) : (
                <ChevronRight className="w-3 h-3 text-gray-500" />
              )}
            </button>
          )}
          
          {/* File/folder icon */}
          <Icon className="w-4 h-4 text-gray-600 dark:text-gray-400 flex-shrink-0" />
          
          {/* Name */}
          <span className="text-sm text-gray-900 dark:text-gray-100 truncate flex-1">
            {node.name}
          </span>
          
          {/* File actions */}
          {node.type === "file" && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleFileSelect(node);
                }}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                title="Preview file"
              >
                <Eye className="w-3 h-3 text-gray-500" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleFileDownload(node);
                }}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                title="Download file"
              >
                <Download className="w-3 h-3 text-gray-500" />
              </button>
            </div>
          )}
          
          {/* File size */}
          {node.type === "file" && node.size !== undefined && (
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
              {formatFileSize(node.size)}
            </span>
          )}
        </div>
        
        {/* Children (if directory is expanded) */}
        {node.type === "directory" && isExpanded && node.children && (
          <div>
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // ── Render recent operations ──────────────────────────────────────────────
  const renderRecentOperations = useCallback(() => {
    if (recentOperations.length === 0) {
      return (
        <div className="flex items-center justify-center h-32 text-gray-500 dark:text-gray-400">
          <div className="text-center">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No recent file operations</p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-1">
        {recentOperations.slice(0, 50).map((operation, index) => {
          const filename = operation.path.split('/').pop() || operation.path;
          const Icon = getFileIcon(filename);
          const operationColor = {
            file_created: "text-green-600 dark:text-green-400",
            file_modified: "text-blue-600 dark:text-blue-400",
            file_deleted: "text-red-600 dark:text-red-400",
          }[operation.type];

          return (
            <div
              key={`${operation.path}-${operation.timestamp}-${index}`}
              className="flex items-center gap-3 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded cursor-pointer group"
              onClick={() => {
                if (operation.type !== "file_deleted") {
                  const metadata: FileMetadata = {
                    name: filename,
                    path: operation.path,
                    size: operation.size_bytes || 0,
                    type: operation.file_type || getFileType(filename),
                    modified: operation.timestamp,
                    extension: filename.split('.').pop() || '',
                  };
                  onFilePreview?.(metadata);
                }
              }}
            >
              <Icon className="w-4 h-4 text-gray-600 dark:text-gray-400 flex-shrink-0" />
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-900 dark:text-gray-100 truncate">
                    {filename}
                  </span>
                  <span className={`text-xs font-medium ${operationColor}`}>
                    {operation.type.replace('file_', '')}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <span>{formatTimestamp(operation.timestamp)}</span>
                  {operation.size_bytes && (
                    <>
                      <span>•</span>
                      <span>{formatFileSize(operation.size_bytes)}</span>
                    </>
                  )}
                </div>
              </div>
              
              {operation.type !== "file_deleted" && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const metadata: FileMetadata = {
                        name: filename,
                        path: operation.path,
                        size: operation.size_bytes || 0,
                        type: operation.file_type || getFileType(filename),
                        modified: operation.timestamp,
                        extension: filename.split('.').pop() || '',
                      };
                      onFileDownload?.(metadata);
                    }}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                    title="Download file"
                  >
                    <Download className="w-3 h-3 text-gray-500" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }, [recentOperations, onFilePreview, onFileDownload]);

  // ── Render empty state ────────────────────────────────────────────────────
  const renderEmptyState = () => (
    <div className="flex items-center justify-center h-32 text-gray-500 dark:text-gray-400">
      <div className="text-center">
        <HardDrive className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No files in workspace</p>
        <p className="text-xs mt-1">Files will appear here when created</p>
      </div>
    </div>
  );

  // ── Render error state ────────────────────────────────────────────────────
  const renderError = () => (
    <div className="flex items-center justify-center h-32 text-red-500 dark:text-red-400">
      <div className="text-center">
        <AlertCircle className="w-8 h-8 mx-auto mb-2" />
        <p className="text-sm">Failed to load files</p>
        <p className="text-xs mt-1">{error}</p>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="mt-2 px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className={`files-panel-container ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Files
          </span>
        </div>
        
        {/* View mode toggle */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode("tree")}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              viewMode === "tree" 
                ? "bg-blue-600 text-white" 
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            Tree
          </button>
          <button
            onClick={() => setViewMode("recent")}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              viewMode === "recent" 
                ? "bg-blue-600 text-white" 
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            Recent
          </button>
        </div>
      </div>

      {/* Search bar (only for tree view) */}
      {viewMode === "tree" && (
        <div className="p-2 border-b border-gray-200 dark:border-gray-700">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search files..."
              className="w-full pl-7 pr-7 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
              >
                <X className="w-3 h-3 text-gray-400" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content area */}
      <div 
        className="files-content overflow-auto"
        style={{ height: `${height - (viewMode === "tree" ? 120 : 80)}px` }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2"></div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading files...</p>
            </div>
          </div>
        ) : error ? (
          renderError()
        ) : viewMode === "tree" ? (
          filteredFileTree.length === 0 ? (
            searchTerm ? (
              <div className="flex items-center justify-center h-32 text-gray-500 dark:text-gray-400">
                <div className="text-center">
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No files match &quot;{searchTerm}&quot;</p>
                </div>
              </div>
            ) : (
              renderEmptyState()
            )
          ) : (
            <div className="py-1">
              {filteredFileTree.map(node => renderTreeNode(node))}
            </div>
          )
        ) : (
          renderRecentOperations()
        )}
      </div>
    </div>
  );
}

// ── Utility functions for external use ────────────────────────────────────────

/**
 * Builds file metadata from file tree node
 */
export function nodeToFileMetadata(node: FileTreeNode): FileMetadata {
  return {
    name: node.name,
    path: node.path,
    size: node.size || 0,
    type: getFileType(node.name),
    modified: node.modified || new Date().toISOString(),
    extension: node.name.split('.').pop() || '',
  };
}