import { Suspense } from "react";
import { ChatShell } from "@/components/chat-shell";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <ChatShell />
    </Suspense>
  );
}
