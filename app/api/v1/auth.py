import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import authenticate_user, create_access_token, decode_token
from app.crud.user import change_password, get_user_by_id, update_user_profile
from app.models.user import (
    ChangePasswordRequest,
    LoginRequest,
    ProfileUpdate,
    TokenResponse,
    UserSchema,
)

logger = logging.getLogger(__name__)
router = APIRouter()
bearer_scheme = HTTPBearer()

DbSession = Annotated[Session, Depends(get_db)]


# ── Dependency de autenticação ────────────────────────────────────────────────

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> UserSchema:
    """Decodifica o JWT, busca o usuário no banco e retorna 401 se inválido/inativo."""
    token = credentials.credentials
    try:
        payload = decode_token(token)
        user_id = int(payload.get("sub", 0))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido ou expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário não encontrado ou inativo",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return UserSchema.model_validate(user)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: DbSession) -> TokenResponse:
    """Autentica o usuário no banco e retorna um JWT de acesso."""
    user = authenticate_user(db, body.email, body.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciais inválidas",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Sub contém o ID numérico — mais robusto que o e-mail (e-mail pode mudar)
    token = create_access_token(subject=str(user.id))
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserSchema)
async def me(current_user: UserSchema = Depends(get_current_user)) -> UserSchema:
    """Retorna os dados do usuário autenticado."""
    return current_user


@router.patch("/me", response_model=UserSchema)
async def update_me(
    body: ProfileUpdate,
    db: DbSession,
    current_user: UserSchema = Depends(get_current_user),
) -> UserSchema:
    """Atualiza perfil (nome, sobrenome, apelido, bio)."""
    user = update_user_profile(
        db,
        current_user.id,
        first_name=body.first_name,
        last_name=body.last_name,
        nickname=body.nickname,
        bio=body.bio,
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado")
    return UserSchema.model_validate(user)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password_endpoint(
    body: ChangePasswordRequest,
    db: DbSession,
    current_user: UserSchema = Depends(get_current_user),
):
    """Troca a senha do usuário. Requer senha atual e nova senha."""
    ok = change_password(db, current_user.id, body.current_password, body.new_password)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Senha atual incorreta",
        )
