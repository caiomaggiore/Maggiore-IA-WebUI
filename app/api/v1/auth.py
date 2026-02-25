import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.security import create_access_token, decode_token, hash_password, verify_password
from app.models.user import LoginRequest, TokenResponse, User, UserInDB

logger = logging.getLogger(__name__)
router = APIRouter()
bearer_scheme = HTTPBearer()

# Usuário fake em memória para desenvolvimento
_FAKE_USERS_DB: dict[str, UserInDB] = {
    "admin@example.com": UserInDB(
        id="1",
        email="admin@example.com",
        full_name="Admin",
        hashed_password=hash_password("admin123"),
    )
}


def _get_user(email: str) -> UserInDB | None:
    """Busca usuário no repositório em memória."""
    return _FAKE_USERS_DB.get(email)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> User:
    """Valida o Bearer token e retorna o usuário autenticado."""
    token = credentials.credentials
    try:
        payload = decode_token(token)
        email: str = payload.get("sub", "")
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido ou expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = _get_user(email)
    if user is None or user.disabled:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário não encontrado",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return User(**user.model_dump(exclude={"hashed_password"}))


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest) -> TokenResponse:
    """Autentica o usuário e retorna um JWT de acesso."""
    user = _get_user(body.email)
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciais inválidas",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(subject=user.email)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=User)
async def me(current_user: User = Depends(get_current_user)) -> User:
    """Retorna os dados do usuário autenticado."""
    return current_user
