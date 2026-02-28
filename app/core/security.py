from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

import bcrypt
from jose import jwt
from sqlalchemy.orm import Session

from app.core.config import settings

if TYPE_CHECKING:
    from app.models.user import User


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


def authenticate_user(db: Session, email: str, password: str) -> "User | None":
    """Busca o usuário pelo e-mail e valida a senha.

    Retorna o ORM User se as credenciais forem válidas, None caso contrário.
    Importação do CRUD feita localmente para evitar ciclo de importação.
    """
    from app.crud.user import get_user_by_email  # importação local: evita ciclo

    user = get_user_by_email(db, email)
    if not user or not user.is_active:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user
