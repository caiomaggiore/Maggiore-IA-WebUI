from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import jwt

from app.core.config import settings


def hash_password(plain: str) -> str:
    """Retorna o hash bcrypt da senha em texto plano."""
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    """Verifica se a senha em texto plano corresponde ao hash."""
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(subject: str | Any, expires_delta: timedelta | None = None) -> str:
    """Gera um JWT de acesso com expiração configurável."""
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    )
    payload = {"sub": str(subject), "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decodifica e valida um JWT; lança JWTError se inválido."""
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
