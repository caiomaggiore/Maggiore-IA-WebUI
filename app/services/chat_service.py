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


async def generate_session_title(first_user_message: str, model: str = "mistral") -> str:
    """Gera um título de até 4 palavras para a sessão com base na primeira mensagem do usuário."""
    prompt = (
        f"Gere um título muito curto (máximo 4 palavras) para uma conversa que começa com a seguinte mensagem. "
        f"Responda APENAS com o título, sem aspas nem pontuação extra.\n\nMensagem: {first_user_message[:500]}"
    )
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 30},
    }
    try:
        raw = await ollama_client.generate(payload)
        response = (raw.get("response") or "").strip()
        words = response.split()[:4]
        return " ".join(words) if words else first_user_message[:50].strip() or "Nova conversa"
    except Exception as exc:
        logger.warning("Falha ao gerar título via Ollama: %s", exc)
        return first_user_message[:50].strip() or "Nova conversa"


async def generate_session_title_and_subtitle(
    recent_context: str, model: str = "mistral"
) -> tuple[str, str]:
    """Gera título (até 4 palavras) e subtítulo (pelo menos 5 palavras) com base no rumo recente do chat."""
    prompt = (
        f"Com base no seguinte resumo de conversa, gere:\n"
        f"1) Um título curto (máximo 4 palavras).\n"
        f"2) Um subtítulo descritivo (pelo menos 5 palavras).\n"
        f"Responda em exatamente duas linhas: na primeira linha só o título, na segunda só o subtítulo. "
        f"Sem prefixos como 'Título:' ou 'Subtítulo:'.\n\nResumo: {recent_context[:800]}"
    )
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 80},
    }
    try:
        raw = await ollama_client.generate(payload)
        response = (raw.get("response") or "").strip()
        lines = [ln.strip() for ln in response.split("\n") if ln.strip()][:2]
        title = " ".join((lines[0].split() if lines else [])[:4]) or "Conversa"
        subtitle = " ".join((lines[1].split() if len(lines) > 1 else [])[:20]) or ""
        if len(subtitle.split()) < 5 and subtitle:
            subtitle = subtitle + " " + "conversa sobre o tema."
        return title, subtitle
    except Exception as exc:
        logger.warning("Falha ao gerar título/subtítulo via Ollama: %s", exc)
        return "Conversa", ""
