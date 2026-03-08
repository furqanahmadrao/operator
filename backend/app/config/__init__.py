from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve backend/.env relative to this file so it works regardless of what
# directory uvicorn is launched from (root vs backend/).
_ENV_FILE = Path(__file__).parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    nvidia_api_key: str = ""
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    # Primary model. deepseek-v3.2 is the latest available on the NVIDIA
    # catalogue (verified via /v1/models).  It handles both normal and
    # thinking turns; change this when a newer model is released.
    nvidia_model: str = "deepseek-ai/deepseek-v3.2"
    # Maximum tokens the model may generate per response.  Keeping this high
    # ensures artifact blocks (which can be long) are never truncated mid-tag.
    nvidia_max_tokens: int = 4096
    frontend_url: str = "http://localhost:3000"
    # Path relative to the backend working directory (where uvicorn is run)
    db_path: str = "data/agent.db"
    # Tavily web search — get a free key at https://app.tavily.com
    tavily_api_key: str = ""

    # Optional separate model ID for thinking turns.  Leave empty (recommended)
    # to reuse ``nvidia_model`` for both normal and thinking turns — a single
    # unified model handles both modes via different LLM parameters.
    nvidia_thinking_model: str | None = None
    # Token budget for thinking turns.  Give extra room for the reasoning block
    # plus the final answer.
    nvidia_thinking_max_tokens: int = 16000

    # Serper.dev Google Search API (2500 free queries/month) — used by deep research agent
    # Sign up at https://serper.dev to get a free API key
    serper_api_key: str = ""

    @field_validator("nvidia_base_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        return value.rstrip("/")

    @field_validator("nvidia_thinking_model", mode="before")
    @classmethod
    def default_thinking_model(cls, value: str | None) -> str | None:
        # Return None to trigger fallback; the actual default is applied at
        # model_post_init so we can reference the already-validated nvidia_model.
        return value or None

    def model_post_init(self, __context: object) -> None:
        # fallback to the primary model if no explicit thinking model is set.
        # this allows a single up‑to‑date DeepSeek variant to handle both modes.
        if not self.nvidia_thinking_model:
            object.__setattr__(self, "nvidia_thinking_model", self.nvidia_model)


settings = Settings()
