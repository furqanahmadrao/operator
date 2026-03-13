"""
Model Context Protocol (MCP) Server

Provides standardized tool registration and invocation interface
following the MCP protocol specification.

This server exposes all agent tools (terminal, browser, file operations, etc.)
through a standardized MCP interface that can be consumed by LangGraph agents
and other MCP-compatible clients.
"""

import asyncio
import inspect
import json
import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Type, Union, get_type_hints

from pydantic import ValidationError as PydanticValidationError

from .schemas import validate_tool_parameters, TOOL_PARAM_SCHEMAS

log = logging.getLogger(__name__)


class ValidationError(Exception):
    """Custom validation error for tool parameter validation."""
    pass


@dataclass
class Tool:
    """MCP Tool definition."""
    
    name: str
    description: str
    inputSchema: Dict[str, Any]
    handler: Callable


@dataclass
class ToolCallResponse:
    """Response from tool execution."""
    
    status: str  # "success" or "error"
    result: Optional[Any] = None
    error: Optional[str] = None


class MCPServer:
    """MCP Server implementation for agent runtime tools."""
    
    def __init__(self):
        self._tools: Dict[str, Tool] = {}
        self._initialized = False
    
    def register_tool(
        self,
        name: str,
        description: str,
        input_schema: Dict[str, Any],
        handler: Callable,
    ) -> None:
        """Register a tool with the MCP server.
        
        Args:
            name: Unique tool name
            description: Human-readable tool description
            input_schema: JSON Schema for tool parameters
            handler: Async function that implements the tool logic
            
        Raises:
            ValueError: If tool with same name already registered
        """
        if name in self._tools:
            raise ValueError(f"Tool '{name}' is already registered")
        
        # Note: We don't check if handler is a coroutine function because
        # the @tool decorator from langchain wraps async functions in a way
        # that inspect.iscoroutinefunction() returns False.
        # The actual execution will handle async/await properly.
        
        self._tools[name] = Tool(
            name=name,
            description=description,
            inputSchema=input_schema,
            handler=handler,
        )
        
        log.info("Registered MCP tool: %s", name)
    
    def list_tools(self) -> List[Tool]:
        """List all registered tools.
        
        Returns:
            List of Tool objects
        """
        return list(self._tools.values())
    
    def has_tool(self, name: str) -> bool:
        """Check if a tool is registered.
        
        Args:
            name: Tool name
            
        Returns:
            True if tool is registered
        """
        return name in self._tools
    
    def get_tool_count(self) -> int:
        """Get number of registered tools.
        
        Returns:
            Number of tools
        """
        return len(self._tools)
    
    async def call_tool(self, name: str, arguments: Dict[str, Any], config: Optional[Dict[str, Any]] = None) -> ToolCallResponse:
        """Execute a tool with given arguments.
        
        Args:
            name: Tool name
            arguments: Tool parameters
            config: Optional configuration for tools that need session context
            
        Returns:
            ToolCallResponse with status and result/error
        """
        if name not in self._tools:
            return ToolCallResponse(
                status="error",
                error=f"Tool '{name}' not found",
            )
        
        tool = self._tools[name]
        
        try:
            # Validate arguments against schema
            self._validate_arguments(tool.inputSchema, arguments)
            
            # Execute tool handler
            handler = tool.handler
            
            # Prepare arguments for handler
            handler_args = arguments.copy()
            
            # Add config to arguments for tools that need it
            if config is not None:
                # Some tools expect config as a separate parameter
                # Check if handler signature includes config parameter
                try:
                    sig = inspect.signature(handler)
                    if 'config' in sig.parameters:
                        handler_args['config'] = config
                except (ValueError, TypeError):
                    # If we can't inspect signature, try adding config anyway
                    handler_args['config'] = config
            
            # Check handler type and call appropriately
            if hasattr(handler, 'arun'):
                # LangChain StructuredTool
                result = await handler.arun(handler_args)
            elif hasattr(handler, 'invoke'):
                # LangChain BaseTool
                result = await handler.invoke(handler_args)
            elif callable(handler):
                # Regular async function
                result = await handler(**handler_args)
            else:
                raise TypeError(f"Tool handler is not callable: {type(handler)}")
            
            return ToolCallResponse(
                status="success",
                result=result,
            )
            
        except ValidationError as exc:
            error_msg = f"Parameter validation failed: {exc}"
            log.warning("Tool call validation error: %s", error_msg)
            return ToolCallResponse(
                status="error",
                error=error_msg,
            )
        except Exception as exc:
            error_msg = f"Tool execution failed: {exc}"
            log.error("Tool execution error: %s", error_msg, exc_info=True)
            return ToolCallResponse(
                status="error",
                error=error_msg,
            )
    
    def _validate_arguments(self, schema: Dict[str, Any], arguments: Dict[str, Any]) -> None:
        """Validate arguments against JSON Schema.
        
        Args:
            schema: JSON Schema
            arguments: Arguments to validate
            
        Raises:
            ValidationError: If arguments don't match schema
        """
        # First use Pydantic schemas for validation if available
        tool_name = None
        for name, tool in self._tools.items():
            if tool.inputSchema == schema:
                tool_name = name
                break
        
        if tool_name and tool_name in TOOL_PARAM_SCHEMAS:
            try:
                # Use Pydantic schema for validation
                validate_tool_parameters(tool_name, arguments)
                return
            except PydanticValidationError as exc:
                raise ValidationError(f"Pydantic validation failed: {exc}")
        
        # Fall back to basic JSON Schema validation
        if "properties" not in schema:
            return
        
        properties = schema.get("properties", {})
        required = schema.get("required", [])
        
        # Check required fields
        for field in required:
            if field not in arguments:
                raise ValidationError(f"Missing required parameter: {field}")
        
        # Check for unknown fields
        for field in arguments:
            if field not in properties:
                raise ValidationError(f"Unknown parameter: {field}")
        
        # Basic type checking
        for field, value in arguments.items():
            if field in properties:
                prop_schema = properties[field]
                expected_type = prop_schema.get("type")
                
                if expected_type == "string" and not isinstance(value, str):
                    raise ValidationError(f"Parameter '{field}' must be string, got {type(value).__name__}")
                elif expected_type == "integer" and not isinstance(value, int):
                    raise ValidationError(f"Parameter '{field}' must be integer, got {type(value).__name__}")
                elif expected_type == "number" and not isinstance(value, (int, float)):
                    raise ValidationError(f"Parameter '{field}' must be number, got {type(value).__name__}")
                elif expected_type == "boolean" and not isinstance(value, bool):
                    raise ValidationError(f"Parameter '{field}' must be boolean, got {type(value).__name__}")
                elif expected_type == "array" and not isinstance(value, list):
                    raise ValidationError(f"Parameter '{field}' must be array, got {type(value).__name__}")
                elif expected_type == "object" and not isinstance(value, dict):
                    raise ValidationError(f"Parameter '{field}' must be object, got {type(value).__name__}")
    
    def initialize_default_tools(self) -> None:
        """Initialize default tools from the agent tools module.
        
        This method imports and registers all tools from backend/app/agent/tools.py
        as MCP tools.
        """
        if self._initialized:
            return
        
        try:
            # Import agent tools module
            from app.agent import tools as agent_tools
            
            # Register terminal tools
            self._register_terminal_tools(agent_tools)
            
            # Register browser tools
            self._register_browser_tools(agent_tools)
            
            # Register web tools
            self._register_web_tools(agent_tools)
            
            # Register artifact tools
            self._register_artifact_tools(agent_tools)
            
            # Register utility tools
            self._register_utility_tools(agent_tools)
            
            self._initialized = True
            log.info("Initialized MCP server with %d tools", self.get_tool_count())
            
        except ImportError as exc:
            log.error("Failed to import agent tools: %s", exc)
            raise
    
    def _register_terminal_tools(self, agent_tools) -> None:
        """Register terminal execution tools."""
        
        # execute_command tool
        self.register_tool(
            name="execute_command",
            description="Execute shell command in workspace",
            input_schema={
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Shell command to execute"
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Maximum execution time in seconds",
                        "default": 30
                    }
                },
                "required": ["command"]
            },
            handler=agent_tools.execute_command,
        )
        
        # change_directory tool
        self.register_tool(
            name="change_directory",
            description="Change working directory within workspace",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Target directory path"
                    }
                },
                "required": ["path"]
            },
            handler=agent_tools.change_directory,
        )
        
        # list_directory tool
        self.register_tool(
            name="list_directory",
            description="List files and directories at specified path",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path to list",
                        "default": "."
                    }
                }
            },
            handler=agent_tools.list_directory,
        )
        
        # read_file tool
        self.register_tool(
            name="read_file",
            description="Read contents of a file from workspace",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path to read"
                    }
                },
                "required": ["path"]
            },
            handler=agent_tools.read_file,
        )
        
        # write_file tool
        self.register_tool(
            name="write_file",
            description="Write content to a file in workspace",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path to write"
                    },
                    "content": {
                        "type": "string",
                        "description": "Content to write to the file"
                    }
                },
                "required": ["path", "content"]
            },
            handler=agent_tools.write_file,
        )
        
        # delete_file tool
        self.register_tool(
            name="delete_file",
            description="Delete a file from workspace",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path to delete"
                    }
                },
                "required": ["path"]
            },
            handler=agent_tools.delete_file,
        )
    
    def _register_browser_tools(self, agent_tools) -> None:
        """Register browser automation tools."""
        
        # navigate_to_url tool
        self.register_tool(
            name="navigate_to_url",
            description="Navigate browser to a URL and wait for page load",
            input_schema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Complete URL to navigate to"
                    },
                    "session_name": {
                        "type": "string",
                        "description": "Name of browser session",
                        "default": "default"
                    }
                },
                "required": ["url"]
            },
            handler=agent_tools.navigate_to_url,
        )
        
        # click_element tool
        self.register_tool(
            name="click_element",
            description="Click an element on current page using CSS selector",
            input_schema={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for element to click"
                    },
                    "session_name": {
                        "type": "string",
                        "description": "Name of browser session",
                        "default": "default"
                    }
                },
                "required": ["selector"]
            },
            handler=agent_tools.click_element,
        )
        
        # extract_page_content tool
        self.register_tool(
            name="extract_page_content",
            description="Extract text and HTML content from current page",
            input_schema={
                "type": "object",
                "properties": {
                    "session_name": {
                        "type": "string",
                        "description": "Name of browser session",
                        "default": "default"
                    }
                }
            },
            handler=agent_tools.extract_page_content,
        )
        
        # fill_form_field tool
        self.register_tool(
            name="fill_form_field",
            description="Fill a form input field with a value",
            input_schema={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for input field"
                    },
                    "value": {
                        "type": "string",
                        "description": "Text value to enter into field"
                    },
                    "session_name": {
                        "type": "string",
                        "description": "Name of browser session",
                        "default": "default"
                    }
                },
                "required": ["selector", "value"]
            },
            handler=agent_tools.fill_form_field,
        )
        
        # take_screenshot tool
        self.register_tool(
            name="take_screenshot",
            description="Capture screenshot of current page and save to workspace",
            input_schema={
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "Filename for screenshot"
                    },
                    "session_name": {
                        "type": "string",
                        "description": "Name of browser session",
                        "default": "default"
                    },
                    "full_page": {
                        "type": "boolean",
                        "description": "Capture full scrollable page",
                        "default": False
                    }
                },
                "required": ["filename"]
            },
            handler=agent_tools.take_screenshot,
        )
        
        # execute_javascript tool
        self.register_tool(
            name="execute_javascript",
            description="Execute JavaScript code in context of current page",
            input_schema={
                "type": "object",
                "properties": {
                    "script": {
                        "type": "string",
                        "description": "JavaScript code to execute"
                    },
                    "session_name": {
                        "type": "string",
                        "description": "Name of browser session",
                        "default": "default"
                    }
                },
                "required": ["script"]
            },
            handler=agent_tools.execute_javascript,
        )
    
    def _register_web_tools(self, agent_tools) -> None:
        """Register web search and fetch tools."""
        
        # web_search tool
        self.register_tool(
            name="web_search",
            description="Search the web for current, real-time information",
            input_schema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query"
                    }
                },
                "required": ["query"]
            },
            handler=agent_tools.web_search,
        )
        
        # web_fetch tool
        self.register_tool(
            name="web_fetch",
            description="Fetch and extract content from specific web page URL",
            input_schema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Complete URL to fetch"
                    }
                },
                "required": ["url"]
            },
            handler=agent_tools.web_fetch,
        )
    
    def _register_artifact_tools(self, agent_tools) -> None:
        """Register artifact creation and management tools."""
        
        # create_artifact tool
        self.register_tool(
            name="create_artifact",
            description="Create standalone artifact document and save to user's library",
            input_schema={
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "2-6 word title, title-cased and descriptive"
                    },
                    "artifact_type": {
                        "type": "string",
                        "description": "Type of artifact: 'markdown' or 'html'",
                        "enum": ["markdown", "html"]
                    },
                    "content": {
                        "type": "string",
                        "description": "Full content of artifact"
                    }
                },
                "required": ["title", "artifact_type", "content"]
            },
            handler=agent_tools.create_artifact,
        )
        
        # list_session_artifacts tool
        self.register_tool(
            name="list_session_artifacts",
            description="List all artifacts created in current session",
            input_schema={
                "type": "object",
                "properties": {}
            },
            handler=agent_tools.list_session_artifacts,
        )
        
        # update_artifact tool
        self.register_tool(
            name="update_artifact",
            description="Update existing artifact with revised content",
            input_schema={
                "type": "object",
                "properties": {
                    "artifact_id": {
                        "type": "string",
                        "description": "ID of artifact to update"
                    },
                    "content": {
                        "type": "string",
                        "description": "Complete replacement content"
                    },
                    "title": {
                        "type": "string",
                        "description": "Optional new title"
                    }
                },
                "required": ["artifact_id", "content"]
            },
            handler=agent_tools.update_artifact,
        )
    
    def _register_utility_tools(self, agent_tools) -> None:
        """Register utility tools."""
        
        # get_current_datetime tool
        self.register_tool(
            name="get_current_datetime",
            description="Get current date and time in UTC",
            input_schema={
                "type": "object",
                "properties": {}
            },
            handler=agent_tools.get_current_datetime,
        )


# Global MCP server instance
_mcp_server_instance: Optional[MCPServer] = None


def get_mcp_server() -> MCPServer:
    """Get or create the global MCP server instance.
    
    Returns:
        MCPServer instance
    """
    global _mcp_server_instance
    
    if _mcp_server_instance is None:
        _mcp_server_instance = MCPServer()
        _mcp_server_instance.initialize_default_tools()
    
    return _mcp_server_instance


def reset_mcp_server() -> None:
    """Reset the global MCP server instance (for testing)."""
    global _mcp_server_instance
    _mcp_server_instance = None