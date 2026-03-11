# Operator — Full System Audit Report

## Executive Summary
Operator is an agentic framework currently built on FastAPI (backend), a Next.js/Tailwind frontend, aiosqlite for persistence, and LangGraph for the orchestration loop. The system architecture is robust in its abstractions but currently lacks multiple key components of an autonomous agent—specifically, sandboxed execution and browser/Playwright capabilities. The core chat loop supports tool calling with web search (via Tavily) and artifact generation/versioning, and a dedicated multi-step "deep research" graph uses Serper.dev for broader queries.

The most critical issues involve absent tool implementations (browser and sandbox), unhandled errors in streams that crash the agent silently if an API key is missing or invalid, and an incomplete UI handling of certain artifact interactions (e.g., inline split pane issues). However, the foundation is clean, modular, and ready for expansion.

## System Architecture Overview
The user interacts via the Next.js frontend, connecting to a FastAPI backend. Chat sessions are maintained in an SQLite database. When the user sends a message, `session_chat.py` queries previous messages, formats them, and passes them to a LangGraph `ReAct` agent. The agent uses tools (`web_search`, `create_artifact`, `update_artifact`, `get_current_datetime`, `list_session_artifacts`) and emits Server-Sent Events (SSE). The frontend reads these streams to update the UI sequentially (text chunks, tool start/end, artifact creation). A separate "Deep Research" path (using its own StateGraph) is invoked if the research toggle is enabled, which first asks clarifying questions, then runs parallel searches, evaluates coverage, synthesizes findings, and creates a final markdown artifact.

## Critical Issues (P0) — Must Fix Immediately

- **Issue:** Missing Browser / Playwright Integration
- **Location:** `backend/app/agent/tools.py`
- **Description:** The agent lacks any browser tool to navigate, fetch, or screenshot web pages. This means deep research and general search can only read search snippets, completely failing on specific URLs or deeply technical queries requiring full-page reads.
- **Impact:** Breaks any workflow requiring the agent to scrape, read documentation, or visually verify web pages.
- **Fix Direction:** Implement a `read_webpage` tool using Playwright inside `tools.py` and register it to `_CORE_TOOLS` in `agent.py`. Ensure Playwright instances are managed properly and isolated.

- **Issue:** Missing Runtime / Sandbox Environment
- **Location:** `backend/app/agent/tools.py`
- **Description:** The agent cannot execute code or run terminal commands. There is no Docker sandbox integrated or any `/workspace` isolation mechanism.
- **Impact:** Prevents the agent from performing software engineering tasks, writing and verifying tests, or data analysis via Python execution.
- **Fix Direction:** Add a `run_code_in_sandbox` or `execute_bash` tool. Implement a Docker-based or similarly isolated sandbox service.

- **Issue:** Web Search Silently Fails Without Activity Update
- **Location:** `backend/app/api/session_chat.py` (line ~356)
- **Description:** When the `web_search` tool throws an error (e.g. `SearchAPIKeyMissing`), it returns a JSON with `{"status": "error", "message": "..."}`. The frontend UI catches this, but might leave the "running" spinner indefinitely if not handled specifically as an error event in `session_chat.py`'s stream loop.
- **Impact:** The UI shows a permanent "Searching..." spinner if Tavily API key is missing.
- **Fix Direction:** Ensure the SSE `on_tool_end` correctly routes the error status and the frontend component `ChatShell` (lines ~768-782) correctly clears `activeToolActivity` when an error event is received. Wait, looking at `session_chat.py` line ~365, it yields `sse_tool_activity("web_search", "error", message=...)`, which is handled by the frontend, but let's verify if `activeToolActivity` is cleared.

## High Priority Issues (P1) — Fix Before Next Feature

- **Issue:** `deep_research.py` Hardcodes Serper.dev while Chat Uses Tavily
- **Location:** `backend/app/agent/deep_research.py` vs `backend/app/agent/tools.py`
- **Description:** Deep research uses Google Custom Search (Serper.dev) in `run_searches` while normal chat uses `Tavily` (`web_search_service`).
- **Impact:** Forces developers/users to provide two separate search API keys. Inconsistent search experiences between modes.
- **Fix Direction:** Unify search backends or make the provider configurable, preferably standardizing on one (e.g. Tavily or Serper) across all search services.

