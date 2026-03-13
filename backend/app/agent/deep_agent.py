"""Deep Agent implementation with planning, execution, and reflection capabilities.

This module implements a LangGraph-based deep agent that can:
- Plan complex tasks by decomposing them into sub-tasks
- Execute sub-tasks using MCP tools
- Reflect on outcomes and adjust strategy
- Persist state across multiple turns (checkpointer integration pending)

The deep agent extends the existing agent architecture while maintaining
compatibility with the current SSE streaming patterns.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Annotated, TypedDict

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langgraph.graph.message import add_messages
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END

from app.services.llm import make_chat_llm
from app.mcp.server import get_mcp_server
from app.config import settings

log = logging.getLogger(__name__)


class DeepAgentState(TypedDict):
    """State schema for the deep agent graph.
    
    This state is persisted across turns using LangGraph's checkpointer
    and allows the agent to maintain context for complex multi-step tasks.
    """
    # Core conversation state
    messages: Annotated[list[BaseMessage], add_messages]
    
    # Planning state
    plan: list[str]  # List of sub-tasks to execute
    current_step: int  # Current step index in the plan
    completed_steps: list[str]  # Successfully completed sub-tasks
    
    # Execution state
    tool_results: dict[str, Any]  # Results from tool invocations
    reflection: str  # Agent's reflection on progress and outcomes
    
    # Session context
    session_id: str
    
    # SSE streaming (write-only queue for emitting events)
    sse_queue: asyncio.Queue | None


# Global deep agent instance (will be initialized on first use)
_deep_agent_graph = None


async def _emit_sse_event(state: DeepAgentState, event_type: str, payload: dict[str, Any]) -> None:
    """Emit an SSE event if the queue is available."""
    if state.get("sse_queue"):
        event = {
            "type": event_type,
            "payload": payload,
            "session_id": state["session_id"]
        }
        await state["sse_queue"].put(event)


# Node implementations will be added in subsequent subtasks


async def planning_node(state: DeepAgentState) -> dict[str, Any]:
    """Planning node that decomposes complex tasks into sub-tasks.
    
    This node analyzes the user's request and creates a structured plan
    with specific, actionable sub-tasks that can be executed by the agent.
    """
    log.info("Deep agent planning phase started for session %s", state["session_id"])
    
    # Get the latest user message
    user_messages = [msg for msg in state["messages"] if isinstance(msg, HumanMessage)]
    if not user_messages:
        return {"plan": [], "current_step": 0}
    
    latest_request = user_messages[-1].content
    
    # Create planning prompt
    planning_prompt = f"""You are an AI agent tasked with breaking down complex requests into actionable sub-tasks.

User Request: {latest_request}

Available tools include:
- Web search and content fetching
- Browser automation (navigate, click, extract content, screenshots)
- Terminal commands (file operations, system commands)
- File operations (read, write, delete files)
- Artifact creation (documents, code, presentations)

Please create a detailed plan by breaking this request into 3-7 specific, actionable sub-tasks.
Each sub-task should be:
1. Specific and measurable
2. Executable using available tools
3. Building toward the overall goal
4. Ordered logically (dependencies considered)

Format your response as a numbered list of sub-tasks, with each task being a single, clear action.

Example format:
1. Search for information about X
2. Navigate to website Y and extract data
3. Create a document summarizing findings
4. Generate final artifact with results

