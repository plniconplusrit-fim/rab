/**
 * Uji end-to-end: rab-auth.js (klien) <-> Code.gs (server, dalam simulator).
 * Memastikan format request/response kedua sisi benar-benar cocok.
 */
const crypto = require('crypto');
const fs = require('fs');

// ===== MOCK APPS SCRIPT =====
const props = { RABIT_SECRET: crypto.randomBytes(32).toString('hex') };
let sheetRows = [
  ['Nomor RAB','Judul','Lokasi','Tipe RAB (CONVEN / FTTH / FTTH 6 CORE)','Tanggal','Total Biaya','File ID','URL D'],
  ['RAB RIIWAYAT 1','RAB FTTH','Luwu','FTTH','2026-10-26',26879548,'f1','https://drive.google.com/file/d/f1/preview'],
  ['RAB RIIWAYAT 2','RAB CONVEN','Tambun','CONVEN','2026-11-11',11983478,'f2','https://drive.google.com/file/d/f2/preview']
];
let driveFile = null;

global.Utilities = {
  DigestAlgorithm: { SHA_256: 'x' }, Charset: { UTF_8: 'x' },
  computeDigest(a, t) { return Array.from(crypto.createHash('sha256').update(t, 'utf8').digest()).map(b => b > 127 ? b - 256 : b); },
  computeHmacSha256Signature(v, k) { return Array.from(crypto.createHmac('sha256', k).update(v, 'utf8').digest()).map(b => b > 127 ? b - 256 : b); },
  base64EncodeWebSafe(s) { return Buffer.from(String(s), 'utf8').toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); },
  base64DecodeWebSafe(s) { const p = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4)); return Array.from(Buffer.from(String(s).replace(/-/g,'+').replace(/_/g,'/') + p, 'base64')).map(b => b > 127 ? b - 256 : b); },
  base64Decode(s) { return Array.from(Buffer.from(String(s), 'base64')).map(b => b > 127 ? b - 256 : b); },
  newBlob(d, mime, name) {
    const b = Array.isArray(d) ? Buffer.from(d.map(x => x < 0 ? x + 256 : x)) : Buffer.from(String(d));
    return { _name: name, getDataAsString: () => b.toString('utf8') };
  },
  getUuid: () => crypto.randomUUID(),
  formatDate: () => '2026-11-12 14:30'
};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] || null }) };
global.ContentService = { MimeType: { JSON: 'J' }, createTextOutput(t) { return { _t: t, setMimeType() { return this; }, getContent() { return this._t; } }; } };
global.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getActiveSheet: () => ({
  getDataRange: () => ({ getValues: () => sheetRows }),
  appendRow: r => sheetRows.push(r)
}) }) };
global.DriveApp = {
  Access: { ANYONE_WITH_LINK: 'AWL' }, Permission: { VIEW: 'V' },
  getFolderById: () => ({ createFile: (blob) => {
    driveFile = { name: blob._name, bytes: blob.getDataAsString() };
    return { getId: () => 'FILEID123', setSharing() {} };
  } })
};
global.Logger = { log: console.log };

eval(fs.readFileSync('C:/Users/fadhil.muhammad/rab/apps-script/Code.gs', 'utf8'));

// Tambah user uji dengan password yang diketahui
const salt = crypto.randomUUID();
const PASSWORD = 'RahasiaEndToEnd99';
const hash = crypto.createHash('sha256').update(salt + ':' + PASSWORD).digest('hex');
eval("USERS['e2e'] = { name: 'End To End', role: 'admin', salt: '" + salt + "', hash: '" + hash + "' };");

// ===== MOCK KLINEN (window/localStorage/fetch) =====
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
let replaceTarget = null;
const window = { location: { href: 'http://localhost/index.html', pathname: '/index.html', replace(u) { replaceTarget = u; } }, document: null };
const document = { querySelector: () => null };
const metaContent = null;

// fetch tiruan: menerjemahkan panggilan klien menjadi doPost/doGet
async function fetch(url, opts) {
  const u = String(url);
  if (opts && opts.method === 'POST') {
    const body = JSON.parse(opts.body);
    const out = doPost({ postData: { contents: JSON.stringify(body) }, parameter: {} });
    await new Promise(r => setTimeout(r, 1));
    return { ok: true, json: async () => JSON.parse(out.getContent()) };
  }
  // GET dengan query string
  const qs = u.split('?')[1] || '';
  const params = {};
  qs.split('&').filter(Boolean).forEach(p => {
    const [k, v] = p.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v || '');
  });
  const out = doGet({ parameter: params });
  await new Promise(r => setTimeout(r, 1));
  return { ok: true, json: async () => JSON.parse(out.getContent()) };
}

