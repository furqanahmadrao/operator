"""Deep research agent — multi-step LangGraph StateGraph.

Two-call protocol
-----------------
Call 1: ``deep_research_enabled=True``, ``clarifications=None``
    → ``_generate_clarifying_questions()`` in session_chat.py
    → emits ``clarifying_questions`` SSE, saves user message, sends ``[DONE]``

Call 2: ``deep_research_enabled=True``, ``clarifications={...}``
    → ``run_deep_research_graph()`` (this module)
    → runs the StateGraph below, emits plan/progress SSE
    → creates a Markdown artifact with the report, then ``[DONE]``

StateGraph nodes
----------------
  plan_research       → draft 3-5 focused sub-questions; emit deep_research_plan SSE
  run_searches        → parallel Google CSE calls for every sub-question
  evaluate_coverage   → judge whether search results are sufficient; emit evaluating SSE
  synthesize_findings → merge all search results into a coherent summary; emit synthesizing SSE
  write_report        → compose the final report and create an artifact; emit writing SSE

Edges
-----
  plan_research  ─→  run_searches  ─→  evaluate_coverage
    evaluate_coverage  ─→  synthesize_findings    (if sufficient OR iteration ≥ 2)
    evaluate_coverage  ─→  plan_research           (if needs_more AND iteration < 2)
  synthesize_findings  ─→  write_report  ─→  END
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Annotated, Any, TypedDict

import operator
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph

from app.agent.events import (
    sse_deep_research_plan,
    sse_deep_research_progress,
    sse_search_results,
    sse_todo_update,
)
from app.config import settings
from app.services.artifact_service import create_artifact as db_create_artifact
from app.services.google_search import (
    GoogleSearchError,
    google_search_service,
)

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------


class DeepResearchState(TypedDict):
    """Full state for a single deep-research run."""

    query: str
    clarifications: dict[str, str]
    sub_questions: list[str]
    # Accumulated across iterations via operator.add
    search_results: Annotated[list[dict[str, Any]], operator.add]
    iteration: int
    evaluation: str          # "sufficient" | "needs_more"
    synthesis: str
    report: str
    session_id: str
    assistant_message_id: str   # set by session_chat.py for artifact linking
    sse_queue: asyncio.Queue    # write-only; session_chat.py drains this


# ---------------------------------------------------------------------------
# LLM factory
# ---------------------------------------------------------------------------


def _make_research_llm() -> ChatOpenAI:
    """Fast, capable model for research reasoning (not the slow R1 variant)."""
    return ChatOpenAI(
        model=settings.nvidia_model,
        api_key=settings.nvidia_api_key,          # type: ignore[arg-type]
        base_url=settings.nvidia_base_url,
        max_tokens=settings.nvidia_max_tokens,
        temperature=0.3,
        streaming=False,
    )


# ---------------------------------------------------------------------------
# Node helpers
# ---------------------------------------------------------------------------


def _clarifications_block(clarifications: dict[str, str]) -> str:
    """Format the user's question answers into a human-readable block."""
    if not clarifications:
        return ""
    lines = ["\n\nUser clarifications:"]
    for q, a in clarifications.items():
        lines.append(f"  Q: {q}")
        lines.append(f"  A: {a}")
    return "\n".join(lines)


async def _llm_call(messages: list, *, temperature: float = 0.3) -> str:
    """Make a single non-streaming LLM call and return the text content."""
    llm = _make_research_llm()
    # Override temperature per call
    llm.temperature = temperature  # type: ignore[assignment]
    response = await llm.ainvoke(messages)
    content = response.content
    if isinstance(content, list):
        # Handle content-block format
        parts = [p.get("text", "") for p in content if isinstance(p, dict)]
        content = "".join(parts)
    return str(content).strip()


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------


