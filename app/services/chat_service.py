import json
import logging
from typing import Any, AsyncIterator, Callable

from app.services import ollama_client

logger = logging.getLogger(__name__)


def _transform_chat_line(line: str) -> str | None:
    """Extrai message.content do NDJSON do Ollama e retorna linha no formato { "token": "<conteúdo>" }."""
    try:
        data = json.loads(line)
        content = data.get("message", {}).get("content", "")
        if content:
            return json.dumps({"token": content}) + "\n"
    except (json.JSONDecodeError, TypeError):
        pass
    return None


def _transform_generate_line(line: str) -> str | None:
    """Extrai response do NDJSON do Ollama e retorna linha no formato { "token": "<conteúdo>" }."""
    try:
        data = json.loads(line)
        content = data.get("response", "")
        if content:
            return json.dumps({"token": content}) + "\n"
    except (json.JSONDecodeError, TypeError):
        pass
    return None


async def _stream_ndjson_tokens(
    ollama_stream: AsyncIterator[bytes],
    transform_fn: Callable[[str], str | None],
) -> AsyncIterator[bytes]:
    """Bufferiza o stream do Ollama, parseia NDJSON e emite linhas { "token": "<conteúdo>" }."""
    buffer = b""
    async for chunk in ollama_stream:
        buffer += chunk
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            line_str = line.decode("utf-8", errors="replace").strip()
            if not line_str:
                continue
            transformed = transform_fn(line_str)
            if transformed:
                yield transformed.encode("utf-8")


def _format_chat_response(raw: dict[str, Any]) -> dict[str, Any]:
    """Formata a resposta do Ollama em modelo único com model, created_at, message e usage."""
    message = raw.get("message") or {}
    usage = {
        "total_duration": raw.get("total_duration"),
        "load_duration": raw.get("load_duration"),
        "prompt_eval_count": raw.get("prompt_eval_count"),
        "prompt_eval_duration": raw.get("prompt_eval_duration"),
        "eval_count": raw.get("eval_count"),
        "eval_duration": raw.get("eval_duration"),
    }
    return {
        "model": raw.get("model", ""),
        "created_at": raw.get("created_at", ""),
        "message": {
            "role": message.get("role", "assistant"),
            "content": message.get("content", ""),
        },
        "usage": usage,
    }


async def handle_chat(payload: dict[str, Any]) -> dict[str, Any]:
    """Orquestra a chamada de chat ao Ollama e retorna resposta formatada com model, message e usage."""
    logger.debug("Enviando chat para Ollama: model=%s", payload.get("model"))
    raw = await ollama_client.chat(payload)
    return _format_chat_response(raw)


async def handle_chat_stream(payload: dict[str, Any]) -> AsyncIterator[bytes]:
    """Stream de chat: extrai message.content e envia NDJSON { "token": "<conteúdo>" } por linha."""
    logger.debug("Iniciando chat stream para Ollama: model=%s", payload.get("model"))
    async for chunk in _stream_ndjson_tokens(
        ollama_client.chat_stream(payload), _transform_chat_line
    ):
        yield chunk


async def handle_generate(payload: dict[str, Any]) -> dict[str, Any]:
    """Orquestra a chamada de geração de texto ao Ollama."""
    logger.debug("Enviando generate para Ollama: model=%s", payload.get("model"))
    return await ollama_client.generate(payload)


async def handle_generate_stream(payload: dict[str, Any]) -> AsyncIterator[bytes]:
    """Stream de generate: extrai response e envia NDJSON { "token": "<conteúdo>" } por linha."""
    logger.debug("Iniciando generate stream para Ollama: model=%s", payload.get("model"))
    async for chunk in _stream_ndjson_tokens(
        ollama_client.generate_stream(payload), _transform_generate_line
    ):
        yield chunk