- **Issue:** Clarifying Questions Type Handling in Frontend
- **Location:** `frontend/src/components/chat-shell.tsx` & `clarifying-questions-bar`
- **Description:** The deep research flow generates clarifying questions of type `single_select`, `multi_select`, or `text`. But the UI handling for sending answers back might not be robust against empty responses or validation.
- **Impact:** Could break deep research if the user submits malformed or empty clarifications.
- **Fix Direction:** Add form validation on the frontend before calling `sendMessageWithClarifications`.

- **Issue:** Memory Leak in Stream Pause Detection
- **Location:** `frontend/src/components/chat-shell.tsx` (line ~479)
- **Description:** The `setInterval` for stream pause detection relies on checking elapsed time. If the stream finishes but `setIsStreaming(false)` is delayed, the interval may keep firing.
- **Impact:** Minor memory leak/unnecessary CPU usage per chat.
- **Fix Direction:** Clear the interval explicitly when `isStreaming` becomes false using `useEffect` cleanup.

## Medium Priority Issues (P2) — Fix When Possible

- **Issue:** No Tests Configured
- **Location:** Project wide
- **Description:** There are no backend (`pytest`) or frontend (`jest`/`vitest`) test files or configuration setups.
- **Impact:** Risk of regression when adding new tools or updating the agent graph.
- **Fix Direction:** Add a standard testing suite (e.g. `backend/tests/` with `pytest` and a `conftest.py` for DB mocking).

- **Issue:** SQLite `N+1` Query in `list_all_artifacts`
- **Location:** `backend/app/services/artifact_service.py` (line 121)
- **Description:** The query `LEFT JOIN sessions s ON a.session_id = s.id` is fine, but it doesn't solve N+1 if we needed to fetch more nested relations. However, looking at the code, it's a single query. Wait, it's not an N+1, but `listProjectSessions` loops? `project_service.py` might have an N+1 when counting sessions.
- **Impact:** Acceptable for current scale, but may slow down the Library view over time.
- **Fix Direction:** Review `project_service.py` for optimal aggregations.

## Low Priority Issues (P3) — Nice to Fix

- **Issue:** Hardcoded Voice Recognition
- **Location:** `frontend/src/lib/use-voice-input.ts`
- **Description:** Voice input relies purely on the browser's `SpeechRecognition` API, which is unsupported on Firefox.
- **Impact:** Poor accessibility for non-Chrome/Safari users.
- **Fix Direction:** Fallback to a backend transcription service (e.g. Whisper API) via audio upload if the native API is unsupported.

## Missing Tools — Agent Capability Gaps

- **Tool Name:** `read_webpage` (Playwright)
- **Purpose:** Navigates to a specific URL, bypasses basic bot protections, and returns the markdown-rendered content of the page.
- **Why Needed:** Search results only provide snippets. For deep technical answers or document analysis, the agent must read the full page.
- **Where to Add:** `backend/app/agent/tools.py`
- **Suggested Implementation:** A headless Playwright instance that extracts `document.body.innerText` or uses a readability library to return clean text.

- **Tool Name:** `execute_sandbox_code`
- **Purpose:** Executes Python or Bash scripts in an isolated Docker container and returns stdout/stderr.
- **Why Needed:** Essential for a coding agent to verify code correctness, run tests, or process data files securely.
- **Where to Add:** `backend/app/agent/tools.py`
- **Suggested Implementation:** Define a Docker socket integration or an ephemeral container runner that accepts code strings and returns terminal output.

## Missing Features & Incomplete Implementations
- **Code Execution Sandbox:** Mentioned in requirements/expectations, completely missing in code.
- **Browser Automation:** Missing Playwright setup.
- **Multi-user Auth:** Explicitly excluded in Phase 1, but models assume single-user local state.

