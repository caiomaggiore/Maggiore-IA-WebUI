import logging
from typing import Any, AsyncIterator

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


async def chat(payload: dict[str, Any]) -> dict[str, Any]:
    """Encaminha uma requisição de chat para o Ollama e retorna a resposta JSON."""
    url = f"{settings.OLLAMA_HOST}/api/chat"
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        return response.json()


async def chat_stream(payload: dict[str, Any]) -> AsyncIterator[bytes]:
    """Encaminha uma requisição de chat em modo streaming para o Ollama."""
    url = f"{settings.OLLAMA_HOST}/api/chat"
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", url, json=payload) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes():
                yield chunk


async def generate(payload: dict[str, Any]) -> dict[str, Any]:
    """Encaminha uma requisição de geração de texto para o Ollama."""
    url = f"{settings.OLLAMA_HOST}/api/generate"
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        return response.json()


async def generate_stream(payload: dict[str, Any]) -> AsyncIterator[bytes]:
    """Encaminha uma requisição de geração em modo streaming para o Ollama."""
    url = f"{settings.OLLAMA_HOST}/api/generate"
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", url, json=payload) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes():
                yield chunk