Your plan:"""

    # Get LLM for planning
    llm = make_chat_llm(temperature=0.3, max_tokens=1000)
    
    try:
        # Generate plan
        planning_messages = [HumanMessage(content=planning_prompt)]
        response = await llm.ainvoke(planning_messages)
        plan_text = response.content
        
        # Parse the plan into individual sub-tasks
        plan_lines = [line.strip() for line in plan_text.split('\n') if line.strip()]
        sub_tasks = []
        
        for line in plan_lines:
            # Extract numbered items (1. Task, 2. Task, etc.)
            if line and (line[0].isdigit() or line.startswith('- ')):
                # Remove numbering and clean up
                task = line.split('.', 1)[-1].strip() if '.' in line else line.lstrip('- ').strip()
                if task:
                    sub_tasks.append(task)
        
        # Emit planning event for frontend
        await _emit_sse_event(state, "planning", {
            "sub_tasks": sub_tasks,
            "reasoning": plan_text
        })
        
        log.info("Generated plan with %d sub-tasks for session %s", len(sub_tasks), state["session_id"])
        
        return {
            "plan": sub_tasks,
            "current_step": 0,
            "completed_steps": [],
            "tool_results": {}
        }
        
    except Exception as e:
        log.error("Planning failed for session %s: %s", state["session_id"], e)
        await _emit_sse_event(state, "error", {
            "error_type": "planning_error",
            "message": f"Failed to create plan: {str(e)}",
            "recoverable": True
        })
        
        # Fallback to simple single-task plan
        return {
            "plan": [latest_request],
            "current_step": 0,
            "completed_steps": [],
            "tool_results": {}
        }

async def execution_node(state: DeepAgentState) -> dict[str, Any]:
    """Execution node that executes the current sub-task using MCP tools.
    
    This node takes the current sub-task from the plan and executes it
    using the available MCP tools (browser, terminal, web search, etc.).
    """
    log.info("Deep agent execution phase started for session %s", state["session_id"])
    
    plan = state.get("plan", [])
    current_step = state.get("current_step", 0)
    
    # Check if we have more tasks to execute
    if current_step >= len(plan):
        log.info("All tasks completed for session %s", state["session_id"])
        return {"current_step": current_step}
    
    current_task = plan[current_step]
    log.info("Executing task %d/%d: %s", current_step + 1, len(plan), current_task)
    
    # Emit progress update
    await _emit_sse_event(state, "progress_update", {
        "task_name": current_task,
        "current_step": current_step + 1,
        "total_steps": len(plan),
        "step_description": f"Executing: {current_task}",
        "status": "in_progress"
    })
    
    # Get MCP server for tool execution
    mcp_server = get_mcp_server()
    
    # Create execution prompt with context
    execution_prompt = f"""You are executing a specific sub-task as part of a larger plan.

Current Task: {current_task}

Full Plan Context:
{chr(10).join(f"{i+1}. {task}" for i, task in enumerate(plan))}

Previous Results:
{state.get('tool_results', {})}

Available Tools:
{chr(10).join(f"- {tool.name}: {tool.description}" for tool in mcp_server.list_tools())}

Execute the current task using the appropriate tools. Be specific and thorough.
If you need to use multiple tools in sequence, do so.
Focus only on completing the current task - don't try to do other tasks from the plan.

