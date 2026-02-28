from datetime import datetime

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Boolean, Column, DateTime, Integer, String, func
from sqlalchemy.orm import relationship

from app.core.database import Base


# ── Modelo ORM (tabela no banco) ──────────────────────────────────────────────

class User(Base):
    """Tabela de usuários no PostgreSQL."""

    __tablename__ = "users"

    id              = Column(Integer, primary_key=True, index=True)
    email           = Column(String(255), unique=True, index=True, nullable=False)
    full_name       = Column(String(255), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    is_active       = Column(Boolean, nullable=False, server_default="true")
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    chat_sessions = relationship("ChatSession", back_populates="user", cascade="all, delete-orphan")
    memories      = relationship("Memory", back_populates="user", cascade="all, delete-orphan")


# ── Schemas Pydantic (request / response da API) ──────────────────────────────

class UserSchema(BaseModel):
    """Dados públicos do usuário retornados pela API."""

    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "examples": [
                {
                    "id": 1,
                    "email": "admin@example.com",
                    "full_name": "Admin",
                    "is_active": True,
                }
            ]
        },
    )

    id: int
    email: str
    full_name: str | None = None
    is_active: bool
    created_at: datetime | None = None


class TokenResponse(BaseModel):
    """Resposta do endpoint de login."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {"access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", "token_type": "bearer"}
            ]
        }
    )

    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    """Payload de login."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [{"email": "admin@example.com", "password": "admin123"}]
        }
    )

    email: str
    password: str
