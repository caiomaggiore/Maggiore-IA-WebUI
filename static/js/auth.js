/**
 * auth.js — autenticação e token (usado em login.html e chat.html)
 */
const Auth = (function () {
  const API = '';
  const TOKEN_KEY = 'saas_ia_token';

  let accessToken = localStorage.getItem(TOKEN_KEY);

  function setToken(t) {
    accessToken = t;
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function getToken() {
    return accessToken;
  }

  function clearToken() {
    accessToken = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  function isLoggedIn() {
    return !!accessToken;
  }

  async function apiFetch(url, opts = {}) {
    const headers = { ...opts.headers };
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
    const res = await fetch(API + url, { ...opts, headers });
    if (res.status === 401) {
      clearToken();
      if (typeof window !== 'undefined' && !window.location.pathname.includes('login'))
        window.location.href = '/static/login.html';
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    if (res.status >= 500) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Erro no servidor. Tente novamente mais tarde.');
    }
    return res;
  }

  async function login(email, password) {
    const res = await fetch(API + '/auth/login', {
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

  function initLoginPage() {
    const form = document.getElementById('login-form');
    const errorEl = document.getElementById('login-error');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (errorEl) errorEl.textContent = '';
      const email = document.getElementById('email')?.value?.trim();
      const password = document.getElementById('password')?.value;
      if (!email || !password) return;
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        await login(email, password);
        window.location.href = '/static/chat.html';
      } catch (err) {
        if (errorEl) errorEl.textContent = err.message;
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  return {
    getToken,
    setToken,
    clearToken,
    isLoggedIn,
    apiFetch,
    login,
    initLoginPage,
  };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    Auth.initLoginPage();
  });
} else {
  Auth.initLoginPage();
}