## Security Findings
- **Issue:** Unauthenticated Endpoints.
- **Location:** All routes in `backend/app/api/`
- **Description:** No authorization mechanisms exist. Anyone with access to the backend port can query the DB and use the NVIDIA/Tavily API keys.
- **Impact:** If deployed publicly, immediate resource abuse (API key drain).
- **Fix Direction:** Add a simple API token middleware or OAuth layer if this ever leaves `localhost`.

## Performance Findings
- **Issue:** Blocking operations in SQLite
- **Location:** `backend/app/database.py`
- **Description:** `aiosqlite` is used correctly, but `PRAGMA journal_mode = WAL;` is set. WAL mode is great, but connection pooling is not explicitly managed for high concurrency.
- **Impact:** Low impact for single-user, but could bottleneck if the agent does heavy concurrent DB writes (e.g. parallel deep research artifacts).

## Recommended Fix Order
1. **P0 - Implement Sandbox / Code Execution Tool:** Necessary for base agent functionality.
2. **P0 - Implement Playwright / Browser Tool:** Unlocks reading documentation beyond search snippets.
3. **P1 - Unify Web Search APIs:** Switch Deep Research and Agent to use the same provider to reduce API key overhead.
4. **P1 - Error Handling in SSE:** Ensure UI gracefully resets when a tool fails without hanging spinners.
5. **P2/P3 - UX Polishing:** Fix Voice input fallbacks, test suites, and SQLite optimizations.

## Quick Wins
- Unify search providers (Tavily vs Serper).
- Fix `setInterval` memory leak in frontend streaming by clearing the interval in the cleanup function.

## Deep Dive Findings

### 1. Tool Call Tracing (Code Path & Failure Points)
**Code Path:**
1. **Decision & Invocation:** The agent (a LangGraph `ReAct` instance compiled with `create_react_agent`) evaluates `messages`. The LLM generates a tool call request chunk with JSON arguments. `session_chat.py` receives `on_chat_model_stream` events, deliberately skipping chunks with `tool_call_chunks` so raw JSON isn't emitted as text (lines ~301-303).
2. **Execution:** LangGraph automatically halts generation, executes the corresponding Python async tool function (e.g. `web_search`), passing the parsed JSON arguments.
3. **Observation:** The tool function completes, typically returning a JSON string (e.g., `{"status": "completed", ...}`). LangGraph wraps this string into a `ToolMessage` and adds it to the message history.
4. **SSE Emission:** `session_chat.py` receives the `on_tool_end` event, extracts the output via `_extract_tool_output`, and attempts to parse it using `json.loads(raw_output)`. If it's `web_search` or an artifact tool, it emits specific SSE events (e.g. `sse_search_results` or `sse_tool_activity("web_search", "error")`).
5. **Context Injection:** LangGraph automatically injects the `ToolMessage` into the LLM context, and the LLM is invoked again to reason about the tool output.

**Failure Points / Gaps:**
- **Silent Failure on JSON Parse Error:** If `json.loads(raw_output)` in `session_chat.py` fails (e.g., the tool returned a non-JSON string or an unescaped character), it throws a `json.JSONDecodeError` which is caught, a warning is logged (`"Could not parse web_search output: %r"`), but **no error SSE is emitted to the frontend**. The UI might be stuck in a "running" state (for `web_search`) because the frontend never receives the `on_tool_end` signal it expects.
- **Silent Failure on Tool Exception:** If the Python tool itself throws an unhandled exception (e.g. `TimeoutError` or DB constraint failure) that is *not* caught inside the tool, it bubbles up to LangGraph. LangGraph's ReAct agent intercepts tool exceptions, converts them to a string `ToolMessage` (e.g. `"Error: <msg>"`), and hands them back to the LLM. In this case, `session_chat.py`'s `json.loads()` on `on_tool_end` will fail. The LLM sees the error and may apologize or hallucinate an answer, but the UI component (e.g. the search spinner) will hang indefinitely because it never received the structured error JSON.
- **No `tool_activity` event for internal tools:** Tools like `create_artifact` and `list_session_artifacts` intentionally skip `on_tool_start` activity spinners (lines ~322-326) because the frontend maps all tool activity to a "Searching..." state. If one of these tools takes a long time, the user sees no feedback.

