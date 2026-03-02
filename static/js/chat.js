/**
 * chat.js — Aurion IA Chat
 * Depende de auth.js (objeto Auth global)
 */
(function () {
  'use strict';

  // ── Estado global ─────────────────────────────────────────────────────────

  let messageHistory   = [];
  let abortController  = null;
  let isStreaming      = false;
  let currentSessionId   = null;   // ID da sessão ativa
  let currentSessionTitle = null;  // título da sessão ativa (para o header)
  let sessions           = [];     // lista das sessões do usuário
  let currentUser        = null;   // { email, full_name } de /auth/me para displayName

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

  function formatGroupLabel(isoStr) {
    if (!isoStr) return 'Outras';
    const d = new Date(isoStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.floor((today - dayStart) / 86400000);
    if (diffDays === 0) return 'Hoje';
    if (diffDays === 1) return 'Ontem';
    if (diffDays > 1 && diffDays < 7) return 'Esta semana';
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }

  function groupSessionsForSidebar(list) {
    const archived = list.filter(function (s) { return s.is_archived; });
    const active = list.filter(function (s) { return !s.is_archived; });
    const pinned = active.filter(function (s) { return s.is_pinned; });
    const rest = active.filter(function (s) { return !s.is_pinned; });
    const byLabel = {};
    const order = [];
    rest.forEach(function (s) {
      const at = s.last_message_at || s.updated_at || s.created_at;
      const label = formatGroupLabel(at);
      if (!byLabel[label]) { byLabel[label] = []; order.push(label); }
      byLabel[label].push(s);
    });
    return {
      pinned: pinned,
      groups: order.map(function (label) { return { label: label, sessions: byLabel[label] }; }),
      archived: archived,
    };
  }

  function showToast(msg, isError) {
    const existing = document.getElementById('toast-msg');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'toast-msg';
    toast.className = 'toast-msg' + (isError ? ' toast-error' : '');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 3500);
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
      if (msg.role === 'assistant' && msg.thinking_summary) {
        container.appendChild(buildThinkingBlockFromMessage(msg));
      }
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

  function buildThinkingBlockFromMessage(msg) {
    var timeMs = msg.thinking_time_ms || 0;
    var secs = (timeMs / 1000).toFixed(1);
    var summaryHtml = formatThinkingSummaryAsParagraphs(msg.thinking_summary || '');
    var wrap = document.createElement('div');
    wrap.className = 'chat-message assistant';
    wrap.innerHTML =
      '<div class="chat-thinking-block" data-thinking-block>' +
        '<div class="chat-thinking-header">' +
          '<span class="chat-thinking-status"><span class="chat-thinking-status-text">Pensado por ' + secs + 's</span></span>' +
          '<button type="button" class="chat-thinking-chevron-btn" data-toggle-analysis aria-label="Expandir pensamento"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>' +
        '</div>' +
        '<div class="chat-thinking-body"><div class="chat-thinking-summary" data-summary>' + summaryHtml + '</div></div>' +
      '</div>';
    var block = wrap.querySelector('[data-thinking-block]');
    var btn = block && block.querySelector('[data-toggle-analysis]');
    if (btn) {
      btn.addEventListener('click', function () {
        block.classList.toggle('expanded');
        btn.setAttribute('aria-label', block.classList.contains('expanded') ? 'Recolher pensamento' : 'Expandir pensamento');
      });
    }
    return wrap;
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

  var currentThinkingBlock = null;

  function formatThinkingSummaryAsParagraphs(text) {
    if (!text) return '';
    var paras = text.split(/\n\n+/);
    return paras.map(function (p) { return '<p>' + escapeHtml(p.trim()) + '</p>'; }).join('');
  }

  function appendAssistantBubble(thinkingActive) {
    currentThinkingBlock = null;
    const container = el('chat-log');
    if (!container) return;
    const thinkingWrap = document.createElement('div');
    thinkingWrap.className = 'chat-message assistant';
    thinkingWrap.id = 'thinking-wrap';
    if (thinkingActive) {
      thinkingWrap.innerHTML =
        '<div class="thinking-indicator">' +
        '<span class="chat-thinking-atom"><span class="chat-thinking-brain-icon" role="img" aria-hidden="true"></span></span>' +
        '<span class="chat-thinking-status-text pensando-shine">Pensando</span></div>';
    } else {
      thinkingWrap.innerHTML =
        '<div class="thinking-indicator">IA está respondendo' +
        '<span class="thinking-dots"><span></span><span></span><span></span></span></div>';
    }
    container.appendChild(thinkingWrap);
    const bubble = buildBubble('assistant', '');
    bubble.id = 'assistant-bubble-active';
    bubble.style.display = 'none';
    container.appendChild(bubble);
    scrollBottom();
  }

  function ensureThinkingBlockAndAppendToken(token) {
    var wrap = el('thinking-wrap');
    if (!wrap) return;
    var block = wrap.querySelector('[data-thinking-block]');
    if (!block) {
      wrap.className = 'chat-message assistant';
      wrap.id = 'thinking-wrap';
      wrap.innerHTML =
        '<div class="chat-thinking-block" data-thinking-block>' +
          '<div class="chat-thinking-header">' +
            '<span class="chat-thinking-status"><span class="chat-thinking-atom"><span class="chat-thinking-brain-icon" role="img" aria-hidden="true"></span></span><span class="chat-thinking-status-text pensando-shine">Pensando</span></span>' +
            '<button type="button" class="chat-thinking-chevron-btn" data-toggle-analysis aria-label="Expandir pensamento"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>' +
          '</div>' +
          '<div class="chat-thinking-body"><div class="chat-thinking-summary" data-summary></div></div>' +
        '</div>';
      block = wrap.querySelector('[data-thinking-block]');
      var chevronBtn = block.querySelector('[data-toggle-analysis]');
      if (chevronBtn) {
        chevronBtn.addEventListener('click', function () {
          block.classList.toggle('expanded');
          chevronBtn.setAttribute('aria-label', block.classList.contains('expanded') ? 'Recolher pensamento' : 'Expandir pensamento');
        });
      }
      block.classList.add('expanded');
      currentThinkingBlock = block;
    }
    var summaryEl = block.querySelector('[data-summary]');
    if (summaryEl) summaryEl.innerHTML += escapeHtml(token);
    scrollBottom();
  }

  function showThinkingAnalysis(data) {
    const wrap = el('thinking-wrap');
    if (!wrap) return;
    var timeMs = data.thinking_time_ms || 0;
    var secs = (timeMs / 1000).toFixed(1);
    var summaryHtml = formatThinkingSummaryAsParagraphs(data.analysis_summary || '');
    var block = wrap.querySelector('[data-thinking-block]');
    if (block) {
      var statusWrap = block.querySelector('.chat-thinking-status');
      if (statusWrap) {
        statusWrap.innerHTML = '<span class="chat-thinking-status-text">Pensado por ' + secs + 's</span>';
      }
      var summaryEl = block.querySelector('[data-summary]');
      if (summaryEl) summaryEl.innerHTML = summaryHtml || summaryEl.innerHTML;
      block.classList.remove('expanded');
      var chevronBtn = block.querySelector('[data-toggle-analysis]');
      if (chevronBtn) chevronBtn.setAttribute('aria-label', 'Expandir pensamento');
    } else {
      wrap.className = 'chat-message assistant';
      wrap.id = 'thinking-wrap';
      wrap.innerHTML =
        '<div class="chat-thinking-block" data-thinking-block>' +
          '<div class="chat-thinking-header">' +
            '<span class="chat-thinking-status"><span class="chat-thinking-status-text">Pensado por ' + secs + 's</span></span>' +
            '<button type="button" class="chat-thinking-chevron-btn" data-toggle-analysis aria-label="Expandir pensamento"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>' +
          '</div>' +
          '<div class="chat-thinking-body"><div class="chat-thinking-summary" data-summary>' + summaryHtml + '</div></div>' +
        '</div>';
      block = wrap.querySelector('[data-thinking-block]');
      var btn = block.querySelector('[data-toggle-analysis]');
      if (btn) {
        btn.addEventListener('click', function () {
          block.classList.toggle('expanded');
          btn.setAttribute('aria-label', block.classList.contains('expanded') ? 'Recolher pensamento' : 'Expandir pensamento');
        });
      }
    }
    currentThinkingBlock = null;
    scrollBottom();
  }

  function finishThinkingStatus() {
    if (currentThinkingBlock) {
      var statusText = currentThinkingBlock.querySelector('.chat-thinking-status-text');
      if (statusText && statusText.classList.contains('pensando-shine')) {
        var timeEl = currentThinkingBlock.querySelector('[data-timer]');
        var secs = timeEl ? timeEl.textContent : '0';
        statusText.classList.remove('pensando-shine');
        statusText.textContent = 'Pensado por ' + secs;
      }
      currentThinkingBlock = null;
    }
  }

  function appendToken(token) {
    const container = el('chat-log');
    if (!container) return;
    var thinkingBlock = container.querySelector('.chat-thinking-block');
    if (thinkingBlock) {
      finishThinkingStatus();
    }
    const thinking = el('thinking-wrap');
    if (thinking && !thinking.querySelector('.chat-thinking-block')) thinking.remove();
    else if (thinking && thinking.querySelector('.chat-thinking-block')) {
      thinking.removeAttribute('id');
    }
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
    if (thinking && !thinking.querySelector('.chat-thinking-block')) thinking.remove();
    else if (thinking) thinking.removeAttribute('id');
  }

  // ── Empty state ──────────────────────────────────────────────────────────

  function updateHeaderTitle() {
    const titleEl = el('chat-header-title');
    if (!titleEl) return;
    if (currentSessionTitle) titleEl.textContent = currentSessionTitle;
    else titleEl.innerHTML = '<span class="brand-aurion">Aurion</span> <span class="brand-ia">IA</span>';
  }

  function getDisplayName() {
    if (currentUser) {
      const nick = (currentUser.nickname || '').trim();
      if (nick) return nick;
      const first = (currentUser.first_name || '').trim();
      const last = (currentUser.last_name || '').trim();
      if (first || last) return (first + ' ' + last).trim();
      if (currentUser.full_name && currentUser.full_name.trim()) return currentUser.full_name.trim();
      if (currentUser.email) return currentUser.email;
    }
    return 'você';
  }

  function getInitials() {
    if (!currentUser) return '?';
    const name = getDisplayName();
    if (name === (currentUser.email || '')) return name.charAt(0).toUpperCase();
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    return name.charAt(0).toUpperCase();
  }

  function updateSidebarUser() {
    var nameEl = el('sidebar-user-name');
    var emailEl = el('sidebar-user-email');
    var avatarEl = el('sidebar-user-avatar');
    if (nameEl) nameEl.textContent = getDisplayName();
    if (emailEl) emailEl.textContent = currentUser ? (currentUser.email || '') : '';
    if (avatarEl) avatarEl.textContent = getInitials();
  }

  function updateEmptyState() {
    const emptyState = el('empty-state');
    const footer     = el('chat-footer');
    const titleEl    = el('empty-state-title');
    const isEmpty    = messageHistory.length === 0;

    if (titleEl) titleEl.textContent = 'Como posso te ajudar, ' + getDisplayName() + '?';

    if (emptyState) {
      emptyState.setAttribute('aria-hidden', isEmpty ? 'false' : 'true');
    }
    if (footer) {
      footer.classList.toggle('hidden-footer', isEmpty);
    }
  }

  // ── Sessões — sidebar ────────────────────────────────────────────────────

  var archivedSessions = [];

  async function loadSessions(searchQ) {
    const listEl = el('sessions-list');
    if (!listEl) return;
    listEl.innerHTML =
      '<div class="sessions-loading">' +
      '<div class="thinking-dots"><span></span><span></span><span></span></div></div>';
    try {
      let url = '/v1/sessions?limit=50';
      if (searchQ && searchQ.trim()) url += '&q=' + encodeURIComponent(searchQ.trim());
      const res = await Auth.apiFetch(url);
      if (!res.ok) { sessions = []; }
      else { sessions = await res.json(); }
    } catch (_) {
      sessions = [];
    }
    renderSessionsSidebar();
  }

  async function loadArchivedSessions(searchQ) {
    const listEl = document.getElementById('sessions-archived-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="sessions-loading"><div class="thinking-dots"><span></span><span></span><span></span></div></div>';
    try {
      let url = '/v1/sessions?limit=50&include_archived=true';
      if (searchQ && searchQ.trim()) url += '&q=' + encodeURIComponent(searchQ.trim());
      const res = await Auth.apiFetch(url);
      if (!res.ok) { archivedSessions = []; }
      else {
        const all = await res.json();
        archivedSessions = all.filter(function (s) { return s.is_archived; });
      }
    } catch (_) {
      archivedSessions = [];
    }
    renderArchivedList();
  }

  function renderSessionItem(s, listEl, isArchived) {
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === currentSessionId ? ' active' : '') + (isArchived ? ' session-item-archived' : '');
    item.setAttribute('data-session-id', s.id);

    const at = s.last_message_at || s.updated_at || s.created_at;
    const title = s.title || 'Conversa';
    const chatIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    const pencilIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    const dotsIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>';

    item.innerHTML =
      '<div class="session-item-row">' +
        '<div class="session-item-icon">' + chatIcon + '</div>' +
        '<div class="session-item-text">' +
          '<div class="session-item-title" data-title>' + escapeHtml(title) + '</div>' +
          '<div class="session-item-date">' + formatDate(at) + '</div>' +
        '</div>' +
        '<div class="session-item-actions">' +
          '<button type="button" class="session-item-btn-icon btn-rename" title="Renomear" aria-label="Renomear">' + pencilIcon + '</button>' +
          '<button type="button" class="session-item-btn-icon btn-menu" title="Mais opções" aria-label="Mais opções">' + dotsIcon + '</button>' +
        '</div>' +
      '</div>';

    const row = item.querySelector('.session-item-row');
    const titleEl = item.querySelector('[data-title]');
    const textBlock = item.querySelector('.session-item-text');

    row.addEventListener('click', function (e) {
      if (e.target.closest('.session-item-actions')) return;
      openSession(s.id);
    });

    titleEl.addEventListener('dblclick', function (e) { e.stopPropagation(); startRename(s, item, titleEl, textBlock); });

    item.querySelector('.btn-rename').addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); startRename(s, item, titleEl, textBlock); });

    item.querySelector('.btn-menu').addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      openContextMenu(s, e.currentTarget, item);
    });

    listEl.appendChild(item);
  }

  function startRename(s, item, titleEl, textBlock) {
    const oldTitle = s.title || 'Conversa';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'session-item-title-edit';
    input.value = oldTitle;
    input.setAttribute('data-session-id', s.id);

    function cancel() {
      textBlock.innerHTML = '<div class="session-item-title" data-title>' + escapeHtml(oldTitle) + '</div><div class="session-item-date">' + formatDate(s.last_message_at || s.updated_at || s.created_at) + '</div>';
      const newTitleEl = item.querySelector('[data-title]');
      newTitleEl.addEventListener('dblclick', function (ev) { ev.stopPropagation(); startRename(s, item, newTitleEl, textBlock); });
    }

    function submit() {
      const newTitle = input.value.trim() || 'Conversa';
      Auth.apiFetch('/v1/sessions/' + s.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      }).then(function (res) {
        if (!res.ok) throw new Error('Falha ao renomear');
        return res.json();
      }).then(function () {
        s.title = newTitle;
        textBlock.innerHTML = '<div class="session-item-title" data-title>' + escapeHtml(newTitle) + '</div><div class="session-item-date">' + formatDate(s.last_message_at || s.updated_at || s.created_at) + '</div>';
        const newTitleEl = item.querySelector('[data-title]');
        newTitleEl.addEventListener('dblclick', function (ev) { ev.stopPropagation(); startRename(s, item, newTitleEl, textBlock); });
      }).catch(function () {
        showToast('Não foi possível renomear. Tente novamente.', true);
        cancel();
      });
    }

    textBlock.innerHTML = '';
    textBlock.appendChild(input);
    input.focus();
    input.select();

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', function () { submit(); });
  }

  function openContextMenu(s, buttonEl, itemEl) {
    const existing = document.getElementById('session-context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('ul');
    menu.id = 'session-context-menu';
    menu.className = 'session-context-menu';
    const rect = buttonEl.getBoundingClientRect();

    const pinLabel = s.is_pinned ? 'Desafixar' : 'Fixar no topo';
    const archiveLabel = s.is_archived ? 'Desarquivar conversa' : 'Arquivar conversa';
    const archiveAction = s.is_archived ? 'unarchive' : 'archive';
    menu.innerHTML =
      '<li><button type="button" data-action="pin">' + pinLabel + '</button></li>' +
      '<li><button type="button" data-action="' + archiveAction + '">' + archiveLabel + '</button></li>' +
      '<li><button type="button" data-action="delete" class="danger">Excluir definitivamente</button></li>';

    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.bottom + 4) + 'px';

    function close() {
      menu.remove();
      document.removeEventListener('click', close);
    }

    function getSearchQ() {
      var searchEl = document.getElementById('sessions-search');
      return searchEl ? searchEl.value.trim() : '';
    }

    function refreshLists() {
      loadSessions(getSearchQ());
      var content = document.getElementById('sidebar-archived-content');
      if (content && !content.hidden) {
        loadArchivedSessions(getSearchQ());
      }
    }

    menu.querySelector('[data-action="pin"]').addEventListener('click', function () {
      close();
      Auth.apiFetch('/v1/sessions/' + s.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_pinned: !s.is_pinned }) })
        .then(function (res) { if (!res.ok) throw new Error(); return res.json(); })
        .then(function () { refreshLists(); })
        .catch(function () { showToast('Não foi possível atualizar.', true); });
    });
    (function () {
      var archiveBtn = menu.querySelector('[data-action="archive"]');
      var unarchiveBtn = menu.querySelector('[data-action="unarchive"]');
      function doArchive(value) {
        close();
        Auth.apiFetch('/v1/sessions/' + s.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_archived: value }) })
          .then(function (res) { if (!res.ok) throw new Error(); return res.json(); })
          .then(function () {
            if (currentSessionId === s.id) { newSession(); }
            refreshLists();
          })
          .catch(function () { showToast(value ? 'Não foi possível arquivar.' : 'Não foi possível desarquivar.', true); });
      }
      if (archiveBtn) archiveBtn.addEventListener('click', function () { doArchive(true); });
      if (unarchiveBtn) unarchiveBtn.addEventListener('click', function () { doArchive(false); });
    })();
    menu.querySelector('[data-action="delete"]').addEventListener('click', function () {
      close();
      Auth.apiFetch('/v1/sessions/' + s.id, { method: 'DELETE' })
        .then(function (res) { if (!res.ok) throw new Error(); })
        .then(function () {
          if (currentSessionId === s.id) { newSession(); }
          refreshLists();
        })
        .catch(function () { showToast('Não foi possível excluir.', true); });
    });

    document.body.appendChild(menu);
    setTimeout(function () { document.addEventListener('click', close); }, 0);
  }

  function renderSessionsSidebar() {
    const listEl = el('sessions-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (!sessions || sessions.length === 0) {
      listEl.innerHTML = '<p class="sessions-empty">Nenhuma conversa ainda.</p>';
      return;
    }

    const grouped = groupSessionsForSidebar(sessions);

    if (grouped.pinned.length > 0) {
      const label = document.createElement('p');
      label.className = 'sessions-group-label';
      label.textContent = 'Fixadas';
      listEl.appendChild(label);
      grouped.pinned.forEach(function (s) { renderSessionItem(s, listEl); });
    }

    grouped.groups.forEach(function (g) {
      const label = document.createElement('p');
      label.className = 'sessions-group-label';
      label.textContent = g.label;
      listEl.appendChild(label);
      g.sessions.forEach(function (s) { renderSessionItem(s, listEl); });
    });
  }

  function renderArchivedList() {
    const listEl = document.getElementById('sessions-archived-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!archivedSessions || archivedSessions.length === 0) {
      listEl.innerHTML = '<p class="sessions-empty">Nenhuma conversa arquivada.</p>';
      return;
    }
    archivedSessions.forEach(function (s) { renderSessionItem(s, listEl, true); });
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
      currentSessionTitle = data.title || 'Conversa';
      messageHistory = (data.messages || []).map(function (m) {
        return {
          role: m.role,
          content: m.content,
          thinking_summary: m.thinking_summary || null,
          thinking_time_ms: m.thinking_time_ms != null ? m.thinking_time_ms : null,
          thinking_level: m.thinking_level || null
        };
      });
      renderMessages();
      updateEmptyState();
      updateHeaderTitle();
    } catch (err) {
      showError('Erro ao carregar a conversa.');
    }

    closeSidebar();
  }

  function newSession() {
    currentSessionId = null;
    currentSessionTitle = null;
    messageHistory = [];
    renderMessages();
    updateEmptyState();
    renderSessionsSidebar(); // remove destaque de todos
    const input = el('message-input');
    const emptyInput = el('empty-state-input');
    if (input) input.value = '';
    if (emptyInput) { emptyInput.value = ''; emptyInput.focus(); }
    closeSidebar();
  }

  // ── Sidebar toggle (mobile) ───────────────────────────────────────────────

  function openSidebar() {
    const sidebar  = document.getElementById('sidebar');
    const overlay  = el('sidebar-overlay');
    if (sidebar) {
      sidebar.classList.add('open');
      if (window.innerWidth <= 768) sidebar.classList.remove('sidebar-collapsed');
    }
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

  function syncPickerFace() {
    const hiddenInput = el('model-select');
    const nameEl      = el('model-picker-name');
    if (!nameEl || !hiddenInput) return;
    const id = hiddenInput.value;
    const m = (window._modelsList || []).find(function (x) { return (x.id || x.name) === id; });
    nameEl.textContent = m ? (m.name || m.id) : id || 'Modelo';
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
      window._modelsList = active.length ? active : [{ id: 'mistral', name: 'Mistral' }];
      buildPicker(window._modelsList);
    } catch (err) {
      showError('Erro ao carregar modelos: ' + (err.message || ''));
      window._modelsList = [{ id: 'mistral', name: 'Mistral' }];
      buildPicker([]);
    }
  }

  function applySavedPrefs() {
    const PREFS_KEY = 'maggiore_prefs';
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch (_) {}
    if (prefs.defaultModel && el('model-select')) {
      el('model-select').value = prefs.defaultModel;
      syncPickerFace();
    }
    if (prefs.defaultTheme && prefs.defaultTheme !== 'system') {
      document.documentElement.setAttribute('data-theme', prefs.defaultTheme);
      const iconSun = el('icon-sun'); const iconMoon = el('icon-moon');
      if (iconSun) iconSun.style.display = prefs.defaultTheme === 'dark' ? 'none' : '';
      if (iconMoon) iconMoon.style.display = prefs.defaultTheme === 'dark' ? '' : 'none';
    } else if (prefs.defaultTheme === 'system') {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      const iconSun = el('icon-sun'); const iconMoon = el('icon-moon');
      if (iconSun) iconSun.style.display = prefersDark ? 'none' : '';
      if (iconMoon) iconMoon.style.display = prefersDark ? '' : 'none';
    }
  }

  // ── Envio de mensagem ─────────────────────────────────────────────────────

  function stopGeneration() {
    if (abortController) abortController.abort();
  }

  async function sendMessage(userMsg) {
    messageHistory.push({ role: 'user', content: userMsg });
    messageHistory.push({ role: 'assistant', content: '' });

    var thinkingEnabled = false;
    var thinkingLevel = 'inteligente';
    var cb = el('thinking-enabled');
    var sel = el('thinking-level');
    var emptyInput = el('empty-state-input');
    if (emptyInput && document.activeElement === emptyInput) {
      var cbEmpty = el('thinking-enabled-empty');
      var selEmpty = el('thinking-level-empty');
      if (cbEmpty && cbEmpty.checked) { thinkingEnabled = true; if (selEmpty) thinkingLevel = selEmpty.value || 'inteligente'; }
    } else {
      if (cb && cb.checked) { thinkingEnabled = true; if (sel) thinkingLevel = (sel && sel.value) ? sel.value : 'inteligente'; }
    }

    appendUserBubble(userMsg);
    appendAssistantBubble(thinkingEnabled);
    showError('');
    setStreaming(true);
    updateEmptyState(); // esconde empty state e mostra footer assim que há mensagens

    const modelSel = el('model-select');
    let temp = 0.7;
    try {
      const prefs = JSON.parse(localStorage.getItem('maggiore_prefs') || '{}');
      if (prefs.defaultTemperature != null) temp = parseFloat(prefs.defaultTemperature);
    } catch (_) {}
    const model = (modelSel && modelSel.value) ? modelSel.value : 'mistral';

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
      if (currentSessionId) body.session_id = currentSessionId;
      if (thinkingEnabled) body.thinking = { enabled: true, level: thinkingLevel };

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
      updateHeaderTitle();

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
            if (obj.type === 'thinking_token') {
              ensureThinkingBlockAndAppendToken(obj.token || '');
            } else if (obj.type === 'analysis') {
              var lastMsg = messageHistory[messageHistory.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                lastMsg.thinking_summary = obj.analysis_summary || '';
                lastMsg.thinking_time_ms = obj.thinking_time_ms;
                lastMsg.thinking_level = obj.thinking_level || null;
              }
              showThinkingAnalysis(obj);
              try {
                var key = 'maggiore_thinking_' + (currentSessionId || 'new');
                localStorage.setItem(key, JSON.stringify({
                  summary: obj.analysis_summary,
                  thinking_time_ms: obj.thinking_time_ms,
                  thinking_level: obj.thinking_level,
                  at: Date.now(),
                }));
              } catch (_) {}
            } else if (obj.token) {
              messageHistory[messageHistory.length - 1].content += obj.token;
              appendToken(obj.token);
            }
          } catch (_) {}
        }
      }
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer);
          if (obj.type === 'thinking_token') {
            ensureThinkingBlockAndAppendToken(obj.token || '');
          } else if (obj.type === 'analysis') {
            var lastMsg = messageHistory[messageHistory.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.thinking_summary = obj.analysis_summary || '';
              lastMsg.thinking_time_ms = obj.thinking_time_ms;
              lastMsg.thinking_level = obj.thinking_level || null;
            }
            showThinkingAnalysis(obj);
            try {
              var key = 'maggiore_thinking_' + (currentSessionId || 'new');
              localStorage.setItem(key, JSON.stringify({
                summary: obj.analysis_summary,
                thinking_time_ms: obj.thinking_time_ms,
                thinking_level: obj.thinking_level,
                at: Date.now(),
              }));
            } catch (_) {}
          } else if (obj.token) {
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
      // Recarrega a sidebar para refletir nova sessão e título atualizado pela API
      await loadSessions();
      var sess = sessions && sessions.find(function (x) { return x.id === currentSessionId; });
      if (sess && sess.title) currentSessionTitle = sess.title;
      updateHeaderTitle();
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

  function submitMessageFromEmptyState() {
    const input = el('empty-state-input');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    sendMessage(msg);
    updateEmptyState();
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

    // User dropdown
    const btnUserMenu = el('btn-user-menu');
    const userDropdown = el('user-dropdown');
    if (btnUserMenu && userDropdown) {
      btnUserMenu.addEventListener('click', function (e) {
        e.stopPropagation();
        const open = userDropdown.getAttribute('aria-hidden') !== 'false';
        userDropdown.setAttribute('aria-hidden', open ? 'false' : 'true');
        btnUserMenu.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', function () {
        userDropdown.setAttribute('aria-hidden', 'true');
        btnUserMenu.setAttribute('aria-expanded', 'false');
      });
      userDropdown.addEventListener('click', function (e) {
        const item = e.target.closest('[data-action]');
        if (!item) return;
        const action = item.getAttribute('data-action');
        userDropdown.setAttribute('aria-hidden', 'true');
        btnUserMenu.setAttribute('aria-expanded', 'false');
        if (action === 'profile') openModalProfile();
        else if (action === 'prefs') openModalPrefs();
        else if (action === 'logout') doLogout();
      });
    }

    // Sidebar footer: perfil e configurações
    const btnSidebarUser = el('btn-sidebar-user');
    const sidebarUserDropdown = el('sidebar-user-dropdown');
    const sidebarEl = document.getElementById('sidebar');
    function positionSidebarDropdownOutside() {
      if (!sidebarEl || !sidebarEl.classList.contains('sidebar-collapsed')) return;
      var r = btnSidebarUser.getBoundingClientRect();
      sidebarUserDropdown.classList.add('sidebar-user-dropdown-outside');
      sidebarUserDropdown.style.left = (r.right + 8) + 'px';
      sidebarUserDropdown.style.bottom = (window.innerHeight - r.top + 8) + 'px';
      sidebarUserDropdown.style.top = 'auto';
    }
    function clearSidebarDropdownOutside() {
      if (!sidebarUserDropdown) return;
      sidebarUserDropdown.classList.remove('sidebar-user-dropdown-outside');
      sidebarUserDropdown.style.left = '';
      sidebarUserDropdown.style.top = '';
      sidebarUserDropdown.style.bottom = '';
    }
    if (btnSidebarUser && sidebarUserDropdown) {
      btnSidebarUser.addEventListener('click', function (e) {
        e.stopPropagation();
        const open = sidebarUserDropdown.getAttribute('aria-hidden') !== 'false';
        if (open) {
          sidebarUserDropdown.setAttribute('aria-hidden', 'false');
          btnSidebarUser.setAttribute('aria-expanded', 'true');
          positionSidebarDropdownOutside();
        } else {
          sidebarUserDropdown.setAttribute('aria-hidden', 'true');
          btnSidebarUser.setAttribute('aria-expanded', 'false');
          clearSidebarDropdownOutside();
        }
      });
      document.addEventListener('click', function (e) {
        if (e.target.closest('.sidebar-user-wrap')) return;
        sidebarUserDropdown.setAttribute('aria-hidden', 'true');
        btnSidebarUser.setAttribute('aria-expanded', 'false');
        clearSidebarDropdownOutside();
      });
      sidebarUserDropdown.addEventListener('click', function (e) {
        const item = e.target.closest('.sidebar-user-dropdown-item[data-action]');
        if (!item) return;
        const action = item.getAttribute('data-action');
        sidebarUserDropdown.setAttribute('aria-hidden', 'true');
        btnSidebarUser.setAttribute('aria-expanded', 'false');
        clearSidebarDropdownOutside();
        if (action === 'profile') openModalProfile();
        else if (action === 'prefs') openModalPrefs();
        else if (action === 'logout') doLogout();
      });
    }

    function doLogout() {
      Auth.clearToken();
      window.location.href = '/static/login.html';
    }

    function openModalProfile() {
      const modal = el('modal-profile');
      if (!modal) return;
      const emailInput = el('profile-email');
      if (emailInput) emailInput.value = currentUser ? (currentUser.email || '') : '';
      const fn = el('profile-first-name'); const ln = el('profile-last-name');
      const nick = el('profile-nickname'); const bio = el('profile-bio');
      if (fn) fn.value = currentUser ? (currentUser.first_name || '') : '';
      if (ln) ln.value = currentUser ? (currentUser.last_name || '') : '';
      if (nick) nick.value = currentUser ? (currentUser.nickname || '') : '';
      if (bio) bio.value = currentUser ? (currentUser.bio || '') : '';
      const cp = el('profile-current-password'); const np = el('profile-new-password');
      if (cp) cp.value = ''; if (np) np.value = '';
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeModalProfile() {
      const modal = el('modal-profile');
      if (modal) modal.setAttribute('aria-hidden', 'true');
    }

    function saveProfile() {
      const fn = el('profile-first-name'); const ln = el('profile-last-name');
      const nick = el('profile-nickname'); const bio = el('profile-bio');
      const payload = {};
      if (fn) payload.first_name = fn.value.trim() || null;
      if (ln) payload.last_name = ln.value.trim() || null;
      if (nick) payload.nickname = nick.value.trim() || null;
      if (bio) payload.bio = bio.value.trim() || null;
      Auth.apiFetch('/auth/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (res) { if (!res.ok) throw new Error('Falha ao salvar'); return res.json(); })
        .then(function (user) {
          currentUser = { email: user.email, full_name: user.full_name, first_name: user.first_name, last_name: user.last_name, nickname: user.nickname, bio: user.bio };
          const displayEl = el('user-email');
          if (displayEl) displayEl.textContent = getDisplayName();
          updateSidebarUser();
          closeModalProfile();
          showToast('Perfil salvo.');
        })
        .catch(function () { showToast('Não foi possível salvar o perfil.', true); });
    }

    function doChangePassword() {
      const cur = el('profile-current-password'); const neu = el('profile-new-password');
      if (!cur || !neu || !cur.value.trim() || !neu.value.trim()) {
        showToast('Preencha senha atual e nova senha.', true);
        return;
      }
      Auth.apiFetch('/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: cur.value, new_password: neu.value }),
      })
        .then(function (res) { if (!res.ok) throw new Error(); })
        .then(function () {
          cur.value = ''; neu.value = '';
          showToast('Senha alterada.');
        })
        .catch(function () { showToast('Senha atual incorreta ou erro ao alterar.', true); });
    }

    function openModalPrefs() {
      const modal = el('modal-prefs');
      if (!modal) return;
      const PREFS_KEY = 'maggiore_prefs';
      let prefs = {};
      try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch (_) {}
      const modelDrop = el('pref-model-dropdown');
      const modelName = el('pref-model-name');
      const modelVal = el('pref-model-value');
      const themeName = el('pref-theme-name');
      const themeVal = el('pref-theme-value');
      const themeDrop = el('pref-theme-dropdown');
      const tempSlider = el('pref-temperature');
      const tempVal = el('pref-temperature-value');

      if (modelDrop) {
        modelDrop.innerHTML = '';
        (window._modelsList || []).forEach(function (m) {
          const id = m.id || m.name; const name = m.name || m.id;
          const li = document.createElement('li');
          li.className = 'model-dropdown-item' + ((prefs.defaultModel || 'mistral') === id ? ' selected' : '');
          li.setAttribute('data-value', id);
          li.setAttribute('role', 'option');
          li.textContent = name;
          li.addEventListener('click', function () {
            if (modelVal) modelVal.value = id;
            if (modelName) modelName.textContent = name;
            modelDrop.querySelectorAll('.model-dropdown-item').forEach(function (x) { x.classList.toggle('selected', x.getAttribute('data-value') === id); });
            modelDrop.classList.remove('open');
          });
          modelDrop.appendChild(li);
        });
      }
      if (modelVal) modelVal.value = prefs.defaultModel || 'mistral';
      if (modelName) {
        const m = (window._modelsList || []).find(function (x) { return (x.id || x.name) === (prefs.defaultModel || 'mistral'); });
        modelName.textContent = m ? (m.name || m.id) : (prefs.defaultModel || 'Mistral');
      }
      if (themeVal) themeVal.value = prefs.defaultTheme || 'system';
      const themeLabels = { light: 'Claro', dark: 'Escuro', system: 'Seguir sistema' };
      if (themeName) themeName.textContent = themeLabels[prefs.defaultTheme || 'system'] || 'Seguir sistema';

      if (tempSlider) tempSlider.value = prefs.defaultTemperature != null ? prefs.defaultTemperature : 0.7;
      if (tempVal) tempVal.textContent = tempSlider ? tempSlider.value : '0.7';
      tempSlider && tempSlider.addEventListener('input', function () { if (tempVal) tempVal.textContent = tempSlider.value; });

      const openModelDrop = function () {
        themeDrop && themeDrop.classList.remove('open');
        modelDrop && modelDrop.classList.toggle('open');
      };
      const openThemeDrop = function () {
        modelDrop && modelDrop.classList.remove('open');
        themeDrop && themeDrop.classList.toggle('open');
      };
      el('pref-model-trigger') && el('pref-model-trigger').addEventListener('click', function (e) { e.stopPropagation(); openModelDrop(); });
      el('pref-theme-trigger') && el('pref-theme-trigger').addEventListener('click', function (e) { e.stopPropagation(); openThemeDrop(); });
      themeDrop && themeDrop.querySelectorAll('.model-dropdown-item').forEach(function (li) {
        li.addEventListener('click', function () {
          const v = li.getAttribute('data-value');
          if (themeVal) themeVal.value = v;
          if (themeName) themeName.textContent = li.textContent;
          themeDrop.classList.remove('open');
        });
      });

      modal.setAttribute('aria-hidden', 'false');
    }

    document.addEventListener('click', function () {
      const md = el('pref-model-dropdown'); const td = el('pref-theme-dropdown');
      if (md) md.classList.remove('open');
      if (td) td.classList.remove('open');
    });

    function closeModalPrefs() {
      const modal = el('modal-prefs');
      if (modal) modal.setAttribute('aria-hidden', 'true');
    }

    function savePrefs() {
      const PREFS_KEY = 'maggiore_prefs';
      const modelVal = el('pref-model-value');
      const tempSlider = el('pref-temperature');
      const themeVal = el('pref-theme-value');
      const prefs = {
        defaultModel: modelVal ? modelVal.value : 'mistral',
        defaultTemperature: tempSlider ? parseFloat(tempSlider.value) : 0.7,
        defaultTheme: themeVal ? themeVal.value : 'system',
      };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) {}
      if (el('model-select')) el('model-select').value = prefs.defaultModel;
      if (el('model-picker-name')) {
        const name = (window._modelsList || []).find(function (m) { return (m.id || m.name) === prefs.defaultModel; });
        if (name) el('model-picker-name').textContent = name.name || name.id;
      }
      if (prefs.defaultTheme && prefs.defaultTheme !== 'system') {
        document.documentElement.setAttribute('data-theme', prefs.defaultTheme);
        const iconSun = el('icon-sun'); const iconMoon = el('icon-moon');
        if (iconSun) iconSun.style.display = prefs.defaultTheme === 'dark' ? 'none' : '';
        if (iconMoon) iconMoon.style.display = prefs.defaultTheme === 'dark' ? '' : 'none';
      } else if (prefs.defaultTheme === 'system') {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        const iconSun = el('icon-sun'); const iconMoon = el('icon-moon');
        if (iconSun) iconSun.style.display = prefersDark ? 'none' : '';
        if (iconMoon) iconMoon.style.display = prefersDark ? '' : 'none';
      }
      closeModalPrefs();
      showToast('Preferências salvas.');
    }

    el('profile-save-btn') && el('profile-save-btn').addEventListener('click', saveProfile);
    el('profile-close-btn') && el('profile-close-btn').addEventListener('click', closeModalProfile);
    el('profile-change-password-btn') && el('profile-change-password-btn').addEventListener('click', doChangePassword);
    el('modal-profile') && el('modal-profile').querySelector('.profile-modal-close') && el('modal-profile').querySelector('.profile-modal-close').addEventListener('click', closeModalProfile);
    el('modal-profile') && el('modal-profile').querySelector('.modal-backdrop') && el('modal-profile').querySelector('.modal-backdrop').addEventListener('click', closeModalProfile);

    el('prefs-save-btn') && el('prefs-save-btn').addEventListener('click', savePrefs);
    el('modal-prefs') && el('modal-prefs').querySelector('.modal-close') && el('modal-prefs').querySelector('.modal-close').addEventListener('click', closeModalPrefs);
    el('modal-prefs') && el('modal-prefs').querySelector('.modal-backdrop') && el('modal-prefs').querySelector('.modal-backdrop').addEventListener('click', closeModalPrefs);

    // Formulário de envio
    const form = el('chat-form');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); submitMessage(); });

    // Thinking level picker (dropup) e sincronizar footer ↔ empty state
    (function () {
      var levelLabels = { esperto: 'Esperto', inteligente: 'Inteligente', culto: 'Culto', sabio: 'Sábio' };
      var otherHidden = { 'thinking-level': 'thinking-level-empty', 'thinking-level-empty': 'thinking-level' };
      var otherName = { 'thinking-level': 'thinking-level-name-empty', 'thinking-level-empty': 'thinking-level-name' };
      function setLevel(hiddenId, nameId, value, trigger, listEl) {
        var hidden = document.getElementById(hiddenId);
        var nameEl = document.getElementById(nameId);
        if (hidden) hidden.value = value;
        if (nameEl) nameEl.textContent = levelLabels[value] || value;
        if (listEl) listEl.classList.remove('open');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
        var oHidden = document.getElementById(otherHidden[hiddenId]);
        var oName = document.getElementById(otherName[hiddenId]);
        if (oHidden) oHidden.value = value;
        if (oName) oName.textContent = levelLabels[value] || value;
      }
      function setupLevelPicker(triggerId, dropdownId, hiddenId, nameId) {
        var trigger = document.getElementById(triggerId);
        var listEl = document.getElementById(dropdownId);
        if (!trigger || !listEl) return;
        trigger.addEventListener('click', function (e) {
          e.stopPropagation();
          listEl.classList.toggle('open');
          trigger.setAttribute('aria-expanded', listEl.classList.contains('open'));
        });
        listEl.querySelectorAll('.thinking-level-item').forEach(function (li) {
          li.addEventListener('click', function () {
            setLevel(hiddenId, nameId, li.getAttribute('data-value') || 'inteligente', trigger, listEl);
          });
        });
      }
      setupLevelPicker('thinking-level-trigger', 'thinking-level-dropdown', 'thinking-level', 'thinking-level-name');
      setupLevelPicker('thinking-level-trigger-empty', 'thinking-level-dropdown-empty', 'thinking-level-empty', 'thinking-level-name-empty');

      function syncThinkingFromFooter() {
        var cb = el('thinking-enabled');
        var cbEmpty = el('thinking-enabled-empty');
        var hidden = el('thinking-level');
        var hiddenEmpty = el('thinking-level-empty');
        var nameEmpty = el('thinking-level-name-empty');
        if (cbEmpty) cbEmpty.checked = cb ? cb.checked : false;
        if (hiddenEmpty && hidden) { hiddenEmpty.value = hidden.value; if (nameEmpty) nameEmpty.textContent = levelLabels[hidden.value] || hidden.value; }
      }
      function syncThinkingFromEmpty() {
        var cb = el('thinking-enabled');
        var cbEmpty = el('thinking-enabled-empty');
        var hidden = el('thinking-level');
        var hiddenEmpty = el('thinking-level-empty');
        var nameEl = el('thinking-level-name');
        if (cb) cb.checked = cbEmpty ? cbEmpty.checked : false;
        if (hidden && hiddenEmpty) { hidden.value = hiddenEmpty.value; if (nameEl) nameEl.textContent = levelLabels[hiddenEmpty.value] || hiddenEmpty.value; }
      }
      el('thinking-enabled') && el('thinking-enabled').addEventListener('change', syncThinkingFromFooter);
      el('thinking-enabled-empty') && el('thinking-enabled-empty').addEventListener('change', syncThinkingFromEmpty);
    })();

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

    // Busca na sidebar (debounce 300ms)
    const searchInput = el('sessions-search');
    if (searchInput) {
      let searchDebounce;
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(function () { loadSessions(searchInput.value); }, 300);
      });
    }

    // Sanfona Arquivadas: ao expandir, carrega conversas arquivadas na primeira vez
    const archivedTrigger = document.getElementById('sidebar-archived-trigger');
    const archivedContent = document.getElementById('sidebar-archived-content');
    if (archivedTrigger && archivedContent) {
      archivedTrigger.addEventListener('click', function () {
        var expanded = archivedTrigger.getAttribute('aria-expanded') === 'true';
        if (!expanded) {
          archivedTrigger.setAttribute('aria-expanded', 'true');
          archivedContent.removeAttribute('hidden');
          loadArchivedSessions(searchInput ? searchInput.value.trim() : '');
        } else {
          archivedTrigger.setAttribute('aria-expanded', 'false');
          archivedContent.setAttribute('hidden', '');
        }
      });
    }

    // Sidebar recolhível + localStorage (sidebarEl já definido no bloco do footer)
    const SIDEBAR_COLLAPSED_KEY = 'maggiore_sidebar_collapsed';
    const btnToggleSidebar = el('btn-toggle-sidebar');
    function setSidebarCollapsed(collapsed) {
      if (sidebarEl) sidebarEl.classList.toggle('sidebar-collapsed', collapsed);
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (_) {}
      if (btnToggleSidebar) btnToggleSidebar.title = collapsed ? 'Expandir menu' : 'Recolher menu';
    }
    if (btnToggleSidebar) {
      btnToggleSidebar.addEventListener('click', function () {
        if (sidebarUserDropdown && sidebarUserDropdown.getAttribute('aria-hidden') !== 'true') {
          sidebarUserDropdown.setAttribute('aria-hidden', 'true');
          if (btnSidebarUser) btnSidebarUser.setAttribute('aria-expanded', 'false');
          clearSidebarDropdownOutside();
        }
        setSidebarCollapsed(sidebarEl ? !sidebarEl.classList.contains('sidebar-collapsed') : false);
      });
    }
    try {
      const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (window.innerWidth <= 768) setSidebarCollapsed(false);
      else setSidebarCollapsed(saved === '1');
    } catch (_) {}

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
      var thinkingWrap = document.getElementById('thinking-level-picker');
      var thinkingWrapEmpty = document.getElementById('thinking-level-picker-empty');
      if (thinkingWrap && !thinkingWrap.contains(e.target)) {
        var listEl = document.getElementById('thinking-level-dropdown');
        if (listEl) listEl.classList.remove('open');
        var trig = document.getElementById('thinking-level-trigger');
        if (trig) trig.setAttribute('aria-expanded', 'false');
      }
      if (thinkingWrapEmpty && !thinkingWrapEmpty.contains(e.target)) {
        var listEmpty = document.getElementById('thinking-level-dropdown-empty');
        if (listEmpty) listEmpty.classList.remove('open');
        var trigEmpty = document.getElementById('thinking-level-trigger-empty');
        if (trigEmpty) trigEmpty.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePicker(); });

    // Formulário do empty state
    const emptyForm = el('empty-state-form');
    if (emptyForm) {
      emptyForm.addEventListener('submit', function (e) {
        e.preventDefault();
        submitMessageFromEmptyState();
      });
    }
    const emptyInput = el('empty-state-input');
    if (emptyInput) {
      emptyInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitMessageFromEmptyState(); }
      });
      emptyInput.addEventListener('input', function () { autoResizeTextarea(emptyInput); });
    }

    // Carrega usuário, modelos e sessões
    try {
      const user = await loadUser();
      if (!user) { window.location.href = '/static/login.html'; return; }
      currentUser = {
        email: user.email || '',
        full_name: user.full_name || null,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        nickname: user.nickname || null,
        bio: user.bio || null,
      };
      const displayEl = el('user-email');
      if (displayEl) displayEl.textContent = getDisplayName();
      updateSidebarUser();
      await loadModels();
      await loadSessions();

      // Abre automaticamente a sessão mais recente (se existir)
      if (sessions && sessions.length > 0) {
        await openSession(sessions[0].id);
      }
      applySavedPrefs();
      updateEmptyState();
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
