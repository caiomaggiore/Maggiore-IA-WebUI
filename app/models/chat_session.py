from datetime import datetime

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.core.database import Base


# ── Modelo ORM ────────────────────────────────────────────────────────────────

class ChatSession(Base):
    """Sessão de chat vinculada a um usuário."""

    __tablename__ = "chat_sessions"

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    title       = Column(Text, nullable=True)  # nome de exibição (até 4 palavras)
    subtitle    = Column(Text, nullable=True)  # subtítulo (5+ palavras, após 5ª msg)
    is_archived = Column(Boolean, nullable=False, server_default="false")
    is_pinned   = Column(Boolean, nullable=False, server_default="false")
    deleted_at  = Column(DateTime(timezone=True), nullable=True)  # soft delete
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user     = relationship("User", back_populates="chat_sessions")
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan", order_by="ChatMessage.created_at")


# ── Schemas Pydantic ──────────────────────────────────────────────────────────

class ChatSessionCreate(BaseModel):
    """Payload para criar uma nova sessão de chat."""

    title: str | None = None


class ChatSessionSchema(BaseModel):
    """Representação pública de uma sessão de chat."""

    model_config = ConfigDict(from_attributes=True)

    id:          int
    user_id:     int
    title:       str | None = None
    subtitle:    str | None = None
    is_archived: bool
    is_pinned:   bool = False
    deleted_at:  datetime | None = None
    created_at:  datetime
    updated_at:  datetime