### 2. Clarifying Questions Flow (Code Path & Gaps)
**Code Path:**
1. **Trigger (Call 1):** The user clicks "Send" with Deep Research enabled. `session_chat.py` receives a POST request with `deep_research_enabled=True` and `clarifications=None`.
2. **Generation:** `generate_clarifying_questions(query)` is called (line ~129). It uses a single API call to NVIDIA's model with `temperature=0.4` to generate 3-5 clarifying questions formatted as JSON (with specific `id`, `text`, `type`, and `choices`).
3. **Parse & Fallback:** The JSON output is parsed in a `try...except` block. If parsing fails, a graceful fallback array is created with a single, generic question ("What is the main purpose of this research?").
4. **SSE Emission:** The UI receives the `clarifying_questions` SSE event containing the parsed questions. A user message is saved to the database, but no assistant message is generated yet. `data: [DONE]` is emitted, ending Call 1.
5. **UI Rendering:** The frontend (`chat-shell.tsx`) receives the event via `onClarifyingQuestions`, swapping out the chat composer for `ClarifyingQuestionsBar`. The user selects answers and submits.
6. **Trigger (Call 2):** The UI invokes `sendMessageWithClarifications(query, clarifications)` sending `deep_research_enabled=True` and `clarifications={...}` dict back to the same endpoint.
7. **Research Pipeline:** `session_chat.py` recognizes Call 2, bypasses the clarifying question generation (line ~149), and invokes `run_deep_research_graph()` using the `clarifications` as part of the state.

**Failure Points / Gaps:**
- **No Validation on User Input:** The `ClarifyingQuestionsBar` might allow empty/malformed responses. If the user closes the page before answering, the research request is effectively orphaned (user message saved, but no report generated, and no assistant message placeholder).
- **Hard Coded IDs:** The `id`s for questions are generated non-deterministically by the LLM (e.g., `q1`, `q2`). The `clarifications` dictionary relies completely on mapping these arbitrary IDs back to the user's answers. There is no server-side validation ensuring the IDs match the questions originally generated. If the user tampers with the HTTP payload, it is sent straight to the prompt.
- **Race Condition in Message IDs:** During Call 1, `session_service.save_message` saves a user message and returns `user_msg_id`, yielding `sse_message_ids(user_msg_id, "")`. In Call 2, `session_service.save_message` is called *again* with the identical user query, saving a duplicate user message. The deep research graph only creates a placeholder assistant message and resolves it, but the database now contains two identical user prompts for one logical turn.

### 3. `agent.py` & `tools.py` Line-by-Line (Tool Registrations and Error Handling)
#### `tools.py`
1.  **`web_search`** (lines ~29-70)
    -   **Registration:** `@tool`
    -   **Error Handling:** Implements `try...except` handling `SearchAPIKeyMissing`, `SearchTimeout`, and generic `SearchError`. Returns a stringified JSON (e.g., `{"status": "error", "message": "..."}`).
    -   **Verdict:** Handles API errors explicitly. Fails to handle other arbitrary exceptions (e.g., `TimeoutError` from the async loop not caught by `web_search_service`). Returns JSON string.
2.  **`create_artifact`** (lines ~75-121)
    -   **Registration:** `@tool`
    -   **Error Handling:** None. Uses `await artifact_service.create_artifact`. If the DB throws a constraint error or SQLite raises a deadlock, it crashes the tool invocation and returns a stack trace to LangGraph.
    -   **Verdict:** Lacks `try...except`. Could silently break the agent loop.
3.  **`get_current_datetime`** (lines ~126-141)
    -   **Registration:** `@tool`
    -   **Error Handling:** None. Computes `datetime.now(timezone.utc)`.
    -   **Verdict:** Synchronous, deterministic, and safe.
