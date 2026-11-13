/**
 * Uji Code-aktivasi.gs: token lintas project (dibuat project RAB, diverifikasi
 * di project aktivasi) + bentuk respons tetap array polos.
 */
const crypto = require('crypto');
const fs = require('fs');

// ---------- Mock Apps Script (meniru perilaku ASLI) ----------
const props = { RABIT_SECRET: crypto.randomBytes(32).toString('hex') };

// Sheet 620 baris tiruan (header + beberapa data)
const SHEET = [
  ['NO', 'ID_PA', 'SID', 'ID PEL', 'ID PER', 'SERVICE', 'BANDWITH', 'IO',
   'PELANGGAN', 'TERMINATING', 'TIKOR TERMINATING'],
  [1, 'U411303002685', '410130300481 | 04000098749', 411090024398, 4126110300012,
   'INTERNET CORPORATE', 'BANDWIDTH: 50 MBPS', '2620BS458464',
   'BADAN PENDAPATAN DAERAH', 'JL. LANTO DG PASEWANG', '-5.6776, 119.1234'],
  [2, 'U411303002686', '410130300482 | 04000098750', 411090024399, 4126110300013,
   'INTERNET CORPORATE', 'BANDWIDTH: 100 MBPS', '2620BS458465',
   'DINAS PENDIDIKAN', 'JL. SUDIRMAN', '-5.6800, 119.1300'],
  ['', '', '', '', '', '', '', '', '', '', '']  // baris kosong sungguhan: harus dilewati
];

global.Utilities = {
  DigestAlgorithm: { SHA_256: 'x' }, Charset: { UTF_8: 'x' },
  computeDigest(a, t) {
    return Array.from(crypto.createHash('sha256').update(t, 'utf8').digest())
      .map(b => (b > 127 ? b - 256 : b));
  },
  computeHmacSha256Signature(v, k) {
    return Array.from(crypto.createHmac('sha256', k).update(v, 'utf8').digest())
      .map(b => (b > 127 ? b - 256 : b));
  },
  // PERILAKU ASLI: array byte + Charset -> LEMPAR ERROR
  base64EncodeWebSafe(data, charset) {
    if (Array.isArray(data) && charset) {
      throw new Error('Parameter (number[],Utilities.Charset) tidak cocok dengan tanda tangan metode untuk Utilities.base64EncodeWebSafe.');
    }
    if (Array.isArray(data)) {
      return Buffer.from(data.map(b => (b < 0 ? b + 256 : b)))
        .toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    }
    return Buffer.from(String(data), 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_');
  },
  base64DecodeWebSafe(str) {
    const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    return Array.from(Buffer.from(b64, 'base64')).map(b => (b > 127 ? b - 256 : b));
  },
  newBlob(d) {
    const b = Array.isArray(d) ? Buffer.from(d.map(x => (x < 0 ? x + 256 : x))) : Buffer.from(String(d));
    return { getDataAsString: () => b.toString('utf8') };
  },
  getUuid: () => crypto.randomUUID()
};

global.PropertiesService = {
  getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) })
};

global.ContentService = {
  MimeType: { JSON: 'JSON' },
  createTextOutput(t) {
    return { _t: t, setMimeType() { return this; }, getContent() { return this._t; } };
  }
};

global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getActiveSheet: () => ({
      getDataRange: () => ({ getValues: () => SHEET.map(r => r.slice()) })
    })
  })
};

global.Logger = { log: m => console.log('    LOG:', m) };

// ---------- Muat kode ----------
eval(fs.readFileSync('C:/Users/fadhil.muhammad/rab/apps-script/Code-aktivasi.gs', 'utf8'));

// ---------- Token dibuat seperti project RAB ----------
function buatTokenRab(username, role, secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { u: username, r: role, n: username, iat: now, exp: now + 28800 };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sig = Buffer.from(
    crypto.createHmac('sha256', secret).update(body, 'utf8').digest()
  ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return body + '.' + sig;
}

// ---------- Uji ----------
let pass = 0, fail = 0;
function cek(n, ok, d) {
  if (ok) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '  -> ' + d : '')); }
}
function parse(out) {
  try { return JSON.parse(out.getContent()); } catch (e) { return { _raw: out.getContent().slice(0, 80) }; }
}