// Muat rab-auth.js (IIFE menetapkan window.RabAuth)
const authSrc = fs.readFileSync('C:/Users/fadhil.muhammad/rab/rab-auth.js', 'utf8');
(function () {
  eval(authSrc);
})();
const RabAuth = window.RabAuth;
if (!RabAuth) { console.log('FAIL: RabAuth tidak terpasang di window'); process.exit(1); }

function sessionStorageToken() {
  try {
    var raw = localStorage.getItem('rabit_auth');
    if (!raw) return '';
    var d = JSON.parse(raw);
    return d && d.token ? d.token : '';
  } catch (e) { return ''; }
}

function validSesi() {
  var s = RabAuth.sesi();
  return !!(s && s.role);
}

// ===== UJI =====
let pass = 0, fail = 0;
function cek(n, ok, d) { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? ' -> ' + d : '')); } }

(async () => {
  console.log('=== E2E: rab-auth.js <-> Code.gs ===\n');

  // Arahkan klien ke endpoint (delay nol agar tes cepat)
  RabAuth.simpanGasUrl('https://script.google.com/macros/s/TEST/exec');

  console.log('[1] Login lewat klien');
  let r = await RabAuth.login('e2e', PASSWORD);
  cek('login berhasil', r.status === 'success' && !!r.token, JSON.stringify(r).slice(0,100));
  cek('token tersimpan di localStorage', !!localStorage.getItem('rabit_auth'));
  cek('role terbaca admin', r.user && r.user.role === 'admin');

  console.log('\n[2] Sesi setelah login');
  let s = RabAuth.sesi();
  cek('sesi() mengembalikan user admin', !!s && s.role === 'admin');
  cek('token ada di sesi', !!sessionStorageToken());
  cek('sesi valid', validSesi());

  console.log('\n[3] Baca riwayat lewat klien');
  let riw = await RabAuth.api('riwayat');
  cek('status success', riw.status === 'success', JSON.stringify(riw).slice(0, 120));
  cek('data terisi 2 baris', Array.isArray(riw.data) && riw.data.length === 2);
  cek('kolom asli utuh (URL D ada)',
      riw.data && riw.data[0] && 'URL D' in riw.data[0]);

  console.log('\n[4] Simpan RAB lewat klien');
  let simpan = await RabAuth.api('simpanRab', {
    nomorRab: 'E2E-001', judul: 'Uji E2E', lokasi: 'Makassar',
    tipeRab: 'CONVEN', totalBiaya: 7777,
    pdfBase64: 'data:application/pdf;base64,' + Buffer.from('%PDF uji').toString('base64'),
    fileName: 'RAB_E2E.pdf'
  });
  cek('simpan success', simpan.status === 'success', JSON.stringify(simpan).slice(0, 150));
  cek('file masuk Drive', !!(driveFile && driveFile.name === 'RAB_E2E.pdf'), JSON.stringify(driveFile && driveFile.name));
  cek('baris bertambah di Sheet', sheetRows.length === 4);
  cek('previewUrl /preview', /\/preview$/.test(simpan.previewUrl || ''));

  console.log('\n[5] Login salah');
  let bad = await RabAuth.login('e2e', 'passwordSalah');
  cek('ditolak', bad.status === 'error' && !bad.token);
  cek('pesan seragam', bad.message === 'Username atau password salah', bad.message);

  console.log('\n[6] Token rusak / kedaluwarsa');
  const sesiAsli = JSON.parse(localStorage.getItem('rabit_auth'));
  localStorage.setItem('rabit_auth', JSON.stringify({ token: 'rusak.token', user: sesiAsli.user }));
  cek('sesi() null untuk token rusak', RabAuth.sesi() === null);
  let gagal = await RabAuth.api('riwayat');
  cek('api menolak token rusak', gagal.status === 'error', JSON.stringify(gagal).slice(0, 100));
  cek('sesi rusak dibersihkan', localStorage.getItem('rabit_auth') === null, 'masih ada: ' + localStorage.getItem('rabit_auth'));

  console.log('\n[7] Logout');
  localStorage.setItem('rabit_auth', JSON.stringify(sesiAsli));
  RabAuth.logout();
  cek('sesi terhapus', localStorage.getItem('rabit_auth') === null);
  cek('sesi() null setelah logout', RabAuth.sesi() === null);

  console.log('\n============================');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  console.log('============================');
  process.exit(fail ? 1 : 0);
})();
