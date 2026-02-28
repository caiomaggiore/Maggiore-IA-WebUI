# Maggiore IA

> Assistente de IA pessoal e corporativo com base de conhecimento privada, histórico de conversas e modelos de linguagem locais via Ollama.

![Stack](https://img.shields.io/badge/Python-3.11+-blue) ![FastAPI](https://img.shields.io/badge/FastAPI-0.111+-green) ![Ollama](https://img.shields.io/badge/Ollama-local-orange) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-lightblue) ![License](https://img.shields.io/badge/license-MIT-gray)

---

## O que é

Maggiore IA é uma plataforma SaaS de assistente inteligente com foco em privacidade total. Diferente de soluções em nuvem, ela roda **completamente no seu ambiente** — sem envio de dados para terceiros.

### Para quem serve

| Área | Caso de uso |
|------|-------------|
| ⚖️ Jurídico | Consulta a contratos, legislação e peças processuais |
| 🏥 Saúde | Protocolos, referências médicas e documentação clínica |
| 💰 Contábil | Normas fiscais, tributação e rotinas contábeis |
| 🏭 Industrial | Manuais técnicos e diagnósticos em linguagem natural |
| ✍️ Criativo | Pesquisa, referências e apoio à escrita |
| 🏢 Corporativo | Base de conhecimento interna, RH, treinamentos e suporte |

---

## Funcionalidades

- **Chat com streaming** — respostas token por token via NDJSON, sem travamentos
- **Histórico persistente** — sessões e mensagens salvas no PostgreSQL por usuário
- **Sidebar de conversas** — acesso rápido ao histórico com data relativa e sessão ativa destacada
- **Multi-modelo** — seleção de modelos Ollama no próprio chat
- **Autenticação JWT** — login seguro, sessão persistida no browser
- **Tema claro/escuro** — preferência salva por dispositivo
- **Layout responsivo** — funciona em desktop e mobile
- **Pronto para RAG** — estrutura para integrar base de conhecimento própria (Qdrant/Chroma)
- **Privacidade total** — deploy local (on-premise) ou ambiente corporativo isolado com VPN

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Python 3.11+, FastAPI, Uvicorn |
| Banco | PostgreSQL + SQLAlchemy (síncrono) |
| IA | Ollama (qualquer modelo compatível) |
| Auth | JWT via python-jose + bcrypt |
| Config | pydantic-settings via `.env` |
| Frontend | HTML, CSS e JavaScript puro (sem framework) |

---

## Estrutura do projeto

```
.
├── app/
│   ├── api/v1/          → Endpoints REST (auth, chat, rag)
│   ├── core/            → Configuração, banco, segurança, logging
│   ├── crud/            → Funções de acesso ao banco (user, chat)
│   ├── models/          → ORM SQLAlchemy + schemas Pydantic
│   │   ├── user.py
│   │   ├── chat_session.py
│   │   ├── chat_message.py
│   │   └── memory.py    (camadas de memória curto/médio/longo prazo)
│   ├── services/        → Proxy Ollama, chat service, rag service
│   ├── integrations/    → n8n (stub — futuro)
│   └── mcp/             → MCP tools (stub — futuro)
├── scripts/
│   └── create_admin.py  → Seed do usuário admin inicial
├── static/
│   ├── index.html       → Landing page pública
│   ├── login.html       → Tela de login
│   ├── chat.html        → Interface principal do chat
│   ├── css/
│   │   ├── base.css     → Variáveis, tema escuro, login
│   │   └── chat.css     → Layout sidebar + chat
│   └── js/
│       ├── auth.js      → Token JWT, login e redirect
│       └── chat.js      → Chat, sessões, streaming, sidebar
├── .env.example
├── requirements.txt
└── pyproject.toml
```

---

## Pré-requisitos

- Python 3.11 ou superior
- PostgreSQL 14 ou superior
- [Ollama](https://ollama.com/) instalado e rodando (local ou na rede)
- Ao menos um modelo baixado no Ollama: `ollama pull mistral`

---

## Instalação

```bash
# 1. Clone o repositório
git clone https://github.com/caiomaggiore/Maggiore-IA-WebUI.git
cd Maggiore-IA-WebUI

# 2. Crie e ative o ambiente virtual
python3 -m venv .venv
source .venv/bin/activate       # Linux/macOS
# .venv\Scripts\activate        # Windows

# 3. Instale as dependências
pip install -r requirements.txt

# 4. Configure as variáveis de ambiente
cp .env.example .env
# Edite o .env com suas configurações
```

---

## Configuração (`.env`)

```env
API_ENV=dev
API_HOST=0.0.0.0
API_PORT=8001
OLLAMA_HOST=http://localhost:11434
JWT_SECRET=troque-por-uma-chave-segura-e-longa
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=60
DATABASE_URL=postgresql+psycopg2://usuario:senha@localhost:5432/maggiore_ia
```

| Variável | Descrição | Obrigatório |
|---|---|---|
| `OLLAMA_HOST` | URL do servidor Ollama | ✅ |
| `JWT_SECRET` | Chave secreta para assinar tokens (use algo longo e aleatório) | ✅ |
| `DATABASE_URL` | String de conexão PostgreSQL | ✅ |

---

## Rodando

```bash
# 1. Crie o banco de dados no PostgreSQL
createdb maggiore_ia

# 2. Crie o usuário admin inicial (execute apenas uma vez)
python -m scripts.create_admin
# [ok]   Usuário admin criado: admin@example.com (id=1)

# 3. Suba o servidor
uvicorn app.main:app --reload
# ou
python -m app.main
```

Acesse em: **http://localhost:8001**

| URL | Descrição |
|---|---|
| `/` | Landing page |
| `/static/login.html` | Login |
| `/static/chat.html` | Chat |
| `/docs` | Documentação interativa da API (Swagger) |
| `/redoc` | Documentação alternativa (ReDoc) |

---

## Credenciais padrão (dev)

```
Email:    admin@example.com
Senha:    admin123
```

> ⚠️ Troque a senha e o `JWT_SECRET` antes de colocar em produção.

---

## API — endpoints principais

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/auth/login` | Login → retorna JWT |
| `GET` | `/auth/me` | Dados do usuário autenticado |
| `POST` | `/v1/chat` | Chat com Ollama (streaming ou JSON) |
| `GET` | `/v1/models` | Lista modelos disponíveis |
| `GET` | `/v1/sessions` | Histórico de conversas do usuário |
| `GET` | `/v1/sessions/{id}` | Sessão com todas as mensagens |
| `POST` | `/v1/generate` | Geração de texto (proxy Ollama) |
| `POST` | `/v1/rag/query` | Consulta RAG (stub — em desenvolvimento) |

---

## Banco de dados

As tabelas são criadas automaticamente no startup do servidor (`Base.metadata.create_all`).

Para produção, recomenda-se migrar para **Alembic**:

```bash
pip install alembic
alembic init alembic
alembic revision --autogenerate -m "initial"
alembic upgrade head
```

### Modelo de dados

```
users
  └── chat_sessions (1:N)
        └── chat_messages (1:N)
  └── memories (1:N)  ← camadas curto/médio/longo prazo (futuro)
```

---

## Roadmap

- [x] Autenticação JWT com PostgreSQL
- [x] Proxy para Ollama com streaming NDJSON
- [x] Histórico de sessões e mensagens persistidas
- [x] Sidebar com lista de conversas
- [x] Tema claro/escuro
- [x] Layout responsivo
- [ ] RAG com Qdrant/Chroma (base de conhecimento própria)
- [ ] Multi-usuário e multi-tenant
- [ ] Integração com n8n (webhooks)
- [ ] Ferramentas MCP (ações controladas pela IA)
- [ ] Plano gratuito com limites de uso

---

## Contribuindo

Pull requests são bem-vindos. Para mudanças maiores, abra uma issue primeiro para discutir o que você gostaria de mudar.

---

## Licença

MIT © 2025 Caio Maggiore
