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
  // Start as false — matches the server render (no window).
  // Flip to true in a useEffect so both passes agree on the first paint.
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);

  // Keep ref up-to-date so the recognition callbacks always use the latest fn
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  // Detect browser support after mount (client-only)
  useEffect(() => {
    setIsSupported(
      typeof window.SpeechRecognition !== "undefined" ||
      typeof window.webkitSpeechRecognition !== "undefined",
    );
  }, []);

  const startListening = useCallback(() => {
    if (!isSupported) return;

    // Stop any in-flight session first
    recognitionRef.current?.stop();

    const SpeechRecognitionCtor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition!;
    const recognition = new SpeechRecognitionCtor();

    recognition.continuous = false;
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
  }, [isSupported, lang]);

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
