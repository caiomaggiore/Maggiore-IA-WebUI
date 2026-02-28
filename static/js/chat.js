/**
 * chat.js — Maggiore IA Chat
 * Depende de auth.js (objeto Auth global)
 */
(function () {
  'use strict';

  // ── Estado global ─────────────────────────────────────────────────────────

  let messageHistory   = [];
  let abortController  = null;
  let isStreaming      = false;
  let currentSessionId = null;   // ID da sessão ativa
  let sessions         = [];     // lista das sessões do usuário

  // ── Helpers ───────────────────────────────────────────────────────────────

  function el(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function friendlyError(err, status) {
    if (err && err.name === 'AbortError') return null;
    if (!navigator.onLine) return 'Sem conexão com a internet. Verifique sua rede e tente novamente.';
    if (err && (err.message === 'Failed to fetch' || err.message === 'NetworkError when attempting to fetch resource.'))
      return 'Falha na conexão. Verifique sua internet e tente novamente.';
    if (status === 404) return 'Modelo não encontrado. Selecione outro modelo no menu acima.';
    if (status === 502 || status === 503) return 'Servidor Ollama indisponível. Verifique se ele está rodando.';
    if (status === 504) return 'A resposta demorou muito (timeout). Tente novamente.';
    if (status >= 500) return 'Erro interno no servidor. Tente novamente em instantes.';
    return (err && err.message) || 'Ocorreu um erro inesperado. Tente novamente.';
  }

  function showError(msg) {
    const node = el('api-error');
    if (!node) return;
    node.textContent = msg || '';
  }

  function scrollBottom() {
    const container = el('chat-messages') || el('chat-log');
    if (container) container.scrollTop = container.scrollHeight;
  }

  function formatDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const now = new Date();
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Ontem';
    if (diffDays < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }

  // ── Streaming / estado de envio ───────────────────────────────────────────

  function setStreaming(active) {
    isStreaming = active;
    const actions = document.querySelector('.chat-actions');
    const textarea = el('message-input');
    if (actions) actions.classList.toggle('is-streaming', active);
    if (textarea) textarea.disabled = active;
  }

  // ── Renderização de mensagens ─────────────────────────────────────────────

  function renderMessages() {
    const container = el('chat-log');
    if (!container) return;
    container.innerHTML = '';
    messageHistory.forEach(function (msg) {
      container.appendChild(buildBubble(msg.role, msg.content));
    });
    if (isStreaming) {
      const last = messageHistory[messageHistory.length - 1];
      if (last && last.role === 'assistant' && last.content === '') {
        const wrap = document.createElement('div');
        wrap.className = 'chat-message assistant';
        wrap.id = 'thinking-wrap';
        wrap.innerHTML =
          '<div class="thinking-indicator">IA está respondendo' +
          '<span class="thinking-dots"><span></span><span></span><span></span></span></div>';
        container.appendChild(wrap);
      }
    }
    scrollBottom();
  }

  function buildBubble(role, content) {
    const wrap = document.createElement('div');
    wrap.className = 'chat-message ' + role;
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    const sender = role === 'user' ? 'Você' : 'IA';
    bubble.innerHTML =
      '<span class="sender">' + sender + '</span>' +
      '<span class="content">' + escapeHtml(content) + '</span>';
    wrap.appendChild(bubble);
    return wrap;
  }

  function appendUserBubble(content) {
    const container = el('chat-log');
    if (!container) return;
    container.appendChild(buildBubble('user', content));
    scrollBottom();
  }

  function appendAssistantBubble() {
    const container = el('chat-log');
    if (!container) return;
    const thinkingWrap = document.createElement('div');
    thinkingWrap.className = 'chat-message assistant';
    thinkingWrap.id = 'thinking-wrap';
    thinkingWrap.innerHTML =
      '<div class="thinking-indicator">IA está respondendo' +
      '<span class="thinking-dots"><span></span><span></span><span></span></span></div>';
    container.appendChild(thinkingWrap);
    const bubble = buildBubble('assistant', '');
    bubble.id = 'assistant-bubble-active';
    bubble.style.display = 'none';
    container.appendChild(bubble);
    scrollBottom();
  }

  function appendToken(token) {
    const container = el('chat-log');
    if (!container) return;
    const thinking = el('thinking-wrap');
    if (thinking) thinking.remove();
    let bubble = el('assistant-bubble-active');
    if (!bubble) {
      bubble = buildBubble('assistant', '');
      bubble.id = 'assistant-bubble-active';
      container.appendChild(bubble);
    }
    bubble.style.display = '';
    const contentSpan = bubble.querySelector('.content');
    if (contentSpan) contentSpan.textContent += token;
    scrollBottom();
  }

  function finalizeAssistantBubble() {
    const bubble = el('assistant-bubble-active');
    if (bubble) bubble.removeAttribute('id');
    const thinking = el('thinking-wrap');
    if (thinking) thinking.remove();
  }

  // ── Sessões — sidebar ────────────────────────────────────────────────────

  async function loadSessions() {
    const listEl = el('sessions-list');
    if (!listEl) return;
    listEl.innerHTML =
      '<div class="sessions-loading">' +
      '<div class="thinking-dots"><span></span><span></span><span></span></div></div>';
    try {
      const res = await Auth.apiFetch('/v1/sessions?limit=30');
      if (!res.ok) { sessions = []; }
      else { sessions = await res.json(); }
    } catch (_) {
      sessions = [];
    }
    renderSessionsSidebar();
  }

  function renderSessionsSidebar() {
    const listEl = el('sessions-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (!sessions || sessions.length === 0) {
      listEl.innerHTML = '<p class="sessions-empty">Nenhuma conversa ainda.</p>';
      return;
    }

    sessions.forEach(function (s) {
      const item = document.createElement('div');
      item.className = 'session-item' + (s.id === currentSessionId ? ' active' : '');
      item.setAttribute('data-session-id', s.id);
      item.innerHTML =
        '<div class="session-item-icon">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
        '</div>' +
        '<div class="session-item-text">' +
          '<div class="session-item-title">' + escapeHtml(s.title || 'Conversa') + '</div>' +
          '<div class="session-item-date">' + formatDate(s.updated_at) + '</div>' +
        '</div>';
      item.addEventListener('click', function () { openSession(s.id); });
      listEl.appendChild(item);
    });
  }

  async function openSession(id) {
    if (id === currentSessionId) { closeSidebar(); return; }
    currentSessionId = id;

    // Destaca item ativo
    document.querySelectorAll('.session-item').forEach(function (item) {
      item.classList.toggle('active', parseInt(item.getAttribute('data-session-id')) === id);
    });

    // Carrega mensagens da sessão
    try {
      const res = await Auth.apiFetch('/v1/sessions/' + id);
      if (!res.ok) { showError('Não foi possível carregar a conversa.'); return; }
      const data = await res.json();
      messageHistory = (data.messages || []).map(function (m) {
        return { role: m.role, content: m.content };
      });
      renderMessages();
    } catch (err) {
      showError('Erro ao carregar a conversa.');
    }

    closeSidebar();
  }

  function newSession() {
    currentSessionId = null;
    messageHistory = [];
    renderMessages();
    renderSessionsSidebar(); // remove destaque de todos
    const input = el('message-input');
    if (input) { input.value = ''; input.focus(); }
    closeSidebar();
  }

  // ── Sidebar toggle (mobile) ───────────────────────────────────────────────

  function openSidebar() {
    const sidebar  = document.getElementById('sidebar');
    const overlay  = el('sidebar-overlay');
    if (sidebar)  sidebar.classList.add('open');
    if (overlay)  overlay.classList.add('visible');
  }

  function closeSidebar() {
    const sidebar  = document.getElementById('sidebar');
    const overlay  = el('sidebar-overlay');
    if (sidebar)  sidebar.classList.remove('open');
    if (overlay)  overlay.classList.remove('visible');
  }

  // ── Carregamento de dados ─────────────────────────────────────────────────

  async function loadUser() {
    try {
      const res = await Auth.apiFetch('/auth/me');
      if (!res.ok) return null;
      return res.json();
    } catch (_) { return null; }
  }

  // ── Model picker customizado ──────────────────────────────────────────────

  const MODEL_DESCRIPTIONS = {
    'mistral':       'Rápido e eficiente',
    'llama3:latest': 'Meta — alta qualidade',
    'llama3':        'Meta — alta qualidade',
    'gemma2':        'Google — multimodal',
    'qwen2':         'Alibaba — multilíngue',
  };

  function getModelDesc(id) { return MODEL_DESCRIPTIONS[id] || 'Modelo de linguagem'; }
  function getModelInitial(name) { return (name || '?').charAt(0).toUpperCase(); }

  function buildPicker(models) {
    const dropdown   = el('model-dropdown');
    const trigger    = el('model-picker-trigger');
    const nameEl     = el('model-picker-name');
    const hiddenInput = el('model-select');
    if (!dropdown || !trigger) return;
    dropdown.innerHTML = '';
    if (!models || models.length === 0) models = [{ id: 'mistral', name: 'Mistral' }];
    let selectedValue = hiddenInput ? hiddenInput.value : models[0].id;
    const ids = models.map(function (m) { return m.id || m.name; });
    if (!ids.includes(selectedValue)) selectedValue = ids[0];
    models.forEach(function (m) {
      const id   = m.id   || m.name || 'mistral';
      const name = m.name || m.id   || 'Modelo';
      const isSelected = (id === selectedValue);
      const li = document.createElement('li');
      li.className = 'model-dropdown-item' + (isSelected ? ' selected' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      li.setAttribute('data-value', id);
      li.innerHTML =
        '<div class="item-icon">' + getModelInitial(name) + '</div>' +
        '<div class="item-text">' +
          '<div class="item-name">' + escapeHtml(name) + '</div>' +
          '<div class="item-desc">' + escapeHtml(getModelDesc(id)) + '</div>' +
        '</div>' +
        '<svg class="item-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      li.addEventListener('click', function () { selectModel(id, name); closePicker(); });
      dropdown.appendChild(li);
    });
    const current = models.find(function (m) { return (m.id || m.name) === selectedValue; }) || models[0];
    if (nameEl) nameEl.textContent = current.name || current.id;
    if (hiddenInput) hiddenInput.value = selectedValue;
  }

  function selectModel(id, name) {
    const hiddenInput = el('model-select');
    const nameEl      = el('model-picker-name');
    if (hiddenInput) hiddenInput.value = id;
    if (nameEl) nameEl.textContent = name;
    document.querySelectorAll('.model-dropdown-item').forEach(function (item) {
      const active = item.getAttribute('data-value') === id;
      item.classList.toggle('selected', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function openPicker() {
    const dropdown = el('model-dropdown');
    const trigger  = el('model-picker-trigger');
    if (!dropdown || !trigger) return;
    dropdown.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
  }

  function closePicker() {
    const dropdown = el('model-dropdown');
    const trigger  = el('model-picker-trigger');
    if (!dropdown || !trigger) return;
    dropdown.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  function togglePicker() {
    const dropdown = el('model-dropdown');
    if (dropdown && dropdown.classList.contains('open')) closePicker();
    else openPicker();
  }

  async function loadModels() {
    try {
      const res = await Auth.apiFetch('/v1/models');
      if (!res.ok) { buildPicker([]); return; }
      const data   = await res.json();
      const all    = Array.isArray(data) ? data : (data.models || []);
      const active = all.filter(function (m) { return m && m.active !== false; });
      buildPicker(active.length ? active : []);
    } catch (err) {
      showError('Erro ao carregar modelos: ' + (err.message || ''));
      buildPicker([]);
    }
  }

  // ── Envio de mensagem ─────────────────────────────────────────────────────

  function stopGeneration() {
    if (abortController) abortController.abort();
  }

  async function sendMessage(userMsg) {
    messageHistory.push({ role: 'user', content: userMsg });
    messageHistory.push({ role: 'assistant', content: '' });
    appendUserBubble(userMsg);
    appendAssistantBubble();
    showError('');
    setStreaming(true);

    const modelSel  = el('model-select');
    const tempSlider = el('temperature-slider');
    const model = (modelSel && modelSel.value) ? modelSel.value : 'mistral';
    const temp  = tempSlider ? (parseFloat(tempSlider.value) || 0.7) : 0.7;

    const toSend = messageHistory.slice(0, -1).map(function (m) {
      return { role: m.role, content: m.content };
    });

    abortController = new AbortController();
    const timeoutId = setTimeout(function () {
      if (abortController) abortController.abort('timeout');
    }, 90000);

    try {
      const body = {
        model: model,
        messages: toSend,
        stream: true,
        options: { temperature: temp },
      };
      // Inclui session_id se houver sessão ativa
      if (currentSessionId) body.session_id = currentSessionId;

      const res = await Auth.apiFetch('/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(function () { return {}; });
        const msg = friendlyError(null, res.status) || errData.detail || 'Erro ' + res.status;
        throw Object.assign(new Error(msg), { status: res.status });
      }

      // Captura session_id do header (modo streaming)
      const headerSessionId = res.headers.get('X-Session-Id');
      if (headerSessionId) currentSessionId = parseInt(headerSessionId);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.token) {
              messageHistory[messageHistory.length - 1].content += obj.token;
              appendToken(obj.token);
            }
          } catch (_) {}
        }
      }
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer);
          if (obj.token) {
            messageHistory[messageHistory.length - 1].content += obj.token;
            appendToken(obj.token);
          }
        } catch (_) {}
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        const isTimeout = err.message === 'timeout' || (abortController && abortController.signal.reason === 'timeout');
        if (isTimeout) {
          messageHistory.pop(); messageHistory.pop();
          renderMessages();
          showError('A resposta demorou muito (timeout). Tente novamente ou escolha outro modelo.');
        } else {
          messageHistory[messageHistory.length - 1].content += '\n\n[Geração interrompida]';
          finalizeAssistantBubble();
          const bubble = el('assistant-bubble-active') || (el('chat-log') && el('chat-log').lastElementChild);
          if (bubble) {
            const span = bubble.querySelector('.content');
            if (span) span.textContent = messageHistory[messageHistory.length - 1].content;
          }
        }
      } else {
        messageHistory.pop(); messageHistory.pop();
        renderMessages();
        showError(friendlyError(err, err.status) || err.message || 'Erro ao enviar mensagem.');
      }
    } finally {
      clearTimeout(timeoutId);
      finalizeAssistantBubble();
      setStreaming(false);
      abortController = null;
      const input = el('message-input');
      if (input) input.focus();
      // Recarrega a sidebar para refletir nova sessão ou updated_at atualizado
      await loadSessions();
    }
  }

  // ── Submit / resize ───────────────────────────────────────────────────────

  function submitMessage() {
    const input = el('message-input');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    autoResizeTextarea(input);
    sendMessage(msg);
  }

  function autoResizeTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 25;
    const maxHeight  = lineHeight * 10 + 8;
    textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  // ── Inicialização ─────────────────────────────────────────────────────────

  async function init() {
    if (!Auth.getToken()) {
      window.location.href = '/static/login.html';
      return;
    }

    // Slider de temperatura
    const tempSlider = el('temperature-slider');
    if (tempSlider) {
      tempSlider.addEventListener('input', function () {
        const label = el('temp-value');
        if (label) label.textContent = tempSlider.value;
      });
    }

    // Logout
    const logoutBtn = el('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        Auth.clearToken();
        window.location.href = '/static/login.html';
      });
    }

    // Formulário de envio
    const form = el('chat-form');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); submitMessage(); });

    // Enter envia
    const textarea = el('message-input');
    if (textarea) {
      textarea.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitMessage(); }
      });
      textarea.addEventListener('input', function () { autoResizeTextarea(textarea); });
    }

    // Botão parar
    const btnStop = el('btn-stop');
    if (btnStop) btnStop.addEventListener('click', stopGeneration);

    // Nova conversa
    const btnNew = el('btn-new-session');
    if (btnNew) btnNew.addEventListener('click', newSession);

    // Sidebar (mobile)
    const btnOpen  = el('btn-open-sidebar');
    const btnClose = el('btn-close-sidebar');
    const overlay  = el('sidebar-overlay');
    if (btnOpen)  btnOpen.addEventListener('click', openSidebar);
    if (btnClose) btnClose.addEventListener('click', closeSidebar);
    if (overlay)  overlay.addEventListener('click', closeSidebar);

    // Tema
    (function () {
      const THEME_KEY = 'maggiore_theme';
      const btn = el('btn-theme');
      const iconSun  = el('icon-sun');
      const iconMoon = el('icon-moon');
      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(THEME_KEY, theme);
        if (iconSun)  iconSun.style.display  = theme === 'dark' ? 'none' : '';
        if (iconMoon) iconMoon.style.display = theme === 'dark' ? '' : 'none';
        if (btn) btn.title = theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro';
      }
      const saved = localStorage.getItem(THEME_KEY);
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(saved || (prefersDark ? 'dark' : 'light'));
      if (btn) btn.addEventListener('click', function () {
        applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
      });
    })();

    // Model picker
    const pickerTrigger = el('model-picker-trigger');
    if (pickerTrigger) pickerTrigger.addEventListener('click', function (e) { e.stopPropagation(); togglePicker(); });
    document.addEventListener('click', function (e) {
      const wrap = el('model-picker-wrap');
      if (wrap && !wrap.contains(e.target)) closePicker();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePicker(); });

    // Carrega usuário, modelos e sessões
    try {
      const user = await loadUser();
      if (!user) { window.location.href = '/static/login.html'; return; }
      const emailEl = el('user-email');
      if (emailEl) emailEl.textContent = user.email || '';
      await loadModels();
      await loadSessions();

      // Abre automaticamente a sessão mais recente (se existir)
      if (sessions && sessions.length > 0) {
        await openSession(sessions[0].id);
      }
    } catch (err) {
      showError(err.message || 'Erro ao inicializar.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
