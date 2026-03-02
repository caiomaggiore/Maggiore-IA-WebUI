from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.core.database import Base

MessageRole = Literal["user", "assistant", "system"]


# ── Modelo ORM ────────────────────────────────────────────────────────────────

class ChatMessage(Base):
    """Mensagem individual dentro de uma sessão de chat."""

    __tablename__ = "chat_messages"

    id               = Column(Integer, primary_key=True, index=True)
    session_id       = Column(Integer, ForeignKey("chat_sessions.id", ondelete="CASCADE"), index=True, nullable=False)
    role             = Column(String(32), nullable=False)     # "user" | "assistant" | "system"
    content          = Column(Text, nullable=False)
    model            = Column(String(128), nullable=True)     # ex.: "mistral", "llama3"
    temperature      = Column(Float, nullable=True)           # temperatura usada na geração
    token_count      = Column(Integer, nullable=True)         # token_count da mensagem individual
    token_usage      = Column(Integer, nullable=True)        # total de tokens consumidos (prompt+resposta)
    thinking_summary = Column(Text, nullable=True)            # resumo do pensamento (Thinking Mode)
    thinking_time_ms = Column(Integer, nullable=True)        # tempo do pensamento em ms
    thinking_level   = Column(String(32), nullable=True)      # esperto | inteligente | culto | sabio
    created_at       = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("ChatSession", back_populates="messages")


# ── Schemas Pydantic ──────────────────────────────────────────────────────────

class ChatMessageCreate(BaseModel):
    """Payload para salvar uma mensagem numa sessão."""

    role:        MessageRole
    content:     str
    model:       str | None = None
    temperature: float | None = None
    token_count: int | None = None
    token_usage: int | None = None

    @field_validator("content")
    @classmethod
    def content_nao_vazio(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("content não pode ser vazio")
        return v


class ChatMessageSchema(BaseModel):
    """Representação pública de uma mensagem de chat."""

    model_config = ConfigDict(from_attributes=True)

    id:               int
    session_id:       int
    role:             str
    content:          str
    model:            str | None = None
    temperature:      float | None = None
    token_count:      int | None = None
    token_usage:      int | None = None
    thinking_summary: str | None = None
    thinking_time_ms: int | None = None
    thinking_level:   str | None = None
    created_at:       datetime