async def plan_research(state: DeepResearchState) -> dict[str, Any]:
    """Draft 3-5 focused sub-questions for the current iteration."""
    iteration = state.get("iteration", 0)
    clarifications = state.get("clarifications", {})
    previous_results = state.get("search_results", [])

    context_block = _clarifications_block(clarifications)

    if iteration == 0 or not previous_results:
        system = (
            "You are a research planning assistant. "
            "Your job is to break a complex research query into 3-5 focused, "
            "specific sub-questions that can each be answered by a single web search. "
            "Return ONLY a JSON array of strings — no explanation, no markdown fences. "
            'Example: ["What is X?", "How does Y work?", "Why does Z matter?"]'
        )
        human_content = (
            f"Research query: {state['query']}{context_block}\n\n"
            "Generate 3-5 specific sub-questions to thoroughly research this topic."
        )
    else:
        # Second iteration — identify gaps from first round
        prev_queries = [r.get("query", "") for r in previous_results]
        system = (
            "You are a research planning assistant tasked with gap analysis. "
            "Given what has already been searched, identify 2-3 new, different "
            "sub-questions that would fill the remaining gaps. "
            "Return ONLY a JSON array of strings — no explanation, no markdown fences."
        )
        human_content = (
            f"Research query: {state['query']}{context_block}\n\n"
            f"Already searched: {json.dumps(prev_queries)}\n\n"
            "What 2-3 different sub-questions would fill the remaining research gaps?"
        )

    raw = await _llm_call([SystemMessage(content=system), HumanMessage(content=human_content)])

    # Robustly parse the JSON array
    sub_questions: list[str] = []
    try:
        # Strip potential markdown fences the model may add despite instruction
        cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            sub_questions = [str(q) for q in parsed if q]
    except (json.JSONDecodeError, ValueError):
        log.warning("plan_research: Could not parse LLM output as JSON array: %r", raw)
        # Fallback: treat each line as a question
        sub_questions = [line.strip(" -•") for line in raw.splitlines() if line.strip()]

    sub_questions = sub_questions[:5] or [state["query"]]  # always have at least one

    # Emit SSE plan event
    await state["sse_queue"].put(
        sse_deep_research_plan(sub_questions, iteration)
    )

    return {"sub_questions": sub_questions, "iteration": iteration + 1}


async def run_searches(state: DeepResearchState) -> dict[str, Any]:
    """Run parallel Google CSE searches; emit live todo + source SSE events."""
    # Initialise a mutable snapshot of todo states for this batch
    todos: list[dict[str, str]] = [
        {"id": f"s{i}", "text": q, "status": "pending"}
        for i, q in enumerate(state["sub_questions"])
    ]

    async def _search_one(idx: int, q: str) -> dict[str, Any]:
        # Mark active and notify frontend
        todos[idx] = {**todos[idx], "status": "active"}
        await state["sse_queue"].put(sse_todo_update([dict(t) for t in todos]))
        try:
            result = await google_search_service.search(q, max_results=8)
            todos[idx] = {**todos[idx], "status": "done"}
            await state["sse_queue"].put(sse_todo_update([dict(t) for t in todos]))
            # Emit sources so the sidebar can display them as they arrive
            if result.results:
                await state["sse_queue"].put(
                    sse_search_results(
                        query=q,
                        results=[r.model_dump() for r in result.results],
                        result_count=result.result_count,
                        search_id=f"dr-{uuid.uuid4().hex[:8]}",
                    )
                )
            return {
                "query": q,
                "results": [r.model_dump() for r in result.results],
                "result_count": result.result_count,
            }
        except GoogleSearchError as exc:
            todos[idx] = {**todos[idx], "status": "done"}
            await state["sse_queue"].put(sse_todo_update([dict(t) for t in todos]))
            log.warning("Deep research search failed for %r: %s", q, exc)
            return {"query": q, "results": [], "result_count": 0, "error": str(exc)}

    tasks = [_search_one(i, q) for i, q in enumerate(state["sub_questions"])]
    batch_results: list[dict[str, Any]] = list(await asyncio.gather(*tasks))

    return {"search_results": batch_results}   # operator.add accumulates across iterations


async def evaluate_coverage(state: DeepResearchState) -> dict[str, Any]:
    """Judge whether the collected search results are sufficient to write a report."""
    await state["sse_queue"].put(sse_deep_research_progress("evaluating"))

    all_results = state.get("search_results", [])
    total_snippets = sum(len(r.get("results", [])) for r in all_results)

    # Cheap heuristic: if we have fewer than 3 snippets treat as insufficient on first pass
    iteration = state.get("iteration", 1)
    if total_snippets < 3 and iteration < 2:
        return {"evaluation": "needs_more"}

    system = (
        "You are evaluating whether search results provide sufficient information "
        "to write a comprehensive research report. "
        "Respond with EXACTLY one word: 'sufficient' or 'needs_more'. "
        "No other text."
    )
    summary = json.dumps(
        [
            {
                "query": r["query"],
                "snippets": [s.get("snippet", "") for s in r.get("results", [])[:3]],
            }
            for r in all_results
        ],
        ensure_ascii=False,
    )
    human_content = (
        f"Research topic: {state['query']}\n\n"
        f"Search results so far:\n{summary}\n\n"
        "Are these results sufficient to write a comprehensive, well-sourced report? "
        "Respond with 'sufficient' or 'needs_more'."
    )

    raw = await _llm_call([SystemMessage(content=system), HumanMessage(content=human_content)])
    evaluation = "sufficient" if "sufficient" in raw.lower() else "needs_more"
    return {"evaluation": evaluation}


