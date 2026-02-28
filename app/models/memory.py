import enum
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.core.database import Base


# ── Enum de camadas de memória ────────────────────────────────────────────────

class MemoryTier(str, enum.Enum):
    short  = "short"   # memória de curto prazo (sessão/contexto imediato)
    medium = "medium"  # memória de médio prazo (padrões recentes)
    long   = "long"    # memória de longo prazo (preferências persistentes)


# ── Modelo ORM ────────────────────────────────────────────────────────────────

class Memory(Base):
    """Memória associada a um usuário, organizada em camadas de retenção."""

    __tablename__ = "memories"

    id      = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)

    tier    = Column(Enum(MemoryTier, name="memory_tier"), index=True, nullable=False)
    label   = Column(String(255), nullable=True)   # ex.: "preferência de tom"
    content = Column(Text, nullable=False)

    # Pontuação de relevância — permite priorizar/descartar memórias antigas
    importance = Column(Float, nullable=False, server_default="0")

    created_at       = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_accessed_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    expires_at       = Column(DateTime(timezone=True), nullable=True)  # None = sem expiração

    user = relationship("User", back_populates="memories")


# ── Schemas Pydantic ──────────────────────────────────────────────────────────

class MemoryCreate(BaseModel):
    """Payload para criar uma memória."""

    tier:       MemoryTier
    label:      str | None = None
    content:    str
    importance: float = 0.0
    expires_at: datetime | None = None


class MemorySchema(BaseModel):
    """Representação pública de uma memória."""

    model_config = ConfigDict(from_attributes=True)

    id:              int
    user_id:         int
    tier:            MemoryTier
    label:           str | None = None
    content:         str
    importance:      float
    created_at:      datetime
    last_accessed_at: datetime
    expires_at:      datetime | None = None