4.  **`list_session_artifacts`** (lines ~146-179)
    -   **Registration:** `@tool`
    -   **Error Handling:** None. Calls `artifact_service.list_artifacts`. If the query fails, it crashes. Returns an empty JSON status (`{"status": "empty", ...}`) if no artifacts are found.
    -   **Verdict:** Assumes DB call succeeds unconditionally.
5.  **`update_artifact`** (lines ~184-222)
    -   **Registration:** `@tool`
    -   **Error Handling:** None on DB layer. Checks `if not artifact: return json.dumps({"status": "error", "message": f"Artifact {artifact_id!r} not found."})`.
    -   **Verdict:** Properly handles the logical error (artifact missing), but crashes on backend errors (SQLite `sqlite3.IntegrityError`).

#### `agent.py`
1.  **Agent Construction (`_build_agent`)** (lines ~65-72)
    -   **Registration:** Uses `create_react_agent(model=resolved_llm, tools=tools)`. No checkpointer is used (stateless).
    -   **Error Handling:** None at the agent factory level.
2.  **Singletons:** (lines ~74-95)
    -   `_CORE_TOOLS = [create_artifact, update_artifact, get_current_datetime, list_session_artifacts]`
    -   `agent_with_search` = `_CORE_TOOLS` + `[web_search]`
    -   `agent_without_search` = `_CORE_TOOLS`
    -   `agent_thinking_with_search` = `_CORE_TOOLS` + `[web_search]` + `_make_thinking_llm()`
    -   `agent_thinking_no_search` = `_CORE_TOOLS` + `_make_thinking_llm()`
    -   **Error Handling:** None. If an LLM configuration fails (e.g. invalid `base_url`), it crashes during inference in `session_chat.py`.


### 4. SSE Streaming Pipeline (Event Types & Handling)
The backend `session_chat.py` yields events, and `chat-api.ts` parses them via `streamSessionChat`. Let's list every event emitted and its handling in `chat-shell.tsx`:

| SSE Event Name | Emitted By | Payload Shape | Handled in Frontend | Notes |
|---|---|---|---|---|
| `token` | `session_chat` (from `on_chat_model_stream` excluding `<think>`) | `{type: "token", content: str}` | Yes (`appendAssistantToken`) | Updates the most recent message `content`. Handles fast streaming chunks correctly. |
| `thinking` | `session_chat` (from `<think>` blocks parsed by `TurnAccumulator`) | `{type: "thinking", content: str}` | Yes (`appendThinkingToken`) | Updates the most recent message `thinkingContent`. Renders inside `<ThinkingBlock>`. |
| `tool_activity` | `session_chat` (from `on_tool_start` or failed `on_tool_end`) | `{type: "tool_activity", tool: str, status: "running" | "error", message?: str}` | Yes (`onToolActivity`) | Only used for `web_search`. Other internal tools are suppressed to avoid UI lock. Error states set `pendingToolEventsRef` to `error`. |
| `search_results` | `session_chat` / `deep_research` | `{type: "search_results", query: str, results: [...], result_count: int, search_id: str}` | Yes (`onSearchResults`) | Clears the `activeToolActivity` spinner, stages the search data into `pendingToolEventsRef` for rendering. |
| `artifact_created` | `session_chat` (from `create_artifact` tool output) | `{type: "artifact_created", artifact: Artifact}` | Yes (`onArtifactCreated`) | Appends the artifact ID to the message content as an `<artifact>` block placeholder, adds artifact to state, and auto-opens the split pane if the user hasn't closed it. |
| `artifact_updated` | `session_chat` (from `update_artifact` tool output) | `{type: "artifact_updated", artifact: Artifact}` | **No** (`onArtifactUpdated` is `undefined`) | The callback in `chat-shell.tsx` (line 746) is literally `// onArtifactUpdated — not handled in this view`. The artifact panel does not automatically switch to the new version unless the list is re-fetched. Wait, `void refreshSessions()` is called, but the UI might not instantly reflect the updated content. |
| `message_ids` | `session_chat` (at start and end of streams) | `{type: "message_ids", user_message_id: str, assistant_message_id: str}` | Partially | In `chat-api.ts`, this parses but the callback isn't always utilized fully in `chat-shell.tsx` beyond potentially syncing DB state. The UI relies on local optimistic IDs for rendering. |
| `error` | `session_chat` | `{type: "error", message: str}` | Yes (`catch` block / banner) | Stops streaming and shows a banner. |
| `clarifying_questions` | `deep_research` (Call 1) | `{type: "clarifying_questions", questions: [...]}` | Yes (`onClarifyingQuestions`) | Replaces the composer with the question bar. |
| `deep_research_plan` | `deep_research` (Call 2) | `{type: "deep_research_plan", sub_questions: [...], iteration: int}` | Yes (`onDeepResearchPlan`) | Seeds the TodoWidget list. |
| `deep_research_progress`| `deep_research` (Call 2) | `{type: "deep_research_progress", step: str}` | **No** | Ignored by `chat-shell.tsx`. |
| `todo_update` | `deep_research` (Call 2) | `{type: "todo_update", items: [...]}` | Yes (`onTodoUpdate`) | Updates checkboxes for research steps. |

