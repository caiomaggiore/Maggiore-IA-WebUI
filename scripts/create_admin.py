"""
Cria o usuário administrador inicial na tabela users.

Uso:
    python -m scripts.create_admin

Variáveis de ambiente lidas via .env (DATABASE_URL obrigatório).
"""

import sys

# Garante que os modelos ORM estejam registrados no metadata antes de qualquer acesso ao banco
import app.models  # noqa: F401

from app.core.database import SessionLocal
from app.crud.user import create_user, get_user_by_email

ADMIN_EMAIL     = "admin@example.com"
ADMIN_PASSWORD  = "admin123"
ADMIN_FULL_NAME = "Admin"


def main() -> None:
    db = SessionLocal()
    try:
        existing = get_user_by_email(db, ADMIN_EMAIL)
        if existing:
            print(f"[skip] Usuário já existe: {ADMIN_EMAIL} (id={existing.id})")
            return

        user = create_user(
            db,
            email=ADMIN_EMAIL,
            password=ADMIN_PASSWORD,
            full_name=ADMIN_FULL_NAME,
        )
        print(f"[ok]   Usuário admin criado: {user.email} (id={user.id})")
    except Exception as exc:
        print(f"[erro] Falha ao criar admin: {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
