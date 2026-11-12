/**
 * rab-auth.js — Klien autentikasi RABIT.
 * ============================================================================
 * Menggantikan pengecekan password di sisi browser (dulu: USERS_DB plaintext
 * di index.html yang bisa dibaca siapa pun lewat View Source).
 *
 * Sekarang:
 *   - Password tidak pernah ada di kode klien.
 *   - Login mengirim username+password ke Apps Script, yang membalas token
 *     bertanda tangan (HMAC) berlaku 8 jam.
 *   - Token disimpan di localStorage dan diverifikasi ulang setiap muat halaman.
 *
 * Token tetap bisa dipalsukan di sisi klien (ini situs statis) — tapi tanpa
 * kunci HMAC server, token palsu akan DITOLAK saat menyimpan/membaca data.
 * Jadi manipulasi localStorage hanya memberi tampilan kosong, bukan akses data.
 * ============================================================================
 */
(function (global) {
  'use strict';

  var SESSION_KEY = 'rabit_auth';
  var GAS_URL_KEY = 'rabit_gas_url';

  /** URL Apps Script. Diisi dari <meta name="rabit-gas-url"> bila ada. */
  function gasUrl() {
    var meta = document.querySelector('meta[name="rabit-gas-url"]');
    if (meta && meta.content) return meta.content;
    try {
      var saved = localStorage.getItem(GAS_URL_KEY);
      if (saved) return saved;
    } catch (e) {}
    return '';
  }

  function simpanGasUrl(url) {
    try {
      if (url) localStorage.setItem(GAS_URL_KEY, url);
    } catch (e) {}
  }

  // -------------------------------------------------------------------------
  // Token
  // -------------------------------------------------------------------------

  /** Decode payload token tanpa verifikasi (verifikasi sebenarnya di server). */
  function decodePayload(token) {
    try {
      var body = String(token).split('.')[0];
      var pad = body.length % 4 === 0 ? '' : new Array(5 - (body.length % 4)).join('=');
      var b64 = body.replace(/-/g, '+').replace(/_/g, '/') + pad;
      var json = decodeURIComponent(
        atob(b64).split('').map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join('')
      );
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  /** Baca sesi dari localStorage; null bila tidak ada / kedaluwarsa. */
  function sesi() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;

      var data = JSON.parse(raw);

      // Format baru: { token, user }
      if (data && data.token) {
        var p = decodePayload(data.token);
        // Token tidak bisa dibaca (rusak/dipotong) -> buang sesinya,
        // jangan biarkan tersimpan dan gagal berulang di setiap muat halaman.
        if (!p || !p.exp) {
          localStorage.removeItem(SESSION_KEY);
          return null;
        }
        if (p.exp * 1000 < Date.now()) {
          localStorage.removeItem(SESSION_KEY);
          return null;
        }
        return {
          token: data.token,
          username: p.u,
          name: p.n,
          role: p.r,
          exp: p.exp
        };
      }

      // Format lama (sesi tanpa token) -> paksa login ulang.
      if (data && data.role && !data.token) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function simpanSesi(token, user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: token, user: user }));
  }

  function hapusSesi() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  /**
   * Kirim kredensial ke Apps Script.
   * @returns {Promise<{status:string, token?:string, user?:object, message?:string}>}
   */
  async function login(username, password) {
    var url = gasUrl();
    if (!url) {
      return { status: 'error', message: 'URL server belum dikonfigurasi.' };
    }

    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 20000);

    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'login', username: username, password: password }),
        signal: ctrl.signal
      });

      if (!res.ok) {
        return { status: 'error', message: 'Server menolak (HTTP ' + res.status + ').' };
      }

      var data = await res.json();
      if (data.status === 'success' && data.token) {
        simpanSesi(data.token, data.user);
      }
      return data;
    } catch (err) {
      var pesan = err.name === 'AbortError'
        ? 'Server tidak merespons (timeout 20 detik). Periksa koneksi.'
        : 'Gagal menghubungi server: ' + err.message;
      return { status: 'error', message: pesan };
    } finally {
      clearTimeout(timer);
    }
  }

  function logout() {
    hapusSesi();
    var base = window.location.pathname.replace(/[^/]*$/, '');
    window.location.replace(base + 'index.html');
  }

  // -------------------------------------------------------------------------
  // Panggilan API terautentikasi
  // -------------------------------------------------------------------------

  /**
   * POST ke Apps Script dengan token otomatis.
   * @param {string} action  nama aksi ('riwayat' | 'simpanRab')
   * @param {object} payload data tambahan
   */
  async function api(action, payload) {
    var s = sesi();
    if (!s) {
      return { status: 'error', message: 'Sesi berakhir. Silakan login ulang.' };
    }

    var url = gasUrl();
    if (!url) {
      return { status: 'error', message: 'URL server belum dikonfigurasi.' };
    }

    var body = Object.assign({ action: action, token: s.token }, payload || {});

    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 60000);

    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      return await res.json();
    } catch (err) {
      return {
        status: 'error',
        message: err.name === 'AbortError' ? 'Timeout menghubungi server.' : err.message
      };
    } finally {
      clearTimeout(timer);
    }
  }

  global.RabAuth = {
    login: login,
    logout: logout,
    sesi: sesi,
    api: api,
    simpanGasUrl: simpanGasUrl,
    gasUrl: gasUrl,
    SESSION_KEY: SESSION_KEY
  };
})(typeof window !== 'undefined' ? window : this);
