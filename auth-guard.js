/* ==========================================================================
   RABIT — AUTH GUARD
   Penegak akses berbasis role untuk semua halaman terproteksi.
   Dimuat sebelum </head> di setiap halaman (kecuali index.html / login).
   Sesi disimpan di localStorage key 'rabit_auth' oleh index.html.
   ========================================================================== */
(function () {
  'use strict';

  var SESSION_KEY = 'rabit_auth';
  var LOGIN_PAGE  = 'index.html';

  /* Halaman default tiap role setelah login */
  var HOME_BY_ROLE = {
    admin:          'dashboard.html',
    smart_rab_only: 'smart-rab.html'
  };

  /* Matriks akses: file -> daftar role yang boleh membukanya */
  var PAGE_ACCESS = {
    'dashboard.html':   ['admin'],
    'conven.html':      ['admin'],
    'ftth.html':        ['admin'],
    'ftthxconven.html': ['admin'],
    'riwayat.html':     ['admin'],
    'smart-rab.html':   ['admin', 'smart_rab_only']
  };

  var LABEL_BY_ROLE = {
    admin:          'Administrator',
    smart_rab_only: 'Akses Terbatas · Smart RAB'
  };

  function currentPage() {
    var parts = window.location.pathname.split('/');
    return parts[parts.length - 1] || LOGIN_PAGE;
  }

  function storageAvailable() {
    try {
      var probe = '__rabit_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
  }

  function readSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.role) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function homeFor(role) {
    return HOME_BY_ROLE[role] || LOGIN_PAGE;
  }

  function logout() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    window.location.replace(LOGIN_PAGE);
  }

  function initials(name) {
    return String(name || '?')
      .split(' ')
      .filter(Boolean)
      .map(function (w) { return w.charAt(0); })
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  function renderUserChip(session) {
    if (document.getElementById('rabit-user-chip')) return;

    var wrap = document.createElement('div');
    wrap.id = 'rabit-user-chip';
    wrap.className = 'rabit-user-chip';
    wrap.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:9999',
      'display:flex', 'align-items:center', 'gap:10px',
      'background:#ffffff', 'border:1px solid #e2e8f0',
      'border-radius:12px', 'padding:8px 10px',
      'box-shadow:0 8px 24px rgba(15,23,42,.10)',
      'font-family:Inter,system-ui,sans-serif', 'font-size:11px',
      'line-height:1.2', 'color:#334155'
    ].join(';');

    var avatar = document.createElement('div');
    avatar.style.cssText = [
      'width:28px', 'height:28px', 'border-radius:50%',
      'background:#1e4a42', 'color:#ffffff',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-weight:700', 'font-size:11px', 'flex-shrink:0'
    ].join(';');
    avatar.textContent = initials(session.name || session.username);

    var info = document.createElement('div');
    info.style.cssText = 'display:flex;flex-direction:column;gap:1px';

    var nameEl = document.createElement('span');
    nameEl.style.cssText = 'font-weight:700;color:#0f172a;font-size:11px';
    nameEl.textContent = session.name || session.username || 'User';

    var roleEl = document.createElement('span');
    roleEl.style.cssText = 'color:#94a3b8;font-size:10px';
    roleEl.textContent = LABEL_BY_ROLE[session.role] || session.role;

    info.appendChild(nameEl);
    info.appendChild(roleEl);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Keluar';
    btn.style.cssText = [
      'margin-left:4px', 'border:1px solid #e2e8f0', 'background:#f8fafc',
      'color:#475569', 'font-size:10px', 'font-weight:700',
      'padding:5px 9px', 'border-radius:8px', 'cursor:pointer',
      'font-family:inherit', 'transition:all .15s', 'line-height:1.4'
    ].join(';');
    btn.onmouseenter = function () {
      btn.style.background = '#fee2e2';
      btn.style.borderColor = '#fecaca';
      btn.style.color = '#b91c1c';
    };
    btn.onmouseleave = function () {
      btn.style.background = '#f8fafc';
      btn.style.borderColor = '#e2e8f0';
      btn.style.color = '#475569';
    };
    btn.addEventListener('click', logout);

    wrap.appendChild(avatar);
    wrap.appendChild(info);
    wrap.appendChild(btn);
    document.body.appendChild(wrap);
  }

  /* Sembunyikan elemen menu sidebar yang tidak berhak diakses oleh role saat ini */
  function filterSidebarMenu(session) {
    if (!session || !session.role) return;

    var links = document.querySelectorAll('aside nav a[href]');
    links.forEach(function (link) {
      var href = link.getAttribute('href');
      if (!href) return;

      var pageName = href.split('/').pop().split('?')[0].split('#')[0];
      var allowed = PAGE_ACCESS[pageName];

      if (allowed && allowed.indexOf(session.role) === -1) {
        link.style.display = 'none';
      }
    });
  }

  function boot() {
    var page = currentPage();

    /* Storage tidak tersedia (mis. file:// di beberapa browser) -> fail open
       agar aplikasi tidak terkunci total untuk pengguna sah. */
    if (!storageAvailable()) {
      console.warn('[RABIT] localStorage tidak tersedia — pembatasan akses dinonaktifkan.');
      return;
    }

    var session = readSession();

    /* 1. Belum login -> tendang ke halaman login */
    if (!session) {
      window.location.replace(LOGIN_PAGE);
      return;
    }

    /* 2. Role tidak berhak atas halaman ini -> kembalikan ke home role-nya */
    var allowed = PAGE_ACCESS[page];
    if (allowed && allowed.indexOf(session.role) === -1) {
      window.location.replace(homeFor(session.role));
      return;
    }

    /* 3. Sesi valid & berhak -> sembunyikan dokumen sampai chip siap,
          supaya tidak ada kedipan identitas pengguna sebelumnya. */
    document.documentElement.style.visibility = 'hidden';

    function paint() {
      document.documentElement.style.visibility = '';
      renderUserChip(session);
      filterSidebarMenu(session);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded
