import logging
from typing import Annotated, Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.core.config import AVAILABLE_MODELS
from app.core.database import SessionLocal, get_db
from app.crud.chat import (
    add_chat_message,
    create_chat_session,
    get_session_with_messages,
    list_sessions_for_user,
)
from app.models.chat_message import ChatMessageSchema
from app.models.chat_session import ChatSessionSchema
from app.models.user import UserSchema as User
from app.services import chat_service

logger = logging.getLogger(__name__)
router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]


# ── Schemas ───────────────────────────────────────────────────────────────────

class ModelInfo(BaseModel):
    id: str
    name: str
    active: bool


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
                    "session_id": None,
                    "options": {"temperature": 0.2, "num_predict": 200},
                }
            ]
        }
    )
    model: str
    messages: list[Message]
    stream: bool = False
    session_id: int | None = None
    options: ChatOptions | None = None


class ChatMessageResponse(BaseModel):
    role: str
    content: str


class ChatUsage(BaseModel):
    total_duration: int | None = None
    load_duration: int | None = None
    prompt_eval_count: int | None = None
    prompt_eval_duration: int | None = None
    eval_count: int | None = None
    eval_duration: int | None = None


class ChatResponse(BaseModel):
    """Resposta do endpoint /v1/chat (non-streaming) com session_id incluído."""
    session_id: int
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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _session_title(messages: list[Message]) -> str:
    """Gera o título da sessão a partir das primeiras 80 letras da última msg do usuário."""
    user_msgs = [m.content for m in messages if m.role == "user"]
    last = user_msgs[-1] if user_msgs else "Nova conversa"
    return last[:80]


def _resolve_session(db: Session, request: ChatRequest, user_id: int) -> int:
    """Valida ou cria a sessão; retorna o session_id."""
    if request.session_id is not None:
        session = get_session_with_messages(db, request.session_id, user_id)
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sessão não encontrada ou não pertence ao usuário",
            )
        return session.id

    title = _session_title(request.messages)
    new_session = create_chat_session(db, user_id=user_id, title=title)
    return new_session.id


async def _stream_with_persistence(
    payload: dict[str, Any],
    session_id: int,
    model: str,
    temperature: float | None,
) -> AsyncIterator[bytes]:
    """Wrapper do stream que persiste a resposta completa da IA após o último token.

    Usa SessionLocal() diretamente porque o Depends(get_db) já estará fechado
    quando o generator terminar de ser consumido pelo cliente.
    """
    full_content: list[str] = []

    async for chunk in chat_service.handle_chat_stream(payload):
        # chunk é b'{"token":"..."}\n' — extrai o texto para acumular
        try:
            import json
            obj = json.loads(chunk.decode("utf-8").strip())
            if obj.get("token"):
                full_content.append(obj["token"])
        except Exception:
            pass
        yield chunk

    # Stream concluído — persiste a resposta da IA
    content = "".join(full_content)
    if content:
        db = SessionLocal()
        try:
            add_chat_message(
                db,
                session_id=session_id,
                role="assistant",
                content=content,
                model=model,
                temperature=temperature,
            )
        except Exception as exc:
            logger.error("Erro ao persistir mensagem de streaming: %s", exc)
        finally:
            db.close()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/models", response_model=list[ModelInfo])
async def list_models(current_user: User = Depends(get_current_user)):
    """Lista os modelos disponíveis."""
    return AVAILABLE_MODELS


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Proxy para /api/chat do Ollama com persistência de histórico.

    - Se session_id vier preenchido, valida que pertence ao usuário.
    - Se não vier, cria uma nova sessão.
    - Salva mensagem do usuário antes de chamar a IA.
    - No modo não-streaming, salva resposta da IA e inclui session_id no retorno.
    - No modo streaming, persiste a resposta completa após o último token.
    """
    temperature = request.options.temperature if request.options else None
    session_id = _resolve_session(db, request, current_user.id)

    # Persiste a última mensagem do usuário
    last_user_msg = next(
        (m.content for m in reversed(request.messages) if m.role == "user"), ""
    )
    if last_user_msg:
        add_chat_message(
            db,
            session_id=session_id,
            role="user",
            content=last_user_msg,
            model=request.model,
            temperature=temperature,
        )

    payload = request.model_dump(exclude_none=True, exclude={"session_id"})

    # ── Streaming ──
    if request.stream:
        return StreamingResponse(
            _stream_with_persistence(
                payload=payload,
                session_id=session_id,
                model=request.model,
                temperature=temperature,
            ),
            media_type="application/x-ndjson",
            headers={"X-Session-Id": str(session_id)},
        )

    # ── Non-streaming ──
    try:
        result = await chat_service.handle_chat(payload)
    except Exception as exc:
        logger.error("Erro ao chamar Ollama /api/chat: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Ollama indisponível: {exc}",
        )

    # Persiste resposta da IA
    ai_content = result.get("message", {}).get("content", "")
    token_usage = (result.get("usage") or {}).get("eval_count")
    if ai_content:
        add_chat_message(
            db,
            session_id=session_id,
            role="assistant",
            content=ai_content,
            model=result.get("model", request.model),
            temperature=temperature,
            token_usage=token_usage,
        )

    return {
        "session_id": session_id,
        **result,
    }


# ── Endpoints de sessões ──────────────────────────────────────────────────────

class SessionListItem(BaseModel):
    """Item resumido na listagem de sessões."""

    model_config = ConfigDict(from_attributes=True)

    id:         int
    title:      str | None = None
    created_at: str
    updated_at: str


class SessionWithMessages(BaseModel):
    """Sessão completa com suas mensagens."""

    model_config = ConfigDict(from_attributes=True)

    id:          int
    title:       str | None = None
    is_archived: bool
    created_at:  str
    updated_at:  str
    messages:    list[ChatMessageSchema]


@router.get("/sessions", response_model=list[ChatSessionSchema])
async def list_sessions(
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retorna as últimas sessões ativas do usuário atual, ordenadas pela mais recente."""
    sessions = list_sessions_for_user(db, user_id=current_user.id, limit=limit)
    return [ChatSessionSchema.model_validate(s) for s in sessions]


@router.get("/sessions/{session_id}", response_model=SessionWithMessages)
async def get_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retorna a sessão com todas as suas mensagens.

    Retorna 404 se a sessão não existir ou não pertencer ao usuário autenticado.
    """
    session = get_session_with_messages(db, session_id=session_id, user_id=current_user.id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sessão não encontrada",
        )

    return SessionWithMessages(
        id=session.id,
        title=session.title,
        is_archived=session.is_archived,
        created_at=session.created_at.isoformat(),
        updated_at=session.updated_at.isoformat(),
        messages=[ChatMessageSchema.model_validate(m) for m in session.messages],
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