Provide a clear summary of what you accomplished when done."""

    # Get LLM for execution
    llm = make_chat_llm(temperature=0.1, max_tokens=2000)
    
    try:
        # Build messages for execution
        execution_messages = state["messages"].copy()
        execution_messages.append(HumanMessage(content=execution_prompt))
        
        # Create a simple ReAct loop for tool execution
        max_iterations = 10
        iteration = 0
        task_completed = False
        execution_summary = ""
        
        while iteration < max_iterations and not task_completed:
            # Get LLM response
            response = await llm.ainvoke(execution_messages)
            execution_messages.append(response)
            
            # Check if the response contains tool calls
            if hasattr(response, 'tool_calls') and response.tool_calls:
                # Execute tool calls
                for tool_call in response.tool_calls:
                    tool_name = tool_call['name']
                    tool_args = tool_call.get('args', {})
                    
                    # Emit tool start event
                    await _emit_sse_event(state, "tool_start", {
                        "tool_name": tool_name,
                        "arguments": tool_args
                    })
                    
                    try:
                        # Execute tool via MCP server
                        tool_result = await mcp_server.call_tool(
                            name=tool_name,
                            arguments=tool_args,
                            config={"session_id": state["session_id"]}
                        )
                        
                        # Emit tool end event
                        await _emit_sse_event(state, "tool_end", {
                            "tool_name": tool_name,
                            "success": tool_result.success,
                            "result": tool_result.result if tool_result.success else tool_result.error
                        })
                        
                        # Add tool result to messages
                        tool_message = AIMessage(content=f"Tool {tool_name} result: {tool_result.result}")
                        execution_messages.append(tool_message)
                        
                    except Exception as e:
                        log.error("Tool execution failed: %s", e)
                        await _emit_sse_event(state, "tool_end", {
                            "tool_name": tool_name,
                            "success": False,
                            "result": f"Tool execution failed: {str(e)}"
                        })
                        
                        error_message = AIMessage(content=f"Tool {tool_name} failed: {str(e)}")
                        execution_messages.append(error_message)
            
            else:
                # No more tool calls, task might be completed
                execution_summary = response.content
                task_completed = True
            
            iteration += 1
        
        # Store execution results
        task_key = f"task_{current_step}"
        updated_results = state.get("tool_results", {}).copy()
        updated_results[task_key] = {
            "task": current_task,
            "summary": execution_summary,
            "completed": task_completed,
            "iteration_count": iteration
        }
        
        # Update completed steps
        completed_steps = state.get("completed_steps", []).copy()
        if task_completed:
            completed_steps.append(current_task)
        
        log.info("Task execution completed for step %d, session %s", current_step, state["session_id"])
        
        return {
            "current_step": current_step + 1,
            "completed_steps": completed_steps,
            "tool_results": updated_results,
            "messages": execution_messages
        }
        
    except Exception as e:
        log.error("Execution failed for session %s: %s", state["session_id"], e)
        await _emit_sse_event(state, "error", {
            "error_type": "execution_error",
            "message": f"Failed to execute task: {str(e)}",
            "recoverable": True
        })
        
        # Mark task as failed but continue
        task_key = f"task_{current_step}"
        updated_results = state.get("tool_results", {}).copy()
        updated_results[task_key] = {
            "task": current_task,
            "summary": f"Task failed: {str(e)}",
            "completed": False,
            "error": str(e)
        }
        
        return {
            "current_step": current_step + 1,
            "tool_results": updated_results
        }

async def reflection_node(state: DeepAgentState) -> dict[str, Any]:
    """Reflection node that evaluates progress and decides next actions.
    
    This node analyzes the completed tasks, evaluates outcomes, and determines
    whether to continue with remaining tasks, adjust the plan, or conclude.
    """
    log.info("Deep agent reflection phase started for session %s", state["session_id"])
    
    plan = state.get("plan", [])
    current_step = state.get("current_step", 0)
    completed_steps = state.get("completed_steps", [])
    tool_results = state.get("tool_results", {})
    
    # Check if all tasks are completed
    if current_step >= len(plan):
        log.info("All tasks completed, performing final reflection for session %s", state["session_id"])
        
        # Create final reflection prompt
        reflection_prompt = f"""You have completed a multi-step task. Please reflect on the overall progress and outcomes.

Original Plan:
{chr(10).join(f"{i+1}. {task}" for i, task in enumerate(plan))}

Completed Tasks: {len(completed_steps)}/{len(plan)}
Successfully Completed:
{chr(10).join(f"✓ {task}" for task in completed_steps)}

Task Results:
{chr(10).join(f"Task {i+1}: {result.get('summary', 'No summary')}" for i, result in enumerate(tool_results.values()))}

Please provide a comprehensive reflection covering:
1. What was accomplished successfully
2. Any challenges or failures encountered
3. Overall assessment of goal achievement
4. Key insights or learnings

Keep your reflection concise but thorough."""

        reflection_type = "final"
    else:
        # Intermediate reflection during execution
        current_task = plan[current_step - 1] if current_step > 0 else "Starting"
        next_task = plan[current_step] if current_step < len(plan) else "None"
        
        reflection_prompt = f"""You are in the middle of executing a multi-step plan. Reflect on progress so far.

Original Plan:
{chr(10).join(f"{i+1}. {task}" for i, task in enumerate(plan))}

Progress: {current_step}/{len(plan)} tasks attempted
Completed: {len(completed_steps)} tasks successfully

Last Task Attempted: {current_task}
Next Task: {next_task}

Recent Results:
{chr(10).join(f"Task {i+1}: {result.get('summary', 'No summary')} ({'✓' if result.get('completed') else '✗'})" for i, result in list(enumerate(tool_results.values()))[-3:])}

Please provide a brief reflection covering:
1. Progress assessment - are we on track?
2. Any issues with the last task that might affect future tasks
3. Should we continue with the plan as-is or make adjustments?
4. Confidence level for completing remaining tasks

