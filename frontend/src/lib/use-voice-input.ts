/**
 * useVoiceInput
 * ──────────────────────────────────────────────────────────────────────────
 * Thin wrapper around the browser Web Speech API (SpeechRecognition).
 * Provides real-time interim + final transcripts without any backend.
 *
 * Supported in: Chrome, Edge, Safari 14.5+ (desktop & mobile).
 * Falls back gracefully to "unsupported" state on Firefox / other browsers.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
// NOTE: isSupported MUST be initialised as false and flipped in useEffect so
// the server-rendered HTML matches the first client paint (no hydration mismatch).

export type VoiceInputState = "idle" | "listening" | "unsupported";

export interface UseVoiceInputOptions {
  /** Called continuously as the user speaks, with `isFinal=false` for interim
   *  and `isFinal=true` when the browser completes a recognition phrase. */
  onTranscript: (text: string, isFinal: boolean) => void;
  /** BCP-47 language tag, e.g. "en-US". Defaults to browser locale. */
  lang?: string;
}

export interface UseVoiceInputReturn {
  state: VoiceInputState;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVoiceInput({
  onTranscript,
  lang,
}: UseVoiceInputOptions): UseVoiceInputReturn {
  const [state, setState] = useState<VoiceInputState>("idle");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  
  // Compute browser support lazily (avoids hydration mismatch)
  const [isSupported] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      typeof window.SpeechRecognition !== "undefined" ||
      typeof window.webkitSpeechRecognition !== "undefined"
    );
  });

  // Keep ref up-to-date so the recognition callbacks always use the latest fn
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const startListening = useCallback(() => {
    // Check browser support directly instead of relying on state
    const SpeechRecognitionCtor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    
    if (!SpeechRecognitionCtor) return;

    // Stop any in-flight session first
    recognitionRef.current?.stop();

    const recognition = new SpeechRecognitionCtor();

    // Enable continuous listening - keeps recording until manually stopped
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    if (lang) recognition.lang = lang;

    recognition.onstart = () => setState("listening");

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimText = "";
      let finalText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }

      if (finalText) {
        onTranscriptRef.current(finalText, true);
      } else if (interimText) {
        onTranscriptRef.current(interimText, false);
      }
    };

    recognition.onend = () => setState("idle");

    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      // "aborted" is raised when we call .stop() ourselves — not an error
      if (e.error !== "aborted") {
        console.warn("[voice] SpeechRecognition error:", e.error);
      }
      setState("idle");
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [lang]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setState("idle");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  return {
    state: isSupported ? state : "unsupported",
    isSupported,
    startListening,
    stopListening,
  };
}
