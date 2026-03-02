from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.v1 import auth, chat, rag
from app.core.config import settings
from app.core.database import Base, engine
from app.core.logging import setup_logging
import app.models  # noqa: F401 — registra todos os ORM no metadata antes do create_all

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


def _ensure_chat_sessions_columns():
    """Adiciona colunas novas em chat_sessions se não existirem (evita quebrar DBs existentes)."""
    from sqlalchemy import text
    with engine.connect() as conn:
        for stmt in [
            "ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL",
            "ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS subtitle TEXT NULL",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(128) NULL",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(128) NULL",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(128) NULL",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NULL",
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS thinking_summary TEXT NULL",
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS thinking_time_ms INTEGER NULL",
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS thinking_level VARCHAR(32) NULL",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                conn.rollback()
                # Coluna já existe ou tabela não existe ainda (create_all cria depois)
                pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Inicializa recursos na subida e libera no encerramento."""
    setup_logging()
    # Cria tabelas que ainda não existem (dev). Trocar por Alembic em produção.
    Base.metadata.create_all(bind=engine)
    _ensure_chat_sessions_columns()
    yield


app = FastAPI(
    title="Aurion IA — Suporte Técnico Inteligente",
    description="API backend com proxy para Ollama, autenticação JWT e base para RAG.",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(chat.router, prefix="/v1", tags=["chat"])
app.include_router(rag.router, prefix="/v1/rag", tags=["rag"])

if _STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")


@app.get("/", tags=["frontend"])
async def index():
    """Serve a landing page do projeto."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/static/index.html")


@app.get("/health", tags=["health"])
async def health() -> dict:
    """Verifica se a API está no ar."""
    return {"status": "ok", "env": settings.API_ENV}


if __name__ == "__main__":
    # Executar da raiz do projeto: python -m app.main
    # Se "Address already in use", altere API_PORT no .env ou encerre o processo na porta 8000.
    import uvicorn

    uvicorn.run("app.main:app", host=settings.API_HOST, port=settings.API_PORT, reload=True)
