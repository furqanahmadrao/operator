from collections.abc import AsyncGenerator

from app.api.schemas import ChatMessage
from app.services.nvidia import nvidia_client


class ChatService:
    async def stream_reply(self, messages: list[ChatMessage]) -> AsyncGenerator[str, None]:
        async for token in nvidia_client.chat_completion(messages=messages, stream=True):
            yield token


chat_service = ChatService()
