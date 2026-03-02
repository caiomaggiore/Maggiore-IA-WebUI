import logging
import unicodedata
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.models.chat_message import ChatMessage
from app.models.chat_session import ChatSession

logger = logging.getLogger(__name__)

PREVIEW_MAX_LEN = 120


def _normalize_search(s: str) -> str:
    """Remove acentos e converte para minúsculas para busca insensível a acentuação e caso."""
    if not s or not s.strip():
        return ""
    s = s.strip().lower()
    nfd = unicodedata.normalize("NFD", s)
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn")


# Caracteres latinos: para cada base, possíveis formas acentuadas (para regex)
_ACCENT_MAP = {
    "a": "aáàâãäåāăą",
    "e": "eéèêëēėę",
    "i": "iíìîïīį",
    "o": "oóòôõöōő",
    "u": "uúùûüūů",
    "c": "cçćč",
    "n": "nñń",
}


def _regex_pattern_insensitive(normalized: str) -> str:
    """Gera padrão regex para ~* (case + accent insensitive). Ex: 'matematica' -> '[mM][aAáÁ...][tT]...'."""
    import re
    out = []
    for c in normalized:
        if c in _ACCENT_MAP:
            variants = _ACCENT_MAP[c]
            out.append("[" + "".join(v + v.upper() for v in variants) + "]")
        elif c.isalpha():
            out.append("[" + c + c.upper() + "]")
        elif c.isspace():
            out.append("[ \\t\\n\\r]+")
        elif c.isdigit():
            out.append(re.escape(c))
        else:
            out.append(re.escape(c))
    return "".join(out)


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
    thinking_summary: str | None = None,
    thinking_time_ms: int | None = None,
    thinking_level: str | None = None,
) -> ChatMessage:
    """Adiciona uma mensagem à sessão e atualiza o updated_at da sessão."""
    message = ChatMessage(
        session_id=session_id,
        role=role,
        content=content,
        model=model,
        temperature=temperature,
        token_usage=token_usage,
        thinking_summary=thinking_summary,
        thinking_time_ms=thinking_time_ms,
        thinking_level=thinking_level,
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
    include_archived: bool = False,
    q: str | None = None,
) -> list[dict[str, Any]]:
    """Lista sessões do usuário, ignorando deleted_at.

    Se q for informado, filtra por título ou conteúdo de mensagem (ILIKE).
    Ordena por is_pinned DESC, updated_at DESC.
    Retorna lista de dicts com campos da sessão + last_message_preview e last_message_at.
    """
    base = (
        db.query(ChatSession)
        .filter(ChatSession.user_id == user_id, ChatSession.deleted_at.is_(None))
    )
    if not include_archived:
        base = base.filter(ChatSession.is_archived == False)  # noqa: E712

    if q and q.strip():
        raw_term = q.strip()
        normalized = _normalize_search(raw_term)
        term_any = f"%{raw_term}%"
        # Busca insensível a maiúsculas e acentuação (ex.: "matematica" encontra "Matemática")
        # Usa regex ~* com classe de caracteres que inclui acentos
        if normalized:
            regex_pat = _regex_pattern_insensitive(normalized)
            regex_sql = f".*{regex_pat}.*"
            title_match = ChatSession.title.op("~*")(regex_sql)
            sub = (
                db.query(ChatMessage.session_id)
                .filter(ChatMessage.content.op("~*")(regex_sql))
                .distinct()
                .subquery()
            )
            base = base.filter(or_(title_match, ChatSession.id.in_(db.query(sub.c.session_id))))
        else:
            sub = (
                db.query(ChatMessage.session_id)
                .filter(ChatMessage.content.ilike(term_any))
                .distinct()
                .subquery()
            )
            base = base.filter(
                or_(
                    ChatSession.title.ilike(term_any),
                    ChatSession.id.in_(db.query(sub.c.session_id)),
                )
            )

    sessions = (
        base.order_by(ChatSession.is_pinned.desc(), ChatSession.updated_at.desc())
        .limit(limit)
        .all()
    )

    if not sessions:
        return []

    session_ids = [s.id for s in sessions]
    # Última mensagem por sessão (max created_at)
    last_created = (
        db.query(ChatMessage.session_id, func.max(ChatMessage.created_at).label("max_created"))
        .filter(ChatMessage.session_id.in_(session_ids))
        .group_by(ChatMessage.session_id)
        .subquery()
    )
    last_msgs = (
        db.query(ChatMessage)
        .join(
            last_created,
            and_(
                ChatMessage.session_id == last_created.c.session_id,
                ChatMessage.created_at == last_created.c.max_created,
            ),
        )
        .all()
    )
    last_by_sid = {m.session_id: (m.content or "", m.created_at) for m in last_msgs}

    out = []
    for s in sessions:
        preview = ""
        last_at = s.updated_at
        if s.id in last_by_sid:
            content, created = last_by_sid[s.id]
            preview = (content or "")[:PREVIEW_MAX_LEN]
            if len(content or "") > PREVIEW_MAX_LEN:
                preview += "…"
            last_at = created
        out.append({
            "id": s.id,
            "user_id": s.user_id,
            "title": s.title,
            "subtitle": getattr(s, "subtitle", None),
            "is_archived": s.is_archived,
            "is_pinned": s.is_pinned,
            "created_at": s.created_at,
            "updated_at": s.updated_at,
            "last_message_preview": preview or None,
            "last_message_at": last_at,
        })
    return out


def get_session_with_messages(
    db: Session,
    session_id: int,
    user_id: int,
) -> ChatSession | None:
    """Retorna a sessão com suas mensagens (ordenadas por created_at asc).

    Verifica que a sessão pertence ao user_id informado.
    Retorna None se não encontrada, pertencer a outro usuário ou estiver deletada (soft).
    """
    session = (
        db.query(ChatSession)
        .filter(
            ChatSession.id == session_id,
            ChatSession.user_id == user_id,
            ChatSession.deleted_at.is_(None),
        )
        .first()
    )
    if session is None:
        return None

    _ = session.messages
    return session


def update_session(
    db: Session,
    session_id: int,
    user_id: int,
    *,
    title: str | None = None,
    subtitle: str | None = None,
    is_pinned: bool | None = None,
    is_archived: bool | None = None,
) -> ChatSession | None:
    """Atualiza campos da sessão (apenas os informados). Retorna a sessão ou None se não for dono."""
    session = (
        db.query(ChatSession)
        .filter(
            ChatSession.id == session_id,
            ChatSession.user_id == user_id,
            ChatSession.deleted_at.is_(None),
        )
        .first()
    )
    if session is None:
        return None

    if title is not None:
        session.title = title
    if subtitle is not None:
        session.subtitle = subtitle
    if is_pinned is not None:
        session.is_pinned = is_pinned
    if is_archived is not None:
        session.is_archived = is_archived

    session.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(session)
    return session


def soft_delete_session(db: Session, session_id: int, user_id: int) -> bool:
    """Soft delete: seta deleted_at = now(). Retorna True se encontrou e era do usuário."""
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user_id)
        .first()
    )
    if session is None:
        return False

    session.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return True
