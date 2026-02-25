/**
 * chat.js — Magggiore IA Chat
 * Depende de auth.js (objeto Auth global)
 */
(function () {
  'use strict';

  const messageHistory = [];
  let abortController = null;
  let isStreaming = false;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // Mapeia erros para mensagens amigáveis
  function friendlyError(err, status) {
    if (err && err.name === 'AbortError') {
      // Abort por timeout vs por stopGeneration
      return null; // tratado no caller
    }
    if (!navigator.onLine) {
      return 'Sem conexão com a internet. Verifique sua rede e tente novamente.';
    }
    if (err && (err.message === 'Failed to fetch' || err.message === 'NetworkError when attempting to fetch resource.')) {
      return 'Falha na conexão. Verifique sua internet e tente novamente.';
    }
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

  // ── Estado de envio ───────────────────────────────────────────────────────

  function setStreaming(active) {
    isStreaming = active;
    const actions = document.querySelector('.chat-actions');
    const textarea = el('message-input');
    if (actions) actions.classList.toggle('is-streaming', active);
    if (textarea) textarea.disabled = active;
  }

  // ── Renderização de mensagens ─────────────────────────────────────────────

  // Reconstrói todo o histórico no DOM (chamado apenas em eventos pontuais,
  // não a cada token, para evitar piscar).
  function renderMessages() {
    const container = el('chat-log');
    if (!container) return;

    container.innerHTML = '';

    messageHistory.forEach(function (msg) {
      container.appendChild(buildBubble(msg.role, msg.content));
    });

    // Placeholder "pensando" quando a IA ainda não emitiu nenhum token
    if (isStreaming) {
      const last = messageHistory[messageHistory.length - 1];
      if (last && last.role === 'assistant' && last.content === '') {
        const wrap = document.createElement('div');
        wrap.className = 'chat-message assistant';
        wrap.id = 'thinking-wrap';
        wrap.innerHTML =
          '<div class="thinking-indicator">IA está respondendo' +
          '<span class="thinking-dots">' +
          '<span></span><span></span><span></span>' +
          '</span></div>';
        container.appendChild(wrap);
      }
    }

    scrollBottom();
  }

  // Cria o elemento de bolha de uma mensagem
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

  // Adiciona uma bolha de usuário ao final do DOM (sem reconstruir tudo)
  function appendUserBubble(content) {
    const container = el('chat-log');
    if (!container) return;
    container.appendChild(buildBubble('user', content));
    scrollBottom();
  }

  // Adiciona a bolha vazia da IA + indicador pensando
  function appendAssistantBubble() {
    const container = el('chat-log');
    if (!container) return;

    // Indicador pensando
    const thinkingWrap = document.createElement('div');
    thinkingWrap.className = 'chat-message assistant';
    thinkingWrap.id = 'thinking-wrap';
    thinkingWrap.innerHTML =
      '<div class="thinking-indicator">IA está respondendo' +
      '<span class="thinking-dots"><span></span><span></span><span></span></span>' +
      '</div>';
    container.appendChild(thinkingWrap);

    // Bolha real da resposta (começa oculta)
    const bubble = buildBubble('assistant', '');
    bubble.id = 'assistant-bubble-active';
    bubble.style.display = 'none';
    container.appendChild(bubble);

    scrollBottom();
  }

  // Recebe um token e atualiza a bolha ativa da IA em-place (sem piscar)
  function appendToken(token) {
    const container = el('chat-log');
    if (!container) return;

    // Esconde o indicador pensando assim que o primeiro token chega
    const thinking = el('thinking-wrap');
    if (thinking) thinking.remove();

    let bubble = el('assistant-bubble-active');
    if (!bubble) {
      // Fallback: cria a bolha se não existir
      bubble = buildBubble('assistant', '');
      bubble.id = 'assistant-bubble-active';
      container.appendChild(bubble);
    }
    bubble.style.display = '';

    const contentSpan = bubble.querySelector('.content');
    if (contentSpan) {
      // textContent acumula os tokens sem reconstruir o DOM
      contentSpan.textContent += token;
    }

    scrollBottom();
  }

  // Finaliza: remove o id temporário da bolha ativa
  function finalizeAssistantBubble() {
    const bubble = el('assistant-bubble-active');
    if (bubble) bubble.removeAttribute('id');
    const thinking = el('thinking-wrap');
    if (thinking) thinking.remove();
  }

  // ── Carregamento de dados ─────────────────────────────────────────────────

  async function loadUser() {
    try {
      const res = await Auth.apiFetch('/auth/me');
      if (!res.ok) return null;
      return res.json();
    } catch (err) {
      return null;
    }
  }

  // ── Model picker customizado ──────────────────────────────────────────────

  // Descrições amigáveis para cada modelo (por ID ou nome)
  const MODEL_DESCRIPTIONS = {
    'mistral':       'Rápido e eficiente',
    'llama3:latest': 'Meta — alta qualidade',
    'llama3':        'Meta — alta qualidade',
    'gemma2':        'Google — multimodal',
    'qwen2':         'Alibaba — multilíngue',
  };

  function getModelDesc(id) {
    return MODEL_DESCRIPTIONS[id] || 'Modelo de linguagem';
  }

  function getModelInitial(name) {
    return (name || '?').charAt(0).toUpperCase();
  }

  // Reconstrói o dropdown e a face do trigger
  function buildPicker(models) {
    const dropdown = el('model-dropdown');
    const trigger  = el('model-picker-trigger');
    const nameEl   = el('model-picker-name');
    const hiddenInput = el('model-select');
    if (!dropdown || !trigger) return;

    dropdown.innerHTML = '';

    if (!models || models.length === 0) {
      models = [{ id: 'mistral', name: 'Mistral' }];
    }

    let selectedValue = hiddenInput ? hiddenInput.value : models[0].id;
    // Garante que o valor salvo exista na lista
    const ids = models.map(function (m) { return m.id || m.name; });
    if (!ids.includes(selectedValue)) selectedValue = ids[0];

    models.forEach(function (m, i) {
      const id   = m.id   || m.name || 'mistral';
      const name = m.name || m.id   || 'Modelo';
      const desc = getModelDesc(id);
      const init = getModelInitial(name);
      const isSelected = (id === selectedValue);

      const li = document.createElement('li');
      li.className = 'model-dropdown-item' + (isSelected ? ' selected' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      li.setAttribute('data-value', id);
      li.innerHTML =
        '<div class="item-icon">' + init + '</div>' +
        '<div class="item-text">' +
          '<div class="item-name">' + escapeHtml(name) + '</div>' +
          '<div class="item-desc">' + escapeHtml(desc) + '</div>' +
        '</div>' +
        '<svg class="item-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

      li.addEventListener('click', function () {
        selectModel(id, name);
        closePicker();
      });

      dropdown.appendChild(li);
    });

    // Atualiza face com o selecionado atual
    const current = models.find(function (m) { return (m.id || m.name) === selectedValue; }) || models[0];
    if (nameEl) nameEl.textContent = current.name || current.id;
    if (hiddenInput) hiddenInput.value = selectedValue;
  }

  function selectModel(id, name) {
    const hiddenInput = el('model-select');
    const nameEl      = el('model-picker-name');
    if (hiddenInput) hiddenInput.value = id;
    if (nameEl) nameEl.textContent = name;

    // Atualiza estado visual dos itens
    const items = document.querySelectorAll('.model-dropdown-item');
    items.forEach(function (item) {
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
    if (dropdown && dropdown.classList.contains('open')) {
      closePicker();
    } else {
      openPicker();
    }
  }

  async function loadModels() {
    try {
      const res = await Auth.apiFetch('/v1/models');
      if (!res.ok) {
        buildPicker([]);
        return;
      }
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
    // Adiciona ao histórico
    messageHistory.push({ role: 'user', content: userMsg });
    messageHistory.push({ role: 'assistant', content: '' });

    // Atualiza DOM de forma cirúrgica (sem reconstruir tudo)
    appendUserBubble(userMsg);
    appendAssistantBubble();

    showError('');
    setStreaming(true);

    const modelSel = el('model-select');
    const tempSlider = el('temperature-slider');
    const model = (modelSel && modelSel.value) ? modelSel.value : 'mistral';
    const temp = tempSlider ? (parseFloat(tempSlider.value) || 0.7) : 0.7;

    // Manda o histórico até antes do placeholder vazio da IA
    const toSend = messageHistory.slice(0, -1).map(function (m) {
      return { role: m.role, content: m.content };
    });

    abortController = new AbortController();

    // Timeout de 90 segundos
    const timeoutId = setTimeout(function () {
      if (abortController) abortController.abort('timeout');
    }, 90000);

    try {
      const res = await Auth.apiFetch('/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          messages: toSend,
          stream: true,
          options: { temperature: temp },
        }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(function () { return {}; });
        const msg = friendlyError(null, res.status) || errData.detail || 'Erro ' + res.status;
        throw Object.assign(new Error(msg), { status: res.status });
      }

      const reader = res.body.getReader();
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
              // Acumula no histórico
              messageHistory[messageHistory.length - 1].content += obj.token;
              // Atualiza só o span do último bubble (sem piscar)
              appendToken(obj.token);
            }
          } catch (_) {}
        }
      }

      // Flush do buffer restante
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
          // Timeout: remove placeholder, mostra erro
          messageHistory.pop();
          messageHistory.pop();
          renderMessages();
          showError('A resposta demorou muito (timeout). Tente novamente ou escolha outro modelo.');
        } else {
          // Interrompido pelo usuário
          messageHistory[messageHistory.length - 1].content += '\n\n[Geração interrompida]';
          finalizeAssistantBubble();
          const bubble = el('assistant-bubble-active') || (el('chat-log') && el('chat-log').lastElementChild);
          if (bubble) {
            const span = bubble.querySelector('.content');
            if (span) span.textContent = messageHistory[messageHistory.length - 1].content;
          }
        }
      } else {
        // Erro de rede, servidor ou modelo
        messageHistory.pop();
        messageHistory.pop();
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
    }
  }

  // ── Submit helper ─────────────────────────────────────────────────────────

  function submitMessage() {
    const input = el('message-input');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    sendMessage(msg);
  }

  // ── Inicialização ─────────────────────────────────────────────────────────

  async function init() {
    // Guarda de autenticação: redireciona se não há token
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

    // Botão Sair
    const logoutBtn = el('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        Auth.clearToken();
        window.location.href = '/static/login.html';
      });
    }

    // Formulário de envio
    const form = el('chat-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        submitMessage();
      });
    }

    // Enter envia (Shift+Enter = nova linha)
    const textarea = el('message-input');
    if (textarea) {
      textarea.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submitMessage();
        }
      });
    }

    // Botão parar geração
    const btnStop = el('btn-stop');
    if (btnStop) {
      btnStop.addEventListener('click', stopGeneration);
    }

    // Toggle de tema claro/escuro
    (function () {
      const THEME_KEY = 'maggiore_theme';
      const btn = el('btn-theme');
      const iconSun  = el('icon-sun');
      const iconMoon = el('icon-moon');

      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(THEME_KEY, theme);
        if (iconSun)  iconSun.style.display  = theme === 'dark' ? 'none'  : '';
        if (iconMoon) iconMoon.style.display = theme === 'dark' ? ''      : 'none';
        if (btn) btn.title = theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro';
      }

      const saved = localStorage.getItem(THEME_KEY);
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(saved || (prefersDark ? 'dark' : 'light'));

      if (btn) {
        btn.addEventListener('click', function () {
          const current = document.documentElement.getAttribute('data-theme');
          applyTheme(current === 'dark' ? 'light' : 'dark');
        });
      }
    })();

    // Model picker: abrir/fechar
    const pickerTrigger = el('model-picker-trigger');
    if (pickerTrigger) {
      pickerTrigger.addEventListener('click', function (e) {
        e.stopPropagation();
        togglePicker();
      });
    }
    // Fechar ao clicar fora
    document.addEventListener('click', function (e) {
      const wrap = el('model-picker-wrap');
      if (wrap && !wrap.contains(e.target)) closePicker();
    });
    // Fechar com Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePicker();
    });

    // Carrega usuário e modelos
    try {
      const user = await loadUser();
      if (!user) {
        window.location.href = '/static/login.html';
        return;
      }
      const emailEl = el('user-email');
      if (emailEl) emailEl.textContent = user.email || '';
      await loadModels();
    } catch (err) {
      // 401 já é tratado em Auth.apiFetch (redireciona automaticamente)
      showError(err.message || 'Erro ao inicializar.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
