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


# ── Thinking Mode (planner interno, não persistido) ───────────────────────────

THINKING_LEVELS = ("esperto", "inteligente", "culto", "sabio")


def _thinking_prompt_and_options(level: str) -> tuple[str, int]:
    """Retorna instrução extra para o prompt e num_predict conforme o nível.

    Esperto: reflexão mínima, só o necessário para uma resposta coerente.
    Inteligente: reflexão um pouco maior, vocabulário melhor, lógico e prático.
    Culto: mais reflexão, referências (ex.: literárias), vocabulário rebuscado, profundidade.
    Sábio: junta os três e ainda sabedoria, papel de mestre, conselhos e ensinamentos.
    """
    level = (level or "inteligente").lower().strip()
    if level not in THINKING_LEVELS:
        level = "inteligente"
    if level == "esperto":
        return (
            "Você é um pensador objetivo. Não alongue: em 1 a 2 frases, capture a intenção do usuário e um único ponto central. "
            "O objetivo é só refletir o necessário para uma resposta coerente e direta.",
            80,
        )
    if level == "inteligente":
        return (
            "Você é um pensador lógico e prático. Em 2 a 4 frases, analise a intenção do usuário, os tópicos principais e uma conclusão útil. "
            "Use vocabulário claro e seja estruturado, sem listas longas.",
            180,
        )
    if level == "culto":
        return (
            "Você é um pensador culto. Em um parágrafo bem escrito, analise a intenção, o contexto relevante e as premissas. "
            "Pode trazer referências (literárias, filosóficas ou culturais) quando fizer sentido. Use vocabulário rebuscado e profundidade.",
            280,
        )
    # sabio: esperto + inteligente + culto + sabedoria, mestre, conselhos
    return (
        "Você é um sábio: objetivo, lógico, culto e, acima de tudo, sábio. Reflita com profundidade: intenção do usuário, contexto amplo, temas e premissas. "
        "Inclua referências quando enriquecerem a análise. Pense como um mestre que vai orientar com conselhos e ensinamentos; a reflexão deve sustentar essa voz.",
        400,
    )


async def run_thinking_planner(
    user_message: str, level: str, model: str = "mistral"
) -> str:
    """
    Fase 1 do Thinking Mode: gera análise interna (não-streaming).
    Retorna um resumo curto e legível. Nunca chain-of-thought.
    Não é persistido no servidor.
    """
    instruction, num_predict = _thinking_prompt_and_options(level)
    prompt = (
        f"Você é um planejador interno. Analise a mensagem do usuário e produza apenas um resumo de análise.\n"
        f"{instruction}\n"
        f"Não liste passos, não use bullet points longos. Uma única resposta em prosa.\n\n"
        f"Mensagem do usuário:\n{user_message[:2000]}"
    )
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.4, "num_predict": num_predict},
    }
    try:
        raw = await ollama_client.generate(payload)
        response = (raw.get("response") or "").strip()
        return response[:1500] if response else "Análise não disponível."
    except Exception as exc:
        logger.warning("Falha no thinking planner: %s", exc)
        return "Análise indisponível."


async def run_thinking_planner_stream(
    user_message: str, level: str, model: str = "mistral"
):
    """
    Versão em stream do planner: gera tokens e retorna (full_text, thinking_time_ms).
    Útil para o frontend mostrar o pensamento em tempo real.
    """
    import time
    instruction, num_predict = _thinking_prompt_and_options(level)
    prompt = (
        f"Você é um planejador interno. Analise a mensagem do usuário e produza apenas um resumo de análise.\n"
        f"{instruction}\n"
        f"Não liste passos, não use bullet points longos. Uma única resposta em prosa.\n\n"
        f"Mensagem do usuário:\n{user_message[:2000]}"
    )
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": True,
        "options": {"temperature": 0.4, "num_predict": num_predict},
    }
    t0 = time.perf_counter()
    full_parts = []
    buffer = b""
    try:
        async for chunk in ollama_client.generate_stream(payload):
            buffer += chunk
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                line_str = line.decode("utf-8", errors="replace").strip()
                if not line_str:
                    continue
                try:
                    import json
                    data = json.loads(line_str)
                    token = data.get("response", "")
                    if token:
                        full_parts.append(token)
                        yield ("token", token)
                except Exception:
                    pass
        full_text = "".join(full_parts).strip()[:1500] if full_parts else "Análise não disponível."
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        yield ("analysis", {"full": full_text, "thinking_time_ms": elapsed_ms, "level": level})
    except Exception as exc:
        logger.warning("Falha no thinking planner stream: %s", exc)
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        yield ("analysis", {"full": "Análise indisponível.", "thinking_time_ms": elapsed_ms, "level": level})
