from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.api.schemas import ArtifactSchema, ArtifactUpdate, ArtifactWithSessionSchema
from app.services import artifact_service

router = APIRouter()


@router.get("/artifacts", response_model=list[ArtifactWithSessionSchema])
async def list_all_artifacts():
    """Return all artifacts across all sessions (Library view)."""
    return await artifact_service.list_all_artifacts()


@router.get("/sessions/{session_id}/artifacts", response_model=list[ArtifactSchema])
async def list_artifacts(session_id: str):
    return await artifact_service.list_artifacts(session_id)


@router.get("/artifacts/{artifact_id}", response_model=ArtifactSchema)
async def get_artifact(artifact_id: str):
    artifact = await artifact_service.get_artifact(artifact_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return artifact


@router.patch("/artifacts/{artifact_id}", response_model=ArtifactSchema)
async def update_artifact(artifact_id: str, body: ArtifactUpdate):
    artifact = await artifact_service.update_artifact(
        artifact_id, title=body.title, content=body.content
    )
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return artifact


@router.delete("/artifacts/{artifact_id}", status_code=204)
async def delete_artifact(artifact_id: str):
    deleted = await artifact_service.delete_artifact(artifact_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Artifact not found")


@router.get("/artifacts/{artifact_id}/download")
async def download_artifact(artifact_id: str):
    artifact = await artifact_service.get_artifact(artifact_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")

    safe_title = artifact["title"].replace("/", "-").replace("\\", "-")
    filename = f"{safe_title}.md"

    return Response(
        content=artifact["content"],
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
