"""
MCP (Model Context Protocol) API endpoints.

Provides HTTP endpoints for MCP tool discovery and invocation.
"""

import logging
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.mcp.server import get_mcp_server

log = logging.getLogger(__name__)

router = APIRouter()


class ToolSchema(BaseModel):
    """MCP tool schema for API responses."""
    
    name: str = Field(..., description="Tool name")
    description: str = Field(..., description="Tool description")
    inputSchema: dict = Field(..., description="JSON Schema for tool parameters")


class ToolListResponse(BaseModel):
    """Response for listing available tools."""
    
    tools: List[ToolSchema] = Field(..., description="List of available tools")


class ToolCallRequest(BaseModel):
    """Request for calling a tool."""
    
    name: str = Field(..., description="Tool name to call")
    arguments: dict = Field(default_factory=dict, description="Tool arguments")


class ToolCallResponse(BaseModel):
    """Response from tool execution."""
    
    status: str = Field(..., description="Execution status: 'success' or 'error'")
    result: dict | str | int | float | bool | list | None = Field(
        None, description="Tool execution result"
    )
    error: str | None = Field(None, description="Error message if status is 'error'")


@router.get("/mcp/tools", response_model=ToolListResponse)
async def list_tools() -> ToolListResponse:
    """List all available MCP tools.
    
    Returns:
        List of registered tools with their schemas
    """
    try:
        mcp_server = get_mcp_server()
        tools = mcp_server.list_tools()
        
        tool_schemas = [
            ToolSchema(
                name=tool.name,
                description=tool.description,
                inputSchema=tool.inputSchema,
            )
            for tool in tools
        ]
        
        return ToolListResponse(tools=tool_schemas)
        
    except Exception as exc:
        log.error("Failed to list MCP tools: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list tools: {exc}"
        )


@router.post("/mcp/tools/{tool_name}/call", response_model=ToolCallResponse)
async def call_tool(tool_name: str, request: ToolCallRequest) -> ToolCallResponse:
    """Execute an MCP tool.
    
    Args:
        tool_name: Name of tool to execute
        request: Tool call request with arguments
        
    Returns:
        Tool execution result or error
    """
    try:
        mcp_server = get_mcp_server()
        
        # Validate tool exists
        if not mcp_server.has_tool(tool_name):
            raise HTTPException(
                status_code=404,
                detail=f"Tool '{tool_name}' not found"
            )
        
        # Call the tool
        response = await mcp_server.call_tool(
            name=tool_name,
            arguments=request.arguments,
        )
        
        # Convert to API response
        return ToolCallResponse(
            status=response.status,
            result=response.result,
            error=response.error,
        )
        
    except HTTPException:
        raise
    except Exception as exc:
        log.error("Failed to call MCP tool '%s': %s", tool_name, exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to call tool: {exc}"
        )


@router.get("/mcp/health")
async def mcp_health() -> dict:
    """Health check for MCP server.
    
    Returns:
        Health status and tool count
    """
    try:
        mcp_server = get_mcp_server()
        tool_count = mcp_server.get_tool_count()
        
        return {
            "status": "ok",
            "tool_count": tool_count,
            "initialized": True,
        }
        
    except Exception as exc:
        log.error("MCP health check failed: %s", exc, exc_info=True)
        return {
            "status": "error",
            "error": str(exc),
            "initialized": False,
        }