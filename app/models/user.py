from pydantic import BaseModel, ConfigDict


class User(BaseModel):
    """Representa um usuário da plataforma."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {"id": "1", "email": "admin@example.com", "full_name": "Admin", "disabled": False}
            ]
        }
    )

    id: str
    email: str
    full_name: str
    disabled: bool = False


class UserInDB(User):
    """Usuário com senha hasheada (para armazenamento)."""

    hashed_password: str


class TokenResponse(BaseModel):
    """Resposta do endpoint de login."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {"access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", "token_type": "bearer"}
            ]
        }
    )

    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    """Payload de login."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {"email": "admin@example.com", "password": "admin123"}
            ]
        }
    )

    email: str
    password: str
