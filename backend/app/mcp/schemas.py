"""
Pydantic schemas for MCP tool parameters.

This module defines Pydantic models for all tool parameters to ensure
type-safe tool invocation and validation.
"""

from typing import Optional
from pydantic import BaseModel, Field, field_validator, ConfigDict
from typing import Literal, List, Dict, Any, Optional as Opt


class ToolParamsBase(BaseModel):
    """Base class for all tool parameter schemas."""
    model_config = ConfigDict(extra='forbid')


class TerminalExecuteCommandParams(ToolParamsBase):
    """Parameters for the execute_command tool."""
    command: str = Field(..., description="Shell command to execute")
    timeout: int = Field(default=30, description="Maximum execution time in seconds")
    
    @field_validator('timeout')
    @classmethod
    def validate_timeout(cls, v):
        if v <= 0:
            raise ValueError("Timeout must be positive")
        if v > 300:  # 5 minutes
            raise ValueError("Timeout cannot exceed 300 seconds")
        return v


class TerminalChangeDirectoryParams(ToolParamsBase):
    """Parameters for the change_directory tool."""
    path: str = Field(..., description="Target directory path")


class TerminalListDirectoryParams(ToolParamsBase):
    """Parameters for the list_directory tool."""
    path: str = Field(default=".", description="Directory path to list")


class FileReadParams(ToolParamsBase):
    """Parameters for the read_file tool."""
    path: str = Field(..., description="File path to read")


class FileWriteParams(ToolParamsBase):
    """Parameters for the write_file tool."""
    path: str = Field(..., description="File path to write")
    content: str = Field(..., description="Content to write to the file")


class FileDeleteParams(ToolParamsBase):
    """Parameters for the delete_file tool."""
    path: str = Field(..., description="File path to delete")


class BrowserNavigateParams(ToolParamsBase):
    """Parameters for the navigate_to_url tool."""
    url: str = Field(..., description="Complete URL to navigate to")
    session_name: str = Field(default="default", description="Browser session name")


class BrowserClickParams(ToolParamsBase):
    """Parameters for the click_element tool."""
    selector: str = Field(..., description="CSS selector for the element to click")
    session_name: str = Field(default="default", description="Browser session name")


class BrowserExtractContentParams(ToolParamsBase):
    """Parameters for the extract_page_content tool."""
    session_name: str = Field(default="default", description="Browser session name")


class BrowserFillFormParams(ToolParamsBase):
    """Parameters for the fill_form_field tool."""
    selector: str = Field(..., description="CSS selector for the form field")
    value: str = Field(..., description="Value to fill in the field")
    session_name: str = Field(default="default", description="Browser session name")


class BrowserScreenshotParams(ToolParamsBase):
    """Parameters for the take_screenshot tool."""
    filename: str = Field(..., description="Filename for the screenshot")
    session_name: str = Field(default="default", description="Browser session name")
    full_page: bool = Field(default=False, description="Capture full scrollable page")


class BrowserExecuteJSParams(ToolParamsBase):
    """Parameters for the execute_javascript tool."""
    script: str = Field(..., description="JavaScript code to execute")
    session_name: str = Field(default="default", description="Browser session name")


class WebSearchParams(ToolParamsBase):
    """Parameters for the web_search tool."""
    query: str = Field(..., description="Search query")


class WebFetchParams(ToolParamsBase):
    """Parameters for the web_fetch tool."""
    url: str = Field(..., description="URL to fetch content from")


class ArtifactCreateParams(ToolParamsBase):
    """Parameters for the create_artifact tool."""
    title: str = Field(..., min_length=1, max_length=200, description="Artifact title")
    artifact_type: str = Field(..., pattern="^(markdown|html)$", description="Artifact type")
    content: str = Field(..., description="Artifact content")
    config: Optional[dict] = Field(default=None, description="Configuration for artifact creation")
    
    @field_validator('artifact_type')
    @classmethod
    def validate_artifact_type(cls, v):
        if v not in ["markdown", "html"]:
            raise ValueError("artifact_type must be 'markdown' or 'html'")
        return v


class ArtifactUpdateParams(ToolParamsBase):
    """Parameters for the update_artifact tool."""
    artifact_id: str = Field(..., description="Artifact ID to update")
    content: str = Field(..., description="New content for the artifact")
    title: Optional[str] = Field(None, description="New title (optional)")


class UtilityDatetimeParams(ToolParamsBase):
    """Parameters for the get_current_datetime tool."""
    # No parameters for this tool
    pass


class ArtifactListParams(ToolParamsBase):
    """Parameters for the list_session_artifacts tool."""
    # No parameters for this tool
    pass


# Tool parameter mapping for validation
TOOL_PARAM_SCHEMAS = {
    "execute_command": TerminalExecuteCommandParams,
    "change_directory": TerminalChangeDirectoryParams,
    "list_directory": TerminalListDirectoryParams,
    "read_file": FileReadParams,
    "write_file": FileWriteParams,
    "delete_file": FileDeleteParams,
    "navigate_to_url": BrowserNavigateParams,
    "click_element": BrowserClickParams,
    "extract_page_content": BrowserExtractContentParams,
    "fill_form_field": BrowserFillFormParams,
    "take_screenshot": BrowserScreenshotParams,
    "execute_javascript": BrowserExecuteJSParams,
    "web_search": WebSearchParams,
    "web_fetch": WebFetchParams,
    "create_artifact": ArtifactCreateParams,
    "update_artifact": ArtifactUpdateParams,
    "list_session_artifacts": ArtifactListParams,
    "get_current_datetime": UtilityDatetimeParams,
}


def validate_tool_parameters(tool_name: str, parameters: dict) -> dict:
    """
    Validate tool parameters against their schemas.
    
    Args:
        tool_name: Name of the tool
        parameters: Dictionary of parameters to validate
        
    Returns:
        Validated and cleaned parameters
        
    Raises:
        ValidationError: If parameters don't match the schema
    """
    if tool_name not in TOOL_PARAM_SCHEMAS:
        raise ValueError(f"Unknown tool: {tool_name}")
    
    schema_class = TOOL_PARAM_SCHEMAS[tool_name]
    
    # Handle config parameter specially - it's not part of the Pydantic model
    # but passed separately to the tool
    config_param = parameters.pop('config', None)
    validated = schema_class(**parameters).model_dump()
    
    # Add config back if it was provided
    if config_param is not None:
        validated['config'] = config_param
    
    return validated