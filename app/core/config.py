from pathlib import Path
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict

# .env na raiz do projeto (ao lado de app/)
_ENV_PATH = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    """Configurações globais da aplicação, carregadas via .env."""

    model_config = SettingsConfigDict(
        env_file=_ENV_PATH if _ENV_PATH.exists() else ".env",
        env_file_encoding="utf-8",
    )

    API_ENV: str = "dev"
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8001

    OLLAMA_HOST: str = "http://localhost:11434"

    JWT_SECRET: str = "changeme"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60

    # PostgreSQL obrigatório — defina no .env
    DATABASE_URL: str


settings = Settings()

# Modelos disponíveis (hardcoded). active indica se o modelo está pronto para uso.
AVAILABLE_MODELS: list[dict[str, Any]] = [
    {"id": "mistral", "name": "Mistral", "active": True},
    {"id": "llama3:latest", "name": "Llama 3", "active": True},
    {"id": "gemma2", "name": "Gemma 2", "active": True},
    {"id": "qwen2", "name": "Qwen 2", "active": False},
]
