import json
import logging
from pathlib import Path

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve backend/.env relative to this file so it works regardless of what
# directory uvicorn is launched from (root vs backend/).
_ENV_FILE = Path(__file__).parent.parent.parent / ".env"

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    # ── LLM Provider ──────────────────────────────────────────────────────────
    # Which LiteLLM provider adapter to use.  This value is passed directly as
    # ``custom_llm_provider`` to LiteLLM/ChatLiteLLM and must be a valid LiteLLM
    # provider string (e.g. "nvidia_nim", "openai", "anthropic", "groq").
    llm_provider: str = "nvidia_nim"

    # ── Chat model (primary / non-thinking turns) ─────────────────────────────
    # API key for the configured provider.
    chat_api_key: str = ""
    # Base URL override — required for self-hosted or NIM endpoints;
    # leave empty for default SaaS providers (OpenAI, Anthropic, etc.).
    chat_base_url: str = "https://integrate.api.nvidia.com/v1"
    # Model identifier as understood by LiteLLM (no provider prefix needed here;
    # the prefix is handled via ``llm_provider`` / ``custom_llm_provider``).
    chat_model: str = "deepseek-ai/deepseek-v3.2"
    # Maximum tokens the model may generate per response.  Keeping this high
    # ensures artifact blocks (which can be long) are never truncated mid-tag.
    chat_max_tokens: int = 4096

    # ── Thinking / reasoning model (optional) ────────────────────────────────
    # Set to a reasoning-capable model ID (e.g. deepseek-r1) to use a
    # dedicated model for thinking turns.  When left empty the primary
    # ``chat_model`` is used for both normal and thinking turns.
    thinking_model: str | None = None
    # Token budget for thinking turns — extra room for the reasoning block.
    thinking_max_tokens: int = 16000

    # ── App settings ──────────────────────────────────────────────────────────
    frontend_url: str = "http://localhost:3000"
    # Path relative to the backend working directory (where uvicorn is run).
    db_path: str = "data/agent.db"

    # ── Web search keys ───────────────────────────────────────────────────────
    # Tavily — standard agent web search; get a free key at https://app.tavily.com
    tavily_api_key: str = ""
    # Serper.dev Google Search — deep research agent (2 500 free queries/month).
    # Sign up at https://serper.dev
    serper_api_key: str = ""

    # ── Workspace Configuration ───────────────────────────────────────────────
    # Root directory for agent workspace (sandboxed file operations)
    workspace_root: str = "/workspace"
    # Maximum workspace size in GB
    max_workspace_size_gb: float = 10.0

    # ── Resource Limits ───────────────────────────────────────────────────────
    # Memory limit in GB (for monitoring, not enforcement)
    memory_limit_gb: float = 2.0
    # CPU limit in cores (for monitoring, not enforcement)
    cpu_limit_cores: float = 2.0
    # Maximum concurrent terminal commands
    max_concurrent_commands: int = 3
    # Maximum concurrent browser sessions
    max_concurrent_browser_sessions: int = 5

    # ── Timeout Configuration ─────────────────────────────────────────────────
    # Command execution timeout in seconds
    command_timeout_seconds: int = 30
    # Browser operation timeout in seconds
    browser_timeout_seconds: int = 30

    # ── Feature Flags ─────────────────────────────────────────────────────────
    # Enable browser automation capabilities
    enable_browser_automation: bool = True
    # Enable terminal access and command execution
    enable_terminal_access: bool = True
    # Enable deep agent with planning and reflection
    enable_deep_agent: bool = True

    # ── Logging Configuration ─────────────────────────────────────────────────
    # Log level: DEBUG, INFO, WARNING, ERROR
    log_level: str = "INFO"
    # Log file path (relative to workspace_root if not absolute)
    log_file: str = ".logs/agent.log"

    @field_validator("chat_base_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        return value.rstrip("/")

    @field_validator("thinking_model", mode="before")
    @classmethod
    def coerce_empty_thinking_model(cls, value: str | None) -> str | None:
        # Treat empty string as "not set" so model_post_init applies the fallback.
        return value or None

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, value: str) -> str:
        """Validate log level is one of the standard Python logging levels."""
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        value_upper = value.upper()
        if value_upper not in valid_levels:
            logger.warning(
                f"Invalid log level '{value}', must be one of {valid_levels}. "
                f"Using default 'INFO'."
            )
            return "INFO"
        return value_upper

    @field_validator("max_workspace_size_gb", "memory_limit_gb", "cpu_limit_cores")
    @classmethod
    def validate_positive_float(cls, value: float, info) -> float:
        """Validate that numeric limits are positive."""
        if value <= 0:
            logger.warning(
                f"Invalid {info.field_name} '{value}', must be positive. "
                f"Using default value."
            )
            # Return sensible defaults
            defaults = {
                "max_workspace_size_gb": 10.0,
                "memory_limit_gb": 2.0,
                "cpu_limit_cores": 2.0,
            }
            return defaults.get(info.field_name, 1.0)
        return value

    @field_validator(
        "max_concurrent_commands",
        "max_concurrent_browser_sessions",
        "command_timeout_seconds",
        "browser_timeout_seconds",
    )
    @classmethod
    def validate_positive_int(cls, value: int, info) -> int:
        """Validate that integer limits are positive."""
        if value <= 0:
            logger.warning(
                f"Invalid {info.field_name} '{value}', must be positive. "
                f"Using default value."
            )
            # Return sensible defaults
            defaults = {
                "max_concurrent_commands": 3,
                "max_concurrent_browser_sessions": 5,
                "command_timeout_seconds": 30,
                "browser_timeout_seconds": 30,
            }
            return defaults.get(info.field_name, 1)
        return value

    @model_validator(mode="after")
    def validate_workspace_root(self) -> "Settings":
        """Validate workspace root exists or can be created."""
        workspace_path = Path(self.workspace_root)
        try:
            workspace_path.mkdir(parents=True, exist_ok=True)
            logger.info(f"Workspace root validated: {self.workspace_root}")
        except Exception as e:
            logger.error(
                f"Failed to create workspace root '{self.workspace_root}': {e}. "
                f"Using fallback '/tmp/workspace'."
            )
            object.__setattr__(self, "workspace_root", "/tmp/workspace")
            Path("/tmp/workspace").mkdir(parents=True, exist_ok=True)
        return self

    def model_post_init(self, __context: object) -> None:
        # Fall back to the primary chat model when no dedicated thinking model
        # is configured, so a single capable model handles both turn types.
        if not self.thinking_model:
            object.__setattr__(self, "thinking_model", self.chat_model)

        # Load configuration from workspace config file if it exists
        self._load_workspace_config()

    def _load_workspace_config(self) -> None:
        """Load configuration from workspace config file if it exists."""
        config_path = Path(self.workspace_root) / ".agent_config.json"
        if not config_path.exists():
            logger.debug(f"No workspace config file found at {config_path}")
            return

        try:
            with open(config_path, "r") as f:
                workspace_config = json.load(f)

            logger.info(f"Loading workspace configuration from {config_path}")

            # Override settings with workspace config values
            # Only override if the key exists in workspace config
            for key, value in workspace_config.items():
                if hasattr(self, key):
                    # Environment variables take precedence over config file
                    # Check if the value is still the default
                    current_value = getattr(self, key)
                    # Simple heuristic: if it's not the default, it was likely set by env var
                    # For now, we'll always prefer workspace config over defaults
                    # but env vars are already loaded by pydantic-settings
                    logger.debug(
                        f"Workspace config: {key}={value} (current: {current_value})"
                    )
                    # Note: We don't override here because env vars have already been
                    # loaded by pydantic-settings and should take precedence
                else:
                    logger.warning(
                        f"Unknown configuration key in workspace config: {key}"
                    )

        except json.JSONDecodeError as e:
            logger.error(
                f"Failed to parse workspace config file {config_path}: {e}. "
                f"Using environment variables and defaults."
            )
        except Exception as e:
            logger.error(
                f"Failed to load workspace config file {config_path}: {e}. "
                f"Using environment variables and defaults."
            )

    def get_log_file_path(self) -> Path:
        """Get the absolute path to the log file."""
        log_path = Path(self.log_file)
        if not log_path.is_absolute():
            log_path = Path(self.workspace_root) / log_path
        # Ensure log directory exists
        log_path.parent.mkdir(parents=True, exist_ok=True)
        return log_path

    def validate_on_startup(self) -> list[str]:
        """
        Validate configuration on startup and return list of warnings.

        Returns:
            List of warning messages (empty if all valid)
        """
        warnings = []

        # Validate workspace root is accessible
        workspace_path = Path(self.workspace_root)
        if not workspace_path.exists():
            warnings.append(
                f"Workspace root does not exist: {self.workspace_root}"
            )
        elif not workspace_path.is_dir():
            warnings.append(
                f"Workspace root is not a directory: {self.workspace_root}"
            )

        # Validate feature flags consistency
        if self.enable_browser_automation and self.max_concurrent_browser_sessions <= 0:
            warnings.append(
                "Browser automation is enabled but max_concurrent_browser_sessions <= 0"
            )

        if self.enable_terminal_access and self.max_concurrent_commands <= 0:
            warnings.append(
                "Terminal access is enabled but max_concurrent_commands <= 0"
            )

        # Validate timeouts are reasonable
        if self.command_timeout_seconds < 1:
            warnings.append(
                f"Command timeout is very low: {self.command_timeout_seconds}s"
            )

        if self.browser_timeout_seconds < 1:
            warnings.append(
                f"Browser timeout is very low: {self.browser_timeout_seconds}s"
            )

        # Validate resource limits are reasonable
        if self.memory_limit_gb < 0.5:
            warnings.append(
                f"Memory limit is very low: {self.memory_limit_gb}GB"
            )

        if self.cpu_limit_cores < 0.5:
            warnings.append(
                f"CPU limit is very low: {self.cpu_limit_cores} cores"
            )

        if self.max_workspace_size_gb < 1:
            warnings.append(
                f"Workspace size limit is very low: {self.max_workspace_size_gb}GB"
            )

        return warnings


settings = Settings()