Keep your reflection focused and actionable."""

        reflection_type = "intermediate"
    
    # Get LLM for reflection
    llm = make_chat_llm(temperature=0.4, max_tokens=800)
    
    try:
        # Generate reflection
        reflection_messages = [HumanMessage(content=reflection_prompt)]
        response = await llm.ainvoke(reflection_messages)
        reflection_text = response.content
        
        # Emit reflection event for frontend
        await _emit_sse_event(state, "reflection", {
            "reflection_type": reflection_type,
            "content": reflection_text,
            "progress": {
                "completed_tasks": len(completed_steps),
                "total_tasks": len(plan),
                "current_step": current_step
            }
        })
        
        log.info("Generated %s reflection for session %s", reflection_type, state["session_id"])
        
        return {
            "reflection": reflection_text
        }
        
    except Exception as e:
        log.error("Reflection failed for session %s: %s", state["session_id"], e)
        await _emit_sse_event(state, "error", {
            "error_type": "reflection_error",
            "message": f"Failed to generate reflection: {str(e)}",
            "recoverable": True
        })
        
        # Fallback reflection
        fallback_reflection = f"Completed {len(completed_steps)} out of {len(plan)} planned tasks. Continuing with execution."
        return {
            "reflection": fallback_reflection
        }


def _should_continue_execution(state: DeepAgentState) -> str:
    """Routing function to determine next step after reflection.
    
    Returns:
        "execute" if there are more tasks to complete
        "respond" if all tasks are done or should stop
    """
    plan = state.get("plan", [])
    current_step = state.get("current_step", 0)
    
    # Continue if there are more tasks
    if current_step < len(plan):
        return "execute"
    else:
        return "respond"
async def response_node(state: DeepAgentState) -> dict[str, Any]:
    """Response node that synthesizes final response from completed work.
    
    This node creates a comprehensive response based on all completed tasks,
    their results, and the agent's reflection on the overall process.
    """
    log.info("Deep agent response phase started for session %s", state["session_id"])
    
    plan = state.get("plan", [])
    completed_steps = state.get("completed_steps", [])
    tool_results = state.get("tool_results", {})
    reflection = state.get("reflection", "")
    
    # Get the original user request
    user_messages = [msg for msg in state["messages"] if isinstance(msg, HumanMessage)]
    original_request = user_messages[-1].content if user_messages else "Complete the requested task"
    
    # Create response synthesis prompt
    response_prompt = f"""You have completed a multi-step task execution. Now synthesize a comprehensive response for the user.

Original User Request: {original_request}

Execution Plan:
{chr(10).join(f"{i+1}. {task}" for i, task in enumerate(plan))}

Completed Tasks ({len(completed_steps)}/{len(plan)}):
{chr(10).join(f"✓ {task}" for task in completed_steps)}

Task Results Summary:
{chr(10).join(f"Task {i+1}: {result.get('summary', 'No summary available')}" for i, result in enumerate(tool_results.values()))}

Agent Reflection:
{reflection}

Please provide a comprehensive response to the user that:
1. Directly addresses their original request
2. Summarizes what was accomplished
3. Highlights key findings or results
4. Mentions any limitations or partial completions
5. Suggests next steps if appropriate

Be conversational and helpful. Focus on value delivered to the user rather than internal process details.
If artifacts were created, mention them. If data was gathered, summarize key insights.

Your response:"""

    # Get LLM for response generation
    llm = make_chat_llm(temperature=0.7, max_tokens=1500)
    
    try:
        # Generate final response
        response_messages = [HumanMessage(content=response_prompt)]
        response = await llm.ainvoke(response_messages)
        final_response = response.content
        
        # Create final AI message for conversation
        ai_message = AIMessage(content=final_response)
        
        # Emit final progress update
        await _emit_sse_event(state, "progress_update", {
            "task_name": "Task Completion",
            "current_step": len(plan),
            "total_steps": len(plan),
            "step_description": "All tasks completed",
            "status": "completed"
        })
        
        log.info("Generated final response for session %s", state["session_id"])
        
        return {
            "messages": [ai_message]
        }
        
    except Exception as e:
        log.error("Response generation failed for session %s: %s", state["session_id"], e)
        await _emit_sse_event(state, "error", {
            "error_type": "response_error",
            "message": f"Failed to generate response: {str(e)}",
            "recoverable": False
        })
        
        # Fallback response
        fallback_response = f"""I've completed the requested task with {len(completed_steps)} out of {len(plan)} planned steps successfully executed. 

Here's a summary of what was accomplished:
{chr(10).join(f"• {task}" for task in completed_steps)}

