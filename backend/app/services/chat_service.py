from collections.abc import AsyncGenerator

from app.api.schemas import ChatMessage
from app.services.llm import stream_chat_completion


class ChatService:
    async def stream_reply(self, messages: list[ChatMessage]) -> AsyncGenerator[str, None]:
        # Convert Pydantic models into plain dicts following OpenAI-style chat format
        msgs = [m.model_dump() for m in messages]
        async for token in stream_chat_completion(messages=msgs, model=None):
            yield token


chat_service = ChatService()
