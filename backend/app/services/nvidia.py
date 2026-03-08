import json
from collections.abc import AsyncGenerator

import httpx

from app.api.schemas import ChatMessage
from app.config import settings


class NVIDIAClient:
    def __init__(self) -> None:
        self.base_url = settings.nvidia_base_url
        self.model = settings.nvidia_model
        self.api_key = settings.nvidia_api_key

    async def chat_completion(
        self,
        messages: list[ChatMessage],
        stream: bool = True,
    ) -> AsyncGenerator[str, None]:
        if not self.api_key:
            raise RuntimeError("Missing NVIDIA_API_KEY. Add it to backend/.env.")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": [message.model_dump() for message in messages],
            "stream": stream,
            "max_tokens": settings.nvidia_max_tokens,
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue

                    data = line[6:].strip()
                    if data == "[DONE]":
                        break

                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue

                    choices = chunk.get("choices", [])
                    if not choices:
                        continue

                    delta = choices[0].get("delta", {})
                    content = delta.get("content")
                    if isinstance(content, str) and content:
                        yield content

    async def complete_text(
        self,
        messages: list[ChatMessage],
        max_tokens: int = 80,
    ) -> str:
        """Non-streaming chat completion. Returns the full content string.

        Used for fast intent classification calls where streaming is not needed.
        Timeout is tighter (15 s) than the streaming path.
        """
        if not self.api_key:
            raise RuntimeError("Missing NVIDIA_API_KEY. Add it to backend/.env.")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": [message.model_dump() for message in messages],
            "stream": False,
            "max_tokens": max_tokens,
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        content = data["choices"][0]["message"]["content"]
        return content if isinstance(content, str) else ""

    async def list_models(self) -> list[dict]:
        """Return a list of available models from the NVIDIA catalog.

        This is a simple wrapper around GET /models and can be used by
tools or setup scripts to discover IDs and metadata (such as whether a
model advertises reasoning/thinking support).
        """
        if not self.api_key:
            raise RuntimeError("Missing NVIDIA_API_KEY. Add it to backend/.env.")
        headers = {"Authorization": f"Bearer {self.api_key}"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"{self.base_url}/models", headers=headers)
            response.raise_for_status()
            data = response.json()
        # Expecting a dict with a "data" field or a list; return raw if uncertain
        if isinstance(data, dict) and "data" in data:
            return data["data"]
        elif isinstance(data, list):
            return data
        else:
            return []


nvidia_client = NVIDIAClient()
