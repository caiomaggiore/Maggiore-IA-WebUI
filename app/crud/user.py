import logging

from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.user import User

logger = logging.getLogger(__name__)


def get_user_by_email(db: Session, email: str) -> User | None:
    """Retorna o usuário pelo e-mail ou None se não existir."""
    return db.query(User).filter(User.email == email).first()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    """Retorna o usuário pelo ID ou None se não existir."""
    return db.get(User, user_id)


def create_user(
    db: Session,
    email: str,
    password: str,
    full_name: str | None = None,
) -> User:
    """Cria e persiste um novo usuário com senha hasheada.

    Lança ValueError se o e-mail já estiver cadastrado.
    """
    if get_user_by_email(db, email):
        raise ValueError(f"E-mail já cadastrado: {email}")

    user = User(
        email=email,
        full_name=full_name,
        hashed_password=hash_password(password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info("Usuário criado: id=%s email=%s", user.id, user.email)
    return user
