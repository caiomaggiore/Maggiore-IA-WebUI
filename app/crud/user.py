import logging

from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
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


def update_user_profile(
    db: Session,
    user_id: int,
    *,
    first_name: str | None = None,
    last_name: str | None = None,
    nickname: str | None = None,
    bio: str | None = None,
) -> User | None:
    """Atualiza campos de perfil do usuário. Retorna o usuário ou None."""
    user = db.get(User, user_id)
    if user is None:
        return None
    if first_name is not None:
        user.first_name = first_name
    if last_name is not None:
        user.last_name = last_name
    if nickname is not None:
        user.nickname = nickname
    if bio is not None:
        user.bio = bio
    db.commit()
    db.refresh(user)
    return user


def change_password(
    db: Session,
    user_id: int,
    current_password: str,
    new_password: str,
) -> bool:
    """Troca a senha do usuário. Retorna True se ok, False se senha atual inválida."""
    user = db.get(User, user_id)
    if not user or not verify_password(current_password, user.hashed_password):
        return False
    user.hashed_password = hash_password(new_password)
    db.commit()
    return True
