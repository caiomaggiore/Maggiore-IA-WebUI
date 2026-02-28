# Importar todos os modelos ORM aqui garante que o SQLAlchemy os registre
# no metadata do Base antes de qualquer chamada a Base.metadata.create_all().
from app.models.user import User  # noqa: F401
from app.models.chat_session import ChatSession  # noqa: F401
from app.models.chat_message import ChatMessage  # noqa: F401
from app.models.memory import Memory  # noqa: F401
