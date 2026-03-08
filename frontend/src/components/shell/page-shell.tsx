"use client";

import { useRouter } from "next/navigation";
import { LeftRail } from "@/components/shell/left-rail";

/**
 * Wraps non-chat pages with the persistent LeftRail sidebar.
 * The LeftRail chat icon navigates to "/" (home/chat page).
 */
export function PageShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <div className="flex h-dvh overflow-hidden bg-bg font-sans text-text-1">
      <LeftRail
        onToggleHistory={() => router.push("/")}
        historyOpen={false}
      />
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}