console.log('=== UJI Code-aktivasi.gs ===\n');

const SECRET = props.RABIT_SECRET;
const tokenValid = buatTokenRab('boge', 'admin', SECRET);

console.log('[1] Proteksi tanpa token');
let r = parse(doGet({ parameter: {} }));
cek('tanpa token -> error Unauthorized', r.status === 'error' && r.message === 'Unauthorized', JSON.stringify(r));
cek('TIDAK membocorkan data', !Array.isArray(r));

r = parse(doGet({ parameter: { token: 'palsu.palsu' } }));
cek('token palsu -> ditolak', r.status === 'error', JSON.stringify(r));

r = parse(doGet({ parameter: { token: '' } }));
cek('token kosong -> ditolak', r.status === 'error');

console.log('\n[2] Token valid dari project RAB');
r = doGet({ parameter: { token: tokenValid } });
let arr;
try { arr = JSON.parse(r.getContent()); } catch (e) { arr = null; }
cek('respons adalah ARRAY polos (bentuk asli)', Array.isArray(arr), JSON.stringify(arr).slice(0, 80));
cek('baris kosong dilewati -> 2 data', Array.isArray(arr) && arr.length === 2, 'dapat ' + (arr && arr.length));
cek('kolom asli utuh (ID_PA)', arr && arr[0] && arr[0]['ID_PA'] === 'U411303002685');
cek('kolom ID PEL ada', arr && arr[0] && arr[0]['ID PEL'] === 411090024398);
cek('kolom koordinat ada', arr && arr[0] && arr[0]['TIKOR TERMINATING'] === '-5.6776, 119.1234');
cek('header di-trim (tanpa spasi)', arr && arr[0] && !(' ID_PA' in arr[0]));

console.log('\n[3] Token dari secret BERBEDA (project lain) harus ditolak');
const tokenAsing = buatTokenRab('boge', 'admin', crypto.randomBytes(32).toString('hex'));
r = parse(doGet({ parameter: { token: tokenAsing } }));
cek('secret beda -> ditolak', r.status === 'error' && r.message === 'Unauthorized', JSON.stringify(r));

console.log('\n[4] Token kedaluwarsa');
const now = Math.floor(Date.now() / 1000);
const expPayload = { u: 'boge', r: 'admin', n: 'boge', iat: 1, exp: 1 };
const expBody = Buffer.from(JSON.stringify(expPayload), 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const expSig = Buffer.from(
  crypto.createHmac('sha256', SECRET).update(expBody, 'utf8').digest()
).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
r = parse(doGet({ parameter: { token: expBody + '.' + expSig } }));
cek('token kedaluwarsa -> ditolak', r.status === 'error', JSON.stringify(r));

console.log('\n[5] Payload diubah (user lain) -> tanda tangan tidak cocok');
const parts = tokenValid.split('.');
const pl = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
pl.u = 'admin-palsu';
pl.r = 'admin';
const tamperedBody = Buffer.from(JSON.stringify(pl), 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
r = parse(doGet({ parameter: { token: tamperedBody + '.' + parts[1] } }));
cek('payload diubah -> ditolak', r.status === 'error', JSON.stringify(r));

console.log('\n[6] Token via POST body');
r = parse(doGet({ parameter: {}, postData: { contents: JSON.stringify({ token: tokenValid }) } }));
cek('token di body diterima', !r.status && Array.isArray(r) === false ? false : true);
try {
  const parsed = JSON.parse(doGet({
    parameter: {}, postData: { contents: JSON.stringify({ token: tokenValid }) }
  }).getContent());
  cek('body token -> array data', Array.isArray(parsed) && parsed.length === 2);
} catch (e) {
  cek('body token -> array data', false, e.message);
}

console.log('\n[7] RABIT_SECRET belum diset');
delete props.RABIT_SECRET;
r = parse(doGet({ parameter: { token: tokenValid } }));
cek('secret hilang -> ditolak (bukan crash)', r.status === 'error', JSON.stringify(r));
props.RABIT_SECRET = SECRET;

console.log('\n============================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('============================');
process.exit(fail ? 1 : 0);