def _route_after_evaluation(state: DeepResearchState) -> str:
    """Conditional edge: loop back or proceed to synthesis."""
    if state.get("evaluation") == "needs_more" and state.get("iteration", 1) < 3:
        return "plan_research"
    return "synthesize_findings"


async def synthesize_findings(state: DeepResearchState) -> dict[str, Any]:
    """Merge all search results into a coherent set of findings."""
    await state["sse_queue"].put(sse_deep_research_progress("synthesizing"))

    clarifications = state.get("clarifications", {})
    context_block = _clarifications_block(clarifications)

    # Build a compact digest of all search results
    findings_text_parts: list[str] = []
    for batch in state.get("search_results", []):
        findings_text_parts.append(f"\n### Sub-topic: {batch['query']}")
        for item in batch.get("results", [])[:5]:
            title = item.get("title", "")
            snippet = item.get("snippet", "")
            url = item.get("url", "")
            findings_text_parts.append(f"- **{title}** ({url})\n  {snippet}")
    findings_text = "\n".join(findings_text_parts)

    system = (
        "You are a research analyst. Synthesize the following search results into "
        "a structured set of findings covering the key facts, context, and insights. "
        "Preserve important source URLs. Be factual and thorough. "
        "Format the output as well-structured paragraphs grouped by sub-topic. "
        "Do not write a final report yet — just an organized synthesis."
    )
    human_content = (
        f"Research topic: {state['query']}{context_block}\n\n"
        f"Search results:\n{findings_text}\n\n"
        "Synthesize these into organized findings."
    )

    synthesis = await _llm_call(
        [SystemMessage(content=system), HumanMessage(content=human_content)],
        temperature=0.2,
    )
    return {"synthesis": synthesis}


async def write_report(state: DeepResearchState) -> dict[str, Any]:
    """Write the final report and persist it as an artifact."""
    await state["sse_queue"].put(sse_deep_research_progress("writing"))

    clarifications = state.get("clarifications", {})
    context_block = _clarifications_block(clarifications)

    system = (
        "You are a professional research writer. "
        "Write a comprehensive, well-structured research report in Markdown. "
        "The report should include:\n"
        "  - An executive summary (2-3 sentences)\n"
        "  - Key findings organized by theme\n"
        "  - Source citations inline as [Title](url)\n"
        "  - A brief conclusion\n"
        "Use headers (##, ###), bullet points, and bold text for readability. "
        "Be thorough, factual, and cite sources where possible."
    )
    human_content = (
        f"Research topic: {state['query']}{context_block}\n\n"
        f"Synthesized findings:\n{state.get('synthesis', '')}\n\n"
        "Write the final research report."
    )

    report = await _llm_call(
        [SystemMessage(content=system), HumanMessage(content=human_content)],
        temperature=0.2,
    )

    # Derive a concise report title from the original query
    title_prompt = (
        f"Create a concise 5-8 word title for a research report about: {state['query']}\n"
        "Return ONLY the title text, no quotes, no punctuation at the end."
    )
    raw_title = await _llm_call([HumanMessage(content=title_prompt)], temperature=0.1)
    title = raw_title.strip().strip('"').strip("'")[:120] or f"Research: {state['query'][:80]}"

    # Persist the artifact
    artifact = await db_create_artifact(
        session_id=state["session_id"],
        title=title,
        content=report,
        artifact_type="markdown",
        source_message_id=state.get("assistant_message_id") or None,
    )

    # Signal to session_chat.py via a sentinel in the queue
    await state["sse_queue"].put({"_artifact": artifact})

    return {"report": report}


# ---------------------------------------------------------------------------
# Build the graph
# ---------------------------------------------------------------------------


def _build_graph() -> Any:
    """Compile the deep-research StateGraph."""
    builder: StateGraph = StateGraph(DeepResearchState)

    builder.add_node("plan_research", plan_research)
    builder.add_node("run_searches", run_searches)
    builder.add_node("evaluate_coverage", evaluate_coverage)
    builder.add_node("synthesize_findings", synthesize_findings)
    builder.add_node("write_report", write_report)

    builder.set_entry_point("plan_research")
    builder.add_edge("plan_research", "run_searches")
    builder.add_edge("run_searches", "evaluate_coverage")
    builder.add_conditional_edges(
        "evaluate_coverage",
        _route_after_evaluation,
        {
            "plan_research": "plan_research",
            "synthesize_findings": "synthesize_findings",
        },
    )
    builder.add_edge("synthesize_findings", "write_report")
    builder.add_edge("write_report", END)

    return builder.compile()