Please let me know if you need any clarification or have additional requests."""
        
        ai_message = AIMessage(content=fallback_response)
        return {
            "messages": [ai_message]
        }

def _build_deep_agent_graph() -> StateGraph:
    """Build the deep agent StateGraph with all nodes and connections.
    
    Graph flow:
    START -> planning -> execution -> reflection -> (continue execution OR respond) -> END
    
    The reflection node uses conditional routing to either continue execution
    of remaining tasks or proceed to final response generation.
    """
    log.info("Building deep agent graph")
    
    # Create the state graph
    graph = StateGraph(DeepAgentState)
    
    # Add nodes
    graph.add_node("planning", planning_node)
    graph.add_node("execution", execution_node)
    graph.add_node("reflection", reflection_node)
    graph.add_node("response", response_node)
    
    # Add edges
    # Start with planning
    graph.set_entry_point("planning")
    
    # Planning -> Execution
    graph.add_edge("planning", "execution")
    
    # Execution -> Reflection
    graph.add_edge("execution", "reflection")
    
    # Reflection -> Conditional routing (continue execution or respond)
    graph.add_conditional_edges(
        "reflection",
        _should_continue_execution,
        {
            "execute": "execution",  # More tasks to do
            "respond": "response"    # All done, generate final response
        }
    )
    
    # Response -> END
    graph.add_edge("response", END)
    
    log.info("Deep agent graph built successfully")
    return graph


def get_deep_agent_graph():
    """Get or create the compiled deep agent graph.
    
    This function returns a compiled graph that can be used for streaming
    execution. Checkpointer integration will be added in a future update.
    """
    global _deep_agent_graph
    
    if _deep_agent_graph is None:
        log.info("Initializing deep agent graph")
        
        # Build the graph
        graph = _build_deep_agent_graph()
        
        # Compile without checkpointer for now (will be added later)
        _deep_agent_graph = graph.compile()
        
        log.info("Deep agent graph compiled and ready")
    
    return _deep_agent_graph
async def run_deep_agent(
    messages: list[BaseMessage],
    session_id: str,
    sse_queue: asyncio.Queue | None = None
) -> AsyncGenerator[dict[str, Any], None]:
    """Run the deep agent with the given messages and session context.
    
    This function provides the main interface for executing the deep agent.
    It handles state initialization and streaming execution.
    
    Args:
        messages: Conversation messages including the user's request
        session_id: Session ID for correlation (state persistence will be added later)
        sse_queue: Optional queue for emitting SSE events to frontend
        
    Yields:
        State updates and events from the deep agent execution
    """
    log.info("Starting deep agent execution for session %s", session_id)
    
    try:
        # Get the compiled graph
        graph = get_deep_agent_graph()
        
        # Create initial state
        initial_state = {
            "messages": messages,
            "plan": [],
            "current_step": 0,
            "completed_steps": [],
            "tool_results": {},
            "reflection": "",
            "session_id": session_id,
            "sse_queue": sse_queue
        }
        
        # Stream execution (checkpointer config will be added later)
        async for event in graph.astream(initial_state):
            log.debug("Deep agent event: %s", event)
            yield event
            
        log.info("Deep agent execution completed for session %s", session_id)
        
    except Exception as e:
        log.error("Deep agent execution failed for session %s: %s", session_id, e)
        
        # Emit error event if queue available
        if sse_queue:
            error_event = {
                "type": "error",
                "payload": {
                    "error_type": "deep_agent_error",
                    "message": f"Deep agent execution failed: {str(e)}",
                    "recoverable": False
                },
                "session_id": session_id
            }
            await sse_queue.put(error_event)
        
        # Re-raise for upstream handling
        raise


async def get_deep_agent_state(session_id: str) -> dict[str, Any] | None:
    """Get the current state for a deep agent session.
    
    Args:
        session_id: Session ID to retrieve state for
        
    Returns:
        Current state dict or None if no state exists
        
    Note: State persistence will be implemented when checkpointer is added.
    """
    # TODO: Implement with checkpointer
    log.warning("State persistence not yet implemented for session %s", session_id)
    return None


async def clear_deep_agent_state(session_id: str) -> bool:
    """Clear the state for a deep agent session.
    
    Args:
        session_id: Session ID to clear state for
        
    Returns:
        True if state was cleared successfully, False otherwise
        
    Note: State persistence will be implemented when checkpointer is added.
    """
    # TODO: Implement with checkpointer
    log.warning("State persistence not yet implemented for session %s", session_id)
    return True