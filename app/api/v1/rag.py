import logging
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from app.api.v1.auth import get_current_user
from app.models.user import User
from app.services import rag_service

logger = logging.getLogger(__name__)
router = APIRouter()


class RagQueryRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "query": "Como configurar um DSP Q-SYS para sala de reunião?",
                    "top_k": 5,
                    "model": "mistral",
                }
            ]
        }
    )

    query: str
    top_k: int = 5
    model: str | None = None


@router.post("/query")
async def rag_query(
    request: RagQueryRequest,
    current_user: User = Depends(get_current_user),
) -> Any:
    """Stub de endpoint RAG. Retorna not_implemented até a integração com vetor DB."""
    return await rag_service.query(request.model_dump())
