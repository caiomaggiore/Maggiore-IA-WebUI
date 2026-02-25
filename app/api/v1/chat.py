import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from app.api.v1.auth import get_current_user
from app.core.config import AVAILABLE_MODELS
from app.models.user import User
from app.services import chat_service

logger = logging.getLogger(__name__)
router = APIRouter()


class ModelInfo(BaseModel):
    """Modelo disponível para chat."""

    id: str
    name: str
    active: bool


@router.get("/models", response_model=list[ModelInfo])
async def list_models(current_user: User = Depends(get_current_user)):
    """Lista os modelos disponíveis. O campo active indica se o modelo está pronto para uso."""
    return AVAILABLE_MODELS


class Message(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={"examples": [{"role": "user", "content": "Olá"}]}
    )

    role: str
    content: str


class ChatOptions(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={"examples": [{"temperature": 0.2, "num_predict": 200}]}
    )

    temperature: float | None = None
    num_predict: int | None = None


class ChatRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "model": "mistral",
                    "messages": [{"role": "user", "content": "Olá"}],
                    "stream": False,
                    "options": {"temperature": 0.2, "num_predict": 200},
                }
            ]
        }
    )

    model: str
    messages: list[Message]
    stream: bool = False
    options: ChatOptions | None = None


class ChatMessageResponse(BaseModel):
    """Mensagem da resposta do chat (role + content)."""

    role: str
    content: str


class ChatUsage(BaseModel):
    """Métricas de uso da geração (dados do Ollama)."""

    total_duration: int | None = None
    load_duration: int | None = None
    prompt_eval_count: int | None = None
    prompt_eval_duration: int | None = None
    eval_count: int | None = None
    eval_duration: int | None = None


class ChatResponse(BaseModel):
    """Resposta unificada do endpoint /v1/chat (non-streaming)."""

    model: str
    created_at: str
    message: ChatMessageResponse
    usage: ChatUsage


class GenerateRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "model": "mistral",
                    "prompt": "Olá",
                    "stream": False,
                    "options": {"temperature": 0.2, "num_predict": 200},
                }
            ]
        }
    )

    model: str
    prompt: str
    stream: bool = False
    options: ChatOptions | None = None


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
):
    """Proxy para /api/chat do Ollama. Suporta streaming via stream=true."""
    payload = request.model_dump(exclude_none=True)

    if request.stream:
        return StreamingResponse(
            chat_service.handle_chat_stream(payload),
            media_type="application/x-ndjson",
        )

    try:
        return await chat_service.handle_chat(payload)
    except Exception as exc:
        logger.error("Erro ao chamar Ollama /api/chat: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Ollama indisponível: {exc}",
        )


@router.post("/generate")
async def generate(
    request: GenerateRequest,
    current_user: User = Depends(get_current_user),
) -> Any:
    """Proxy para /api/generate do Ollama. Suporta streaming via stream=true."""
    payload = request.model_dump(exclude_none=True)

    if request.stream:
        return StreamingResponse(
            chat_service.handle_generate_stream(payload),
            media_type="application/x-ndjson",
        )

    try:
        return await chat_service.handle_generate(payload)
    except Exception as exc:
        logger.error("Erro ao chamar Ollama /api/generate: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Ollama indisponível: {exc}",
        )
