"use client";

import type { ComponentPropsWithoutRef } from "react";
import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";

// highlight.js — load core + only the languages we want to keep the bundle small
import hljs from "highlight.js/lib/core";
import hljsLangBash from "highlight.js/lib/languages/bash";
import hljsLangCss from "highlight.js/lib/languages/css";
import hljsLangDiff from "highlight.js/lib/languages/diff";
import hljsLangGo from "highlight.js/lib/languages/go";
import hljsLangHtml from "highlight.js/lib/languages/xml"; // html/xml share a module
import hljsLangJs from "highlight.js/lib/languages/javascript";
import hljsLangJson from "highlight.js/lib/languages/json";
import hljsLangMarkdown from "highlight.js/lib/languages/markdown";
import hljsLangPy from "highlight.js/lib/languages/python";
import hljsLangRust from "highlight.js/lib/languages/rust";
import hljsLangShell from "highlight.js/lib/languages/shell";
import hljsLangSql from "highlight.js/lib/languages/sql";
import hljsLangTs from "highlight.js/lib/languages/typescript";
import hljsLangYaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", hljsLangBash);
hljs.registerLanguage("sh", hljsLangBash);
hljs.registerLanguage("css", hljsLangCss);
hljs.registerLanguage("diff", hljsLangDiff);
hljs.registerLanguage("go", hljsLangGo);
hljs.registerLanguage("html", hljsLangHtml);
hljs.registerLanguage("xml", hljsLangHtml);
hljs.registerLanguage("javascript", hljsLangJs);
hljs.registerLanguage("js", hljsLangJs);
hljs.registerLanguage("json", hljsLangJson);
hljs.registerLanguage("markdown", hljsLangMarkdown);
hljs.registerLanguage("python", hljsLangPy);
hljs.registerLanguage("py", hljsLangPy);
hljs.registerLanguage("rust", hljsLangRust);
hljs.registerLanguage("rs", hljsLangRust);
hljs.registerLanguage("shell", hljsLangShell);
hljs.registerLanguage("sql", hljsLangSql);
hljs.registerLanguage("typescript", hljsLangTs);
hljs.registerLanguage("ts", hljsLangTs);
hljs.registerLanguage("yaml", hljsLangYaml);
hljs.registerLanguage("yml", hljsLangYaml);

type CodeProps = ComponentPropsWithoutRef<"code"> & {
  className?: string;
};

/**
 * Replaces the default <code> renderer in react-markdown.
 *
 * - Fenced code blocks (have a language-* class) → styled block with
 *   syntax highlighting, language label, and copy button.
 * - Inline code (no class) → simple styled <code> span.
 *
 * Usage in ReactMarkdown:
 *   components={{ pre: ({ children }) => <>{children}</>, code: CodeBlock }}
 */
export function CodeBlock({ className, children, ...rest }: CodeProps) {
  const [copied, setCopied] = useState(false);

  const match = /language-(\w+)/.exec(className ?? "");
  const language = match ? match[1].toLowerCase() : null;

  // Inline code — no language class
  if (!language) {
    return (
      <code className="inline-code" {...rest}>
        {children}
      </code>
    );
  }

  // Extract raw text for copy + highlighting
  const codeText = (
    Array.isArray(children) ? (children as unknown[]).join("") : String(children ?? "")
  ).replace(/\n$/, "");

  // Compute highlighted HTML (memoised to avoid re-running on every render)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const highlightedHtml = useMemo(() => {
    try {
      if (hljs.getLanguage(language)) {
        return hljs.highlight(codeText, {
          language,
          ignoreIllegals: true,
        }).value;
      }
    } catch {
      // Language not registered or highlight failed — fall back to plain text
    }
    return null;
  }, [codeText, language]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — fail silently
    }
  };

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{language}</span>
        <button
          type="button"
          className="code-block-copy-btn"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          <span>{copied ? "Copied!" : "Copy"}</span>
        </button>
      </div>
      <pre className="code-block-pre">
        {highlightedHtml ? (
          <code
            className="code-block-code hljs"
            // Safe: output is from hljs which escapes user input
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <code className="code-block-code">{codeText}</code>
        )}
      </pre>
    </div>
  );
}
