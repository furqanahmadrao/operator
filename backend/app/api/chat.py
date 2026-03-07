import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.api.schemas import ChatRequest
from app.services.chat_service import chat_service


router = APIRouter()


@router.post("/chat")
async def chat(request: ChatRequest):
    async def event_generator():
        try:
            async for token in chat_service.stream_reply(request.messages):
                payload = json.dumps({"type": "token", "content": token})
                yield f"data: {payload}\n\n"
        except Exception as error:  # noqa: BLE001
            payload = json.dumps({"type": "error", "message": str(error)})
            yield f"data: {payload}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    if not request.messages:
        raise HTTPException(status_code=400, detail="At least one message is required.")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
