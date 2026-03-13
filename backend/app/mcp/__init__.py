"""
Model Context Protocol (MCP) Server

Provides standardized tool registration and invocation interface
following the MCP protocol specification.
"""

from .server import MCPServer, get_mcp_server

__all__ = ["MCPServer", "get_mcp_server"]
