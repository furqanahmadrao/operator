from fastapi import APIRouter, HTTPException

from app.api.schemas import (
    SessionCreate,
    SessionPin,
    SessionProjectMove,
    SessionRename,
    SessionSchema,
    SessionWithMessagesSchema,
)
from app.services import session_service

router = APIRouter()


@router.get("/sessions", response_model=list[SessionSchema])
async def list_sessions():
    return await session_service.list_sessions()


@router.post("/sessions", response_model=SessionSchema, status_code=201)
async def create_session(body: SessionCreate | None = None):
    title = (body.title if body else None) or "New Chat"
    project_id = body.project_id if body else None
    return await session_service.create_session(title, project_id=project_id)


@router.get("/sessions/{session_id}", response_model=SessionWithMessagesSchema)
async def get_session(session_id: str):
    session = await session_service.get_session_with_messages(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.patch("/sessions/{session_id}", response_model=SessionSchema)
async def rename_session(session_id: str, body: SessionRename):
    session = await session_service.rename_session(session_id, body.title)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.patch("/sessions/{session_id}/pin", response_model=SessionSchema)
async def pin_session(session_id: str, body: SessionPin):
    session = await session_service.pin_session(session_id, body.pinned)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.patch("/sessions/{session_id}/project", response_model=SessionSchema)
async def move_session_to_project(session_id: str, body: SessionProjectMove):
    session = await session_service.set_session_project(session_id, body.project_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str):
    deleted = await session_service.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
