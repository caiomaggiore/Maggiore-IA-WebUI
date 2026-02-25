import logging
import sys

from app.core.config import settings


def setup_logging() -> None:
    """Configura o logging global da aplicação."""
    level = logging.DEBUG if settings.API_ENV == "dev" else logging.INFO

    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
