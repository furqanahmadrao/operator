import { AlertCircle, RefreshCw, X } from "lucide-react";

type ChatErrorBannerProps = {
  message: string;
  onRetry?: () => void;
  onDismiss: () => void;
};

export function ChatErrorBanner({ message, onRetry, onDismiss }: ChatErrorBannerProps) {
  return (
    <div
      className="mt-6 flex gap-3 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm"
      role="alert"
      style={{ animation: "msgSlideUp 0.18s ease-out both" }}
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <p className="font-medium text-danger">Unable to complete response</p>
        <p className="mt-0.5 break-words text-[13px] text-danger/70">{message}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          {onRetry ? (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-danger-border px-2.5 py-1 text-[12px] font-medium text-danger transition-all duration-150 hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 focus-visible:ring-offset-danger-soft"
              onClick={onRetry}
            >
              <RefreshCw size={11} />
              Try again
            </button>
          ) : null}

          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium text-danger/60 transition-all duration-150 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 focus-visible:ring-offset-danger-soft"
            onClick={onDismiss}
          >
            <X size={11} />
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
