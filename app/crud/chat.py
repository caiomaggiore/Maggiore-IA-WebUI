import logging
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.chat_message import ChatMessage
from app.models.chat_session import ChatSession

logger = logging.getLogger(__name__)


def create_chat_session(
    db: Session,
    user_id: int,
    title: str | None = None,
) -> ChatSession:
    """Cria e persiste uma nova sessão de chat para o usuário."""
    session = ChatSession(user_id=user_id, title=title)
    db.add(session)
    db.commit()
    db.refresh(session)
    logger.debug("Sessão criada: id=%s user_id=%s", session.id, user_id)
    return session


def add_chat_message(
    db: Session,
    session_id: int,
    role: str,
    content: str,
    model: str | None = None,
    temperature: float | None = None,
    token_usage: int | None = None,
) -> ChatMessage:
    """Adiciona uma mensagem à sessão e atualiza o updated_at da sessão."""
    message = ChatMessage(
        session_id=session_id,
        role=role,
        content=content,
        model=model,
        temperature=temperature,
        token_usage=token_usage,
    )
    db.add(message)

    # Força o updated_at da sessão com a hora atual
    db.query(ChatSession).filter(ChatSession.id == session_id).update(
        {"updated_at": datetime.now(timezone.utc)},
        synchronize_session="fetch",
    )

    db.commit()
    db.refresh(message)
    logger.debug("Mensagem adicionada: session_id=%s role=%s", session_id, role)
    return message


def list_sessions_for_user(
    db: Session,
    user_id: int,
    limit: int = 20,
) -> list[ChatSession]:
    """Retorna as últimas sessões não arquivadas do usuário, ordenadas por updated_at desc."""
    return (
        db.query(ChatSession)
        .filter(ChatSession.user_id == user_id, ChatSession.is_archived == False)  # noqa: E712
        .order_by(ChatSession.updated_at.desc())
        .limit(limit)
        .all()
    )


def get_session_with_messages(
    db: Session,
    session_id: int,
    user_id: int,
) -> ChatSession | None:
    """Retorna a sessão com suas mensagens (ordenadas por created_at asc).

    Verifica que a sessão pertence ao user_id informado.
    Retorna None se não encontrada ou se pertencer a outro usuário.
    """
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user_id)
        .first()
    )
    if session is None:
        return None

    # Garante que as mensagens foram carregadas (lazy load já ocorre,
    # mas a ordenação é garantida pela definição do relationship no modelo)
    _ = session.messages  # dispara o lazy load dentro da sessão aberta
    return session
