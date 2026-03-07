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
    nvidia_model: str = "deepseek-ai/deepseek-v3.1-terminus"
    # Maximum tokens the model may generate per response.  Keeping this high
    # ensures artifact blocks (which can be long) are never truncated mid-tag.
    nvidia_max_tokens: int = 4096
    frontend_url: str = "http://localhost:3000"
    # Path relative to the backend working directory (where uvicorn is run)
    db_path: str = "data/agent.db"
    # Tavily web search — get a free key at https://app.tavily.com
    tavily_api_key: str = ""

    @field_validator("nvidia_base_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        return value.rstrip("/")


settings = Settings()
