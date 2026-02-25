```markdown
# Projeto: Plataforma SaaS de IA para suporte técnico AV

## Objetivo

Construir uma API backend em **Python 3.11+ com FastAPI**, que:

1. Exponha endpoints de chat e geração de texto compatíveis com o padrão do Ollama.
2. Faça **proxy** para o servidor Ollama rodando na rede local (ou remoto), usando o endpoint HTTP do Ollama.
3. Suporte autenticação simples com **JWT** (login, refresh opcional, checagem de token).
4. Tenha estrutura organizada de projeto em nível de produção, pensada para virar SaaS multi-cliente (futuro).
5. Seja fácil de integrar com:
   - RAG (base de conhecimento técnica de áudio/vídeo, Q-SYS etc.)
   - Automação via n8n (webhooks HTTP)
   - Ferramentas MCP (no futuro).

## Stack e dependências

- Linguagem: **Python 3.11+**
- Web framework: **FastAPI**
- Servidor ASGI: **uvicorn**
- HTTP client para falar com Ollama: **httpx** (assíncrono) ou `requests` (se for mais simples, preferir httpx).
- Auth: **PyJWT** ou `python-jose`, com senhas hash usando `passlib[bcrypt]`.
- Configuração: `pydantic-settings` (BaseSettings via `.env`).
- Banco de dados (futuro, mas já deixar pronto o layer): **PostgreSQL** via SQLAlchemy ou equivalente (podemos começar com um repositório em memória / stub).
- Tests: **pytest**.

## Arquitetura do projeto

Criar uma estrutura de pastas no padrão:

```

app/
├── api/
│   ├── **init**.py
│   ├── v1/
│   │   ├── **init**.py
│   │   ├── chat.py       # /v1/chat e /v1/generate
│   │   ├── auth.py       # /auth/login, /auth/me
│   │   └── rag.py        # endpoints de RAG (inicialmente stubs)
├── core/
│   ├── **init**.py
│   ├── config.py         # BaseSettings, carregando OLLAMA_HOST, SECRET_KEY, etc.
│   ├── security.py       # geração/validação de JWT
│   └── logging.py        # configuração de logging
├── models/
│   ├── **init**.py
│   ├── user.py           # modelo de usuário (pydantic + ORM futuramente)
├── services/
│   ├── **init**.py
│   ├── ollama_client.py  # funções para chamar /api/chat e /api/generate
│   ├── chat_service.py   # lógica de orquestração de chat
│   └── rag_service.py    # lógica de RAG (por enquanto apenas TODO / stub)
├── integrations/
│   ├── **init**.py
│   └── n8n.py            # helpers para integração via webhooks, futuramente
├── mcp/
│   ├── **init**.py
│   └── tools.py          # stubs para futuras ferramentas MCP
├── main.py               # criação do FastAPI app, inclusão de routers
└── **init**.py

````

Criar também:

- `pyproject.toml` ou `requirements.txt` com todas as dependências.
- `.env.example` com variáveis:
  - `API_ENV=dev`
  - `API_HOST=0.0.0.0`
  - `API_PORT=8000`
  - `OLLAMA_HOST=http://192.168.15.30:11434`
  - `JWT_SECRET=changeme`
  - `JWT_ALGORITHM=HS256`
  - `JWT_EXPIRE_MINUTES=60`

## Endpoints obrigatórios (versão inicial)

### 1. `POST /v1/chat`

- Request body (pydantic):

```jsonc
{
  "model": "llama3:latest",
  "messages": [
    { "role": "user", "content": "Explique o que é um sistema de áudio-vídeo para sala de reunião." }
  ],
  "stream": false,
  "options": {
    "temperature": 0.2,
    "num_predict": 200
  }
}
````

* A API deve:

  * Receber o payload.
  * Montar uma requisição HTTP para `OLLAMA_HOST/api/chat`.
  * Propagar `model`, `messages`, `stream` e `options` sem alterar o formato.
  * Devolver a resposta JSON do Ollama quase intacta, apenas adicionando metadados se necessário.

* Versão streaming:

  * Suportar `stream=true` com `curl -N`.
  * Utilizar StreamingResponse em FastAPI.

### 2. `POST /v1/generate`

* Request body:

```jsonc
{
  "model": "llama3:latest",
  "prompt": "Explique o que é um sistema de áudio-vídeo para sala de reunião.",
  "stream": false,
  "options": {
    "temperature": 0.2,
    "num_predict": 200
  }
}
```

* Mesma ideia: proxy para `OLLAMA_HOST/api/generate`.

### 3. Auth

* `POST /auth/login`

  * Recebe `email` e `password`.
  * Por enquanto usar um usuário fake em memória.
  * Se ok, retorna `access_token` (JWT) e `token_type` = "bearer".

* `GET /auth/me`

  * Protegido com `Authorization: Bearer <token>`.
  * Retorna dados básicos do usuário.

### 4. RAG (stub inicial)

* `POST /v1/rag/query`

  * Por enquanto, só valida o payload e retorna `{"status": "not_implemented"}`.
  * Vamos evoluir depois.

## Requisitos de código

* Usar **type hints** em todas as funções públicas.
* Usar **Pydantic models** para requests e responses.
* Adicionar docstrings curtas e claras nas funções principais.
* Evitar lógica pesada dentro dos arquivos de rota; delegar tudo a `services/`.
* Manter código pronto para rodar com:

```bash
uvicorn app.main:app --reload
```

em ambiente de desenvolvimento.

* Não mudar a stack ou a arquitetura sem instruções explícitas.

## Futuro (apenas preparar terreno, não implementar ainda)

* Camada de RAG usando um vetor DB (Qdrant/Chroma) consumindo PDFs técnicos (Q-SYS, áudio/vídeo).
* Integração com n8n via webhooks (`/integrations/n8n/*`).
* Implementação de ferramentas MCP para permitir que a IA execute ações controladas (consultar DB, ler logs, etc).