_deep_research_graph = _build_graph()


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def run_deep_research_graph(
    *,
    session_id: str,
    query: str,
    clarifications: dict[str, str],
    assistant_message_id: str,
    sse_queue: asyncio.Queue,
) -> dict[str, Any]:
    """Run the deep-research StateGraph and return the final state.

    SSE events are pushed to *sse_queue* by each node.
    The caller (session_chat.py) drains the queue and yields SSE text.

    Returns the final ``DeepResearchState`` dict; the ``report`` key contains
    the full Markdown report and ``_artifact`` may carry the artifact object.
    """
    initial_state: DeepResearchState = {
        "query": query,
        "clarifications": clarifications,
        "sub_questions": [],
        "search_results": [],
        "iteration": 0,
        "evaluation": "",
        "synthesis": "",
        "report": "",
        "session_id": session_id,
        "assistant_message_id": assistant_message_id,
        "sse_queue": sse_queue,
    }

    final_state = await _deep_research_graph.ainvoke(initial_state)
    return final_state


async def generate_clarifying_questions(query: str) -> list[dict[str, Any]]:
    """Generate 3-5 clarifying questions for a deep research query.

    Each returned dict has the shape::

        {
            "id": str,
            "text": str,
            "type": "single_select" | "multi_select" | "text",
            "choices": list[str]  # empty list for "text" type
        }

    Question types:
    - ``single_select`` — user picks exactly one option (radio buttons)
    - ``multi_select`` — user may pick several options (checkboxes)
    - ``text`` — open-ended free text answer (no choices)

    The frontend always appends an "Other…" option with a text input for
    single_select and multi_select, so do NOT add vague 'Other' entries.
    """
    system = (
        "You are a research assistant helping to clarify a user's research request. "
        "Generate 3-5 clarifying questions that would help produce a more focused report.\n\n"
        "Each question must have a 'type' field:\n"
        "  - 'single_select': user picks ONE answer — use for scope/focus/audience type questions.\n"
        "    Provide 3-5 specific choices. Never include a vague 'Other'.\n"
        "  - 'multi_select': user can pick MULTIPLE answers — use for feature lists, use-cases, etc.\n"
        "    Provide 4-7 specific choices. Never include a vague 'Other'.\n"
        "  - 'text': open-ended question with no choices — use sparingly for truly open questions.\n\n"
        "Return ONLY valid JSON — an array of objects with this exact shape:\n"
        "[\n"
        "  {\n"
        "    \"id\": \"q1\",\n"
        "    \"text\": \"What is your target audience?\",\n"
        "    \"type\": \"single_select\",\n"
        "    \"choices\": [\"Developers\", \"Business executives\", \"General public\", \"Students\"]\n"
        "  },\n"
        "  {\n"
        "    \"id\": \"q2\",\n"
        "    \"text\": \"Which aspects should the research cover?\",\n"
        "    \"type\": \"multi_select\",\n"
        "    \"choices\": [\"History\", \"Technical details\", \"Market analysis\", \"Future trends\", \"Case studies\"]\n"
        "  }\n"
        "]\n"
        "Use ids q1, q2, q3, etc. Return 3-5 questions. No markdown fences, no explanation."
    )
    human_content = (
        f"Research query: {query}\n\n"
        "Generate clarifying questions to help me research this topic more effectively."
    )

    raw = await _llm_call(
        [SystemMessage(content=system), HumanMessage(content=human_content)],
        temperature=0.4,
    )

    questions: list[dict[str, Any]] = []
    try:
        cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            for item in parsed:
                if isinstance(item, dict) and "id" in item and "text" in item:
                    q_type = str(item.get("type", "single_select"))
                    if q_type not in ("single_select", "multi_select", "text"):
                        q_type = "single_select"
                    questions.append(
                        {
                            "id": str(item["id"]),
                            "text": str(item["text"]),
                            "type": q_type,
                            "choices": [str(c) for c in item.get("choices", []) if c],
                        }
                    )
    except (json.JSONDecodeError, ValueError):
        log.warning("generate_clarifying_questions: Could not parse output: %r", raw)

    # Graceful fallback: one generic question if parsing failed
    if not questions:
        questions = [
            {
                "id": "q1",
                "text": "What is the main purpose of this research?",
                "type": "single_select",
                "choices": [
                    "Academic / learning",
                    "Business decision",
                    "Personal curiosity",
                    "Writing / content creation",
                ],
            }
        ]

    return questions[:5]
