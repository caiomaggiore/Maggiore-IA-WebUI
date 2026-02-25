const API = '';
const TOKEN_KEY = 'saas_ia_token';

let accessToken = localStorage.getItem(TOKEN_KEY);
let messageHistory = [];

function setToken(t) {
  accessToken = t;
  if (t) localStorage.setItem(TOKEN_KEY, t);
}

function clearToken() {
  accessToken = null;
  localStorage.removeItem(TOKEN_KEY);
}

function showLogin() {
  const loginSection = document.getElementById('login-section');
  if (loginSection) {
    loginSection.style.display = 'flex';
    const chatSection = document.getElementById('chat-section');
    if (chatSection) chatSection.style.display = 'none';
  } else {
    window.location.href = '/static/login.html';
  }
}

function showChat() {
  const loginSection = document.getElementById('login-section');
  const chatSection = document.getElementById('chat-section');
  if (loginSection) loginSection.style.display = 'none';
  if (chatSection) chatSection.style.display = 'flex';
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

function setSending(sending) {
  const btn = document.getElementById('btn-enviar');
  const thinking = document.getElementById('thinking');
  if (btn) btn.disabled = sending;
  if (thinking) thinking.style.display = sending ? 'block' : 'none';
}

async function apiFetch(url, opts = {}) {
  const h = { ...opts.headers };
  if (accessToken) h['Authorization'] = `Bearer ${accessToken}`;
  const res = await fetch(`${API}${url}`, { ...opts, headers: h });
  if (res.status === 401) {
    clearToken();
    showLogin();
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  if (res.status >= 500) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Erro no servidor (${res.status}). Tente novamente mais tarde.`);
  }
  return res;
}

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Login falhou');
  }
  const data = await res.json();
  setToken(data.access_token);
}

async function loadMe() {
  if (!accessToken) return null;
  const res = await apiFetch('/auth/me');
  if (!res.ok) return null;
  return res.json();
}

async function loadModels() {
  const sel = document.getElementById('model-select');
  if (!sel) return;
  try {
    const res = await apiFetch('/v1/models');
    if (!res.ok) {
      addFallbackModel(sel);
      return;
    }
    const data = await res.json();
    const models = Array.isArray(data) ? data : (data.models || []);
    sel.innerHTML = '';
    const active = models.filter(m => m && m.active !== false);
    if (active.length === 0) {
      addFallbackModel(sel);
      return;
    }
    active.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id || m.name || 'mistral';
      opt.textContent = m.name || m.id || 'Modelo';
      sel.appendChild(opt);
    });
  } catch (err) {
    showError('api-error', err.message);
    addFallbackModel(sel);
  }
}

function addFallbackModel(sel) {
  if (!sel || sel.options.length > 0) return;
  const opt = document.createElement('option');
  opt.value = 'mistral';
  opt.textContent = 'Mistral';
  sel.appendChild(opt);
}

function submitMessage() {
  const input = document.getElementById('message-input');
  const msg = input ? input.value.trim() : '';
  if (!msg) return;
  input.value = '';
  sendChatStream(msg);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function renderMessages() {
  const container = document.getElementById('chat-log');
  if (!container) return;
  container.innerHTML = '';
  messageHistory.forEach(({ role, content }) => {
    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;
    const label = role === 'user' ? 'Você' : 'IA';
    div.innerHTML = `<strong>${label}</strong><div class="content">${escapeHtml(content)}</div>`;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

async function sendChatStream(userMsg) {
  messageHistory.push({ role: 'user', content: userMsg });
  messageHistory.push({ role: 'assistant', content: '' });
  renderMessages();
  showError('api-error');
  setSending(true);

  const modelSel = document.getElementById('model-select');
  const tempSlider = document.getElementById('temperature-slider');
  const model = modelSel ? modelSel.value || 'mistral' : 'mistral';
  const temp = tempSlider ? parseFloat(tempSlider.value) || 0.7 : 0.7;
  const toSend = messageHistory.slice(0, -1).map(m => ({ role: m.role, content: m.content }));

  try {
    const res = await apiFetch('/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: toSend,
        stream: true,
        options: { temperature: temp },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Erro ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.token) {
            messageHistory[messageHistory.length - 1].content += obj.token;
            renderMessages();
          }
        } catch (_) {}
      }
    }
    if (buffer.trim()) {
      try {
        const obj = JSON.parse(buffer);
        if (obj.token) {
          messageHistory[messageHistory.length - 1].content += obj.token;
          renderMessages();
        }
      } catch (_) {}
    }
  } catch (err) {
    messageHistory.pop();
    messageHistory.pop();
    renderMessages();
    showError('api-error', err.message);
  } finally {
    setSending(false);
  }
}

function init() {
  const loginForm = document.getElementById('login-form');
  const logoutBtn = document.getElementById('logout');
  const tempSlider = document.getElementById('temperature-slider');
  const chatForm = document.getElementById('chat-form');

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      showError('login-error');
      try {
        await login(email, password);
        const emailEl = document.getElementById('user-email');
        if (emailEl) emailEl.textContent = email;
        showChat();
        await loadModels();
      } catch (err) {
        showError('login-error', err.message);
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.type = 'button';
    logoutBtn.addEventListener('click', () => {
      clearToken();
      messageHistory = [];
      window.location.href = '/static/login.html';
    });
  }

  if (tempSlider) {
    tempSlider.addEventListener('input', (e) => {
      const valEl = document.getElementById('temp-value');
      if (valEl) valEl.textContent = e.target.value;
    });
  }

  if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      submitMessage();
    });
    const input = document.getElementById('message-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submitMessage();
        }
      });
    }
  }

  (async () => {
    if (!accessToken) {
      showLogin();
      return;
    }
    try {
      const user = await loadMe();
      if (!user) {
        showLogin();
        return;
      }
      const emailEl = document.getElementById('user-email');
      if (emailEl) emailEl.textContent = user.email;
      if (document.getElementById('login-section')) showChat();
      await loadModels();
    } catch (err) {
      showLogin();
    }
  })();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
