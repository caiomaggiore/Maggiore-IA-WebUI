from pathlib import Path

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.v1 import auth, chat, rag
from app.core.config import settings
from app.core.logging import setup_logging

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Inicializa recursos na subida e libera no encerramento."""
    setup_logging()
    yield


app = FastAPI(
    title="SaaS IA — Suporte Técnico AV",
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
    """Redireciona para a tela de login."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/static/login.html")


@app.get("/health", tags=["health"])
async def health() -> dict:
    """Verifica se a API está no ar."""
    return {"status": "ok", "env": settings.API_ENV}


if __name__ == "__main__":
    # Executar da raiz do projeto: python -m app.main
    # Se "Address already in use", altere API_PORT no .env ou encerre o processo na porta 8000.
    import uvicorn

    uvicorn.run("app.main:app", host=settings.API_HOST, port=settings.API_PORT, reload=True)
