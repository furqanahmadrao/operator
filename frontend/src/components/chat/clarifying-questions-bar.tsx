"use client";

/**
 * ClarifyingQuestionsBar — step-by-step research qualifier
 * ---------------------------------------------------------
 * Replaces the composer while the agent awaits answers before a deep-research run.
 *
 * Features:
 *  - One question at a time with animated dot-step indicator
 *  - single_select  → radio buttons   (pick exactly one)
 *  - multi_select   → checkboxes      (pick any / all)
 *  - text           → free textarea   (open answer)
 *  - Every radio/checkbox list appends an "Other…" option with a text input
 *  - Per-question Skip, global Skip all, Back / Next / Start Research
 */

import React, { useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, HelpCircle, SkipForward } from "lucide-react";
import type { ClarifyingQuestion } from "@/lib/chat-api";

interface Props {
  questions: ClarifyingQuestion[];
  originalQuery: string;
  onSubmit: (answers: Record<string, string>) => void;
  onSkip: () => void;
}

export default function ClarifyingQuestionsBar({
  questions,
  originalQuery,
  onSubmit,
  onSkip,
}: Props) {
  const [step, setStep] = useState(0);
  const [singleAnswers, setSingleAnswers] = useState<Record<string, string>>({});
  const [multiAnswers, setMultiAnswers] = useState<Record<string, string[]>>({});
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});

  const q = questions[step];
  const qType = q?.type ?? "single_select";
  const isLast = step === questions.length - 1;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function selectSingle(qId: string, choice: string) {
    setSingleAnswers((p) => ({ ...p, [qId]: choice }));
  }

  function toggleMulti(qId: string, choice: string) {
    setMultiAnswers((p) => {
      const cur = p[qId] ?? [];
      return {
        ...p,
        [qId]: cur.includes(choice) ? cur.filter((c) => c !== choice) : [...cur, choice],
      };
    });
  }

  function goNext() {
    if (isLast) submit();
    else setStep((s) => s + 1);
  }

  function goBack() {
    setStep((s) => Math.max(0, s - 1));
  }

  function skipQuestion() {
    if (isLast) submit();
    else setStep((s) => s + 1);
  }

  function submit() {
    const merged: Record<string, string> = {};
    for (const question of questions) {
      const type = question.type ?? "single_select";
      let answer = "";
      if (type === "single_select") {
        const chosen = singleAnswers[question.id] ?? "";
        answer = chosen === "__other__" ? (otherText[question.id] ?? "").trim() : chosen;
      } else if (type === "multi_select") {
        const chosen = multiAnswers[question.id] ?? [];
        const parts = chosen.filter((c) => c !== "__other__");
        if (chosen.includes("__other__")) {
          const o = (otherText[question.id] ?? "").trim();
          if (o) parts.push(o);
        }
        answer = parts.join(", ");
      } else {
        answer = (textAnswers[question.id] ?? "").trim();
      }
      if (answer) merged[question.text] = answer;
    }
    onSubmit(merged);
  }

  if (!q) return null;

  const multiSelected = multiAnswers[q.id] ?? [];
  const multiCount = multiSelected.filter((c) => c !== "__other__").length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="cq-stepper">
      {/* Header */}
      <div className="cq-stepper-header">
        <HelpCircle size={14} className="cq-stepper-icon" />
        <div className="min-w-0">
          <p className="cq-stepper-title">A few quick questions</p>
          <p className="cq-stepper-subtitle">&ldquo;{originalQuery}&rdquo;</p>
        </div>
      </div>

      {/* Step dots */}
      <div className="cq-dots">
        {questions.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setStep(i)}
            aria-label={`Question ${i + 1}`}
            className={`cq-dot${i === step ? " cq-dot-active" : i < step ? " cq-dot-done" : ""}`}
          />
        ))}
      </div>

      {/* Question body */}
      <div className="cq-body">
        <p className="cq-step-label">
          Question {step + 1} of {questions.length}
          {qType === "multi_select" && (
            <span className="cq-type-hint"> — select all that apply</span>
          )}
        </p>
        <p className="cq-question-text">{q.text}</p>

        {/* ── single_select ── */}
        {qType === "single_select" && (
          <div className="cq-options">
            {(q.choices ?? []).map((choice) => {
              const sel = singleAnswers[q.id] === choice;
              return (
                <button
                  key={choice}
                  type="button"
                  className={`cq-option${sel ? " cq-option-sel" : ""}`}
                  onClick={() => selectSingle(q.id, choice)}
                >
                  <span className="cq-radio">
                    {sel && <span className="cq-radio-dot" />}
                  </span>
                  {choice}
                </button>
              );
            })}
            {(q.choices ?? []).length > 0 && (
              <>
                <button
                  type="button"
                  className={`cq-option cq-option-other${singleAnswers[q.id] === "__other__" ? " cq-option-sel" : ""}`}
                  onClick={() => selectSingle(q.id, "__other__")}
                >
                  <span className="cq-radio">
                    {singleAnswers[q.id] === "__other__" && <span className="cq-radio-dot" />}
                  </span>
                  Other…
                </button>
                {singleAnswers[q.id] === "__other__" && (
                  <input
                    type="text"
                    className="cq-text-input"
                    placeholder="Type your answer…"
                    value={otherText[q.id] ?? ""}
                    onChange={(e) =>
                      setOtherText((p) => ({ ...p, [q.id]: e.target.value }))
                    }
                     
                    autoFocus
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* ── multi_select ── */}
        {qType === "multi_select" && (
          <div className="cq-options">
            {(q.choices ?? []).map((choice) => {
              const checked = multiSelected.includes(choice);
              return (
                <button
                  key={choice}
                  type="button"
                  className={`cq-option${checked ? " cq-option-sel" : ""}`}
                  onClick={() => toggleMulti(q.id, choice)}
                >
                  <span className="cq-checkbox">
                    {checked && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden>
                        <path d="M1 3.5L4 7L9 1" stroke="currentColor" strokeWidth="2"
                          strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {choice}
                </button>
              );
            })}
            {(q.choices ?? []).length > 0 && (
              <>
                <button
                  type="button"
                  className={`cq-option cq-option-other${multiSelected.includes("__other__") ? " cq-option-sel" : ""}`}
                  onClick={() => toggleMulti(q.id, "__other__")}
                >
                  <span className="cq-checkbox">
                    {multiSelected.includes("__other__") && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden>
                        <path d="M1 3.5L4 7L9 1" stroke="currentColor" strokeWidth="2"
                          strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  Other…
                </button>
                {multiSelected.includes("__other__") && (
                  <input
                    type="text"
                    className="cq-text-input"
                    placeholder="Type your answer…"
                    value={otherText[q.id] ?? ""}
                    onChange={(e) =>
                      setOtherText((p) => ({ ...p, [q.id]: e.target.value }))
                    }
                     
                    autoFocus
                  />
                )}
              </>
            )}
            {multiCount > 0 && (
              <p className="cq-multi-count">{multiCount} selected</p>
            )}
          </div>
        )}

        {/* ── text ── */}
        {qType === "text" && (
          <textarea
            className="cq-textarea"
            placeholder="Type your answer…"
            value={textAnswers[q.id] ?? ""}
            onChange={(e) =>
              setTextAnswers((p) => ({ ...p, [q.id]: e.target.value }))
            }
            rows={3}
             
            autoFocus
          />
        )}
      </div>

      {/* Footer */}
      <div className="cq-footer">
        <div className="cq-footer-left">
          {step > 0 && (
            <button type="button" className="cq-back-btn" onClick={goBack}>
              <ChevronLeft size={13} />
              Back
            </button>
          )}
          <button type="button" className="cq-skip-btn" onClick={skipQuestion}>
            <SkipForward size={12} />
            {isLast ? "Skip & continue" : "Skip question"}
          </button>
        </div>

        <div className="cq-footer-right">
          <button type="button" className="cq-skip-all-btn" onClick={onSkip}>
            Skip all
          </button>
          {isLast ? (
            <button type="button" className="btn-primary cq-action-btn" onClick={submit}>
              Continue
              <ArrowRight size={13} />
            </button>
          ) : (
            <button type="button" className="btn-primary cq-action-btn" onClick={goNext}>
              Next
              <ChevronRight size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
