"""Projects REST API."""
from fastapi import APIRouter, HTTPException

from app.api.schemas import (
    ArtifactSchema,
    ProjectCreate,
    ProjectPin,
    ProjectSchema,
    ProjectUpdate,
    SessionSchema,
)
from app.services import project_service

router = APIRouter()


@router.get("/projects", response_model=list[ProjectSchema])
async def list_projects():
    return await project_service.list_projects()


@router.post("/projects", response_model=ProjectSchema, status_code=201)
async def create_project(body: ProjectCreate):
    return await project_service.create_project(
        name=body.name,
        description=body.description,
        system_prompt=body.system_prompt,
    )


@router.get("/projects/{project_id}", response_model=ProjectSchema)
async def get_project(project_id: str):
    project = await project_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.patch("/projects/{project_id}", response_model=ProjectSchema)
async def update_project(project_id: str, body: ProjectUpdate):
    project = await project_service.update_project(
        project_id,
        name=body.name,
        description=body.description,
        system_prompt=body.system_prompt,
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(project_id: str):
    deleted = await project_service.delete_project(project_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found")


@router.get("/projects/{project_id}/sessions", response_model=list[SessionSchema])
async def list_project_sessions(project_id: str):
    project = await project_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return await project_service.list_project_sessions(project_id)


@router.patch("/projects/{project_id}/pin", response_model=ProjectSchema)
async def pin_project(project_id: str, body: ProjectPin):
    project = await project_service.pin_project(project_id, body.pinned)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("/projects/{project_id}/artifacts", response_model=list[ArtifactSchema])
async def list_project_artifacts(project_id: str):
    project = await project_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return await project_service.list_project_artifacts(project_id)
