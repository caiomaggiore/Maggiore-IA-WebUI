# TODO: integrar vetor DB (Qdrant/Chroma) e documentos técnicos Q-SYS, áudio/vídeo.
import logging
from typing import Any

logger = logging.getLogger(__name__)


async def query(payload: dict[str, Any]) -> dict[str, Any]:
    """Stub: futuramente consultará um vetor DB com embeddings de documentos técnicos.

    TODO: integrar Qdrant/Chroma com documentos Q-SYS, áudio e vídeo.
    """
    logger.info("RAG query recebida (não implementado): %s", payload)
    return {"status": "not_implemented"}
