from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.core.config import settings

engine = create_engine(
    settings.DATABASE_URL,
    future=True,
    # Exibe SQL gerado apenas em ambiente de desenvolvimento
    echo=settings.API_ENV == "dev",
    # Pool de conexões PostgreSQL: 5 persistentes + até 10 extras
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,  # verifica conexão antes de usá-la (reconecta se caiu)
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)

Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """Dependency FastAPI: fornece uma sessão de banco e garante o fechamento ao final."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