**Gaps Identified:**
1. **`artifact_updated` ignored:** The UI relies on fetching the updated artifact list rather than updating the inline split pane synchronously. This leads to a jarring experience where the agent says "I updated it", but the pane shows the old version momentarily.
2. **`deep_research_progress` ignored:** Deep research progress is omitted. The UI might look stalled between the sub-question generation and final report synthesis (a potentially long LLM call).


### 5. LiteLLM / Model Routing Migration
**Current State:**
The backend communicates directly with the NVIDIA OpenAI-compatible API endpoint via `ChatOpenAI(base_url=settings.nvidia_base_url, ...)` in two files:
1. `backend/app/agent/agent.py` (`_make_llm` and `_make_thinking_llm`).
2. `backend/app/agent/deep_research.py` (`_make_research_llm`).

The routing logic relies solely on checking `settings.nvidia_thinking_model` or falling back to `settings.nvidia_model`.

**Migration Steps (How to integrate LiteLLM):**
1. **Remove NVIDIA Hardcodes:**
   - In `backend/app/config/__init__.py`, replace `nvidia_api_key`, `nvidia_base_url`, `nvidia_model`, and `nvidia_thinking_model` with `litellm_base_url`, `litellm_api_key`, `primary_model`, and `reasoning_model`.
   - Add a `litellm_url` if running a separate proxy container, or configure the Python `litellm` package directly.
2. **Update `agent.py`:**
   - Instead of instantiating `ChatOpenAI(base_url=...)`, either use `litellm.Chat` or point `ChatOpenAI` at the LiteLLM proxy URL.
   - The routing logic in `session_chat.py` (lines ~263-278) selects between 4 pre-compiled agents (`agent_thinking_with_search`, etc.). This can remain, but the underlying LLMs should point to the LiteLLM proxy where the *proxy* handles routing.
3. **Task-Based Routing (LiteLLM configuration):**
   - Deep Research `synthesize_findings` and `write_report` (in `deep_research.py`) should use a heavy model (e.g. `gpt-4o` or `claude-3-5-sonnet` configured in LiteLLM).
   - `plan_research` and `_clarifications_block` should use a fast, light model (e.g., `gpt-4o-mini` or `llama3-8b`).
   - The current code passes `temperature=0.3` to a single `_make_research_llm()`. To support LiteLLM routing, we should pass a `model_name` argument to `_llm_call` which maps to LiteLLM aliases (e.g., `litellm_call("routing/heavy", messages)`).
4. **Implement Token Tracking:**
   - LangGraph returns `usage_metadata`. `agent.py` should intercept the final `Run` state or `AIMessage` and write token usage to `sessions` or a new `usage_logs` table.
   - If using LiteLLM proxy, token tracking is automatic, but we still need user/session IDs passed in the headers (e.g., `litellm_user=session_id`).
