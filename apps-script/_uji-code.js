/**
 * Simulator Apps Script — menguji Code.gs tanpa perlu deploy.
 * Meniru Utilities, PropertiesService, ContentService, SpreadsheetApp, DriveApp.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------- Mock Apps Script runtime ----------
const props = {};
const sheetRows = [
  ['Nomor RAB', 'Judul', 'Lokasi', 'Tipe RAB (CONVEN / FTTH / FTTH 6 CORE)',
   'Tanggal', 'Total Biaya', 'File ID', 'URL D'],
  ['4389. PT. BOSOWA', 'RAB AKTIVASI VIA CONVEN', 'Tambun', 'CONVEN',
   '2026-11-11', 11983478, 'fileA', 'https://drive.google.com/file/d/fileA/preview'],
  ['4388. DINAS PERTANIAN', 'RAB AKTIVASI VIA FTTH', 'Luwu', 'FTTH',
   '2026-10-26', 26879548, 'fileB', 'https://drive.google.com/file/d/fileB/preview']
];
let fileCounter = 0;
const createdFiles = [];

global.Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  computeDigest(_alg, text) {
    const buf = crypto.createHash('sha256').update(text, 'utf8').digest();
    return Array.from(buf).map(b => (b > 127 ? b - 256 : b));
  },
  computeHmacSha256Signature(value, key) {
    const buf = crypto.createHmac('sha256', key).update(value, 'utf8').digest();
    return Array.from(buf).map(b => (b > 127 ? b - 256 : b));
  },
  base64EncodeWebSafe(str) {
    return Buffer.from(String(str), 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_');
  },
  base64DecodeWebSafe(str) {
    const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    return Array.from(Buffer.from(b64, 'base64')).map(b => (b > 127 ? b - 256 : b));
  },
  base64Decode(str) {
    return Array.from(Buffer.from(String(str), 'base64')).map(b => (b > 127 ? b - 256 : b));
  },
  newBlob(data, mime, name) {
    const bytes = Array.isArray(data) ? Buffer.from(data.map(b => (b < 0 ? b + 256 : b))) : Buffer.from(String(data));
    return { bytes, mime, name, getDataAsString: () => bytes.toString('utf8') };
  },
  getUuid() {
    return crypto.randomUUID();
  },
  formatDate(d, tz, fmt) {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
};

global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; }
  })
};

global.ContentService = {
  MimeType: { JSON: 'JSON' },
  createTextOutput(text) {
    return {
      _text: text,
      _mime: null,
      setMimeType(m) { this._mime = m; return this; },
      getContent() { return this._text; }
    };
  }
};

global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getActiveSheet: () => ({
      getDataRange: () => ({ getValues: () => sheetRows.map(r => r.slice()) }),
      appendRow: (row) => { sheetRows.push(row.slice()); }
    })
  })
};

global.DriveApp = {
  Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
  Permission: { VIEW: 'VIEW' },
  getFolderById: () => ({
    createFile: (blob) => {
      fileCounter += 1;
      const id = 'newfile' + fileCounter;
      createdFiles.push({ id, name: blob.name, bytes: blob.bytes.length });
      return {
        getId: () => id,
        setSharing: (a, p) => { createdFiles[createdFiles.length - 1].sharing = a + '/' + p; }
      };
    }
  })
};

global.Logger = { log: (m) => console.log('    LOG:', m) };

// ---------- Muat Code.gs ----------
const src = fs.readFileSync('C:/Users/fadhil.muhammad/rab/apps-script/Code.gs', 'utf8');
eval(src);

// ---------- Helper uji ----------
let pass = 0, fail = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) { pass++; console.log('  PASS  ' + nama); }
  else { fail++; console.log('  FAIL  ' + nama + (detail ? '  -> ' + detail : '')); }
}
function parse(out) {
  try { return JSON.parse(out.getContent()); } catch (e) { return { _parseError: out.getContent() }; }
}
function post(body) {
  return parse(doPost({ postData: { contents: JSON.stringify(body) }, parameter: {} }));
}
function get(params) {
  return parse(doGet({ parameter: params }));
}

(async () => {
  console.log('=== UJI Code.gs (simulator Apps Script) ===\n');

  // --- Tanpa RABIT_SECRET ---
  console.log('[1] Sebelum RABIT_SECRET diset');
  cek('login gagal bila secret belum diset',
      post({ action: 'login', username: 'boge', password: 'apa pun' }).status === 'error');
  cek('daftar user TIDAK bocor',
      !JSON.stringify(post({ action: 'login', username: 'boge', password: 'x' })).includes('salt'));

  // Set secret
  props.RABIT_SECRET = crypto.randomBytes(32).toString('hex');

  console.log('\n[2] Login');
  // Password asli untuk 'boge' tidak kita ketahui (hash dari user), jadi
  // kita buat hash tiruan agar bisa menguji alur: ganti sementara USERS['uji'].
  const salt = crypto.randomUUID();
  const hash = crypto.createHash('sha256').update(salt + ':RahasiaUji123').digest('hex');
  eval("USERS['uji'] = { name: 'User Uji', role: 'admin', salt: '" + salt + "', hash: '" + hash + "' };");

  let r = post({ action: 'login', username: 'uji', password: 'RahasiaUji123' });
  cek('login benar -> success', r.status === 'success', JSON.stringify(r));
  cek('token diterbitkan', typeof r.token === 'string' && r.token.split('.').length === 2);
  cek('role ikut di respons', r.user && r.user.role === 'admin');
  cek('expiresIn = 28800', r.expiresIn === 28800);
  const tokenUji = r.token;

  cek('login password salah -> ditolak',
      post({ action: 'login', username: 'uji', password: 'salah' }).status === 'error');
  cek('username tidak dikenal -> pesan sama (tidak bocor)',
      post({ action: 'login', username: 'tidakada', password: 'x' }).message ===
      post({ action: 'login', username: 'uji', password: 'x' }).message);
  cek('username case-insensitive (UJI)',
      post({ action: 'login', username: 'UJI', password: 'RahasiaUji123' }).status === 'success');
  cek('password kosong -> ditolak',
      post({ action: 'login', username: 'uji', password: '' }).status === 'error');

  console.log('\n[3] Token');
  cek('payload token berisi username',
      JSON.parse(Buffer.from(tokenUji.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).u === 'uji');

  let forged = tokenUji.split('.')[0] + '.' + 'x'.repeat(tokenUji.split('.')[1].length);
  cek('signature dipalsukan -> ditolak', verifikasiToken(forged) === null);

  let parts = tokenUji.split('.');
  let payloadObj = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  payloadObj.u = 'boge';
  payloadObj.r = 'admin';
  let tamperedBody = Buffer.from(JSON.stringify(payloadObj)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  cek('payload diubah (user lain) -> ditolak',
      verifikasiToken(tamperedBody + '.' + parts[1]) === null);

  cek('token kosong -> ditolak', verifikasiToken('') === null);
  cek('token tanpa titik -> ditolak', verifikasiToken('abc') === null);

  // Kedaluwarsa
  let expPayload = { u: 'uji', r: 'admin', n: 'U', iat: 1, exp: 1 };
  let expBody = Buffer.from(JSON.stringify(expPayload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let expSig = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(expBody, props.RABIT_SECRET)).replace(/=+$/, '');
  cek('token kedaluwarsa -> ditolak', verifikasiToken(expBody + '.' + expSig) === null);

  console.log('\n[4] doGet (riwayat)');
  r = get({});
  cek('tanpa token -> Unauthorized', r.status === 'error' && r.message === 'Unauthorized');
  r = get({ token: tokenUji });
  cek('dengan token -> success', r.status === 'success');
  cek('data terbaru lebih dulu (DINAS PERTANIAN ada di baris akhir sheet)',
      r.data && r.data[0] && String(r.data[0]['Nomor RAB']).includes('DINAS PERTANIAN'));
  cek('jumlah data = 2', r.data.length === 2);
  cek('filter q=BOSOWA -> 1 hasil',
      get({ token: tokenUji, q: 'bosowa' }).data.length === 1);
  cek('filter q=zzz -> 0 hasil', get({ token: tokenUji, q: 'zzz' }).data.length === 0);
  cek('struktur kolom asli utuh',
      Object.keys(r.data[0]).includes('URL D'));

  console.log('\n[5] doPost action=riwayat & simpanRab');
  r = post({ action: 'riwayat' });
  cek('riwayat tanpa token -> Unauthorized', r.status === 'error');
  r = post({ action: 'riwayat', token: tokenUji });
  cek('riwayat dengan token -> success', r.status === 'success');

  r = post({ action: 'simpanRab', token: tokenUji }); // tanpa pdf
  cek('simpan tanpa PDF -> error', r.status === 'error' && /PDF/i.test(r.message));

  const pdfB64 = Buffer.from('%PDF-1.4 uji').toString('base64');
  r = post({ action: 'simpanRab', token: tokenUji, nomorRab: 'TEST-001',
             judul: 'Uji', lokasi: 'Makassar', tipeRab: 'CONVEN',
             totalBiaya: 5000, pdfBase64: 'data:application/pdf;base64,' + pdfB64,
             fileName: 'RAB_TEST.pdf' });
  cek('simpan dengan token -> success', r.status === 'success', JSON.stringify(r));
  cek('previewUrl berformat /preview', /\/preview$/.test(r.previewUrl || ''));
  cek('file dibuat di Drive', createdFiles.length === 1);
  cek('file di-share ANYONE_WITH_LINK', createdFiles[0].sharing === 'ANYONE_WITH_LINK/VIEW');
  cek('baris baru tercatat di Sheet', sheetRows.length === 4);
  cek('tanggal tersimpan terformat', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(sheetRows[3][4])));

  console.log('\n[6] Kompatibilitas kode lama');
  cek('FOLDER_ID sesuai asli', FOLDER_ID === '1Y9maql4IUTnGljkSVSd_t89QL0RxQOB2');
  cek('doPost default action=simpanRab (bukan error "tidak dikenal")',
      post({ token: tokenUji }).message !== 'Action tidak dikenal');
  cek('action tidak dikenal -> pesan jelas',
      post({ action: 'xyz', token: tokenUji }).message === 'Action tidak dikenal');

  console.log('\n============================');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  console.log('============================');
  process.exit(fail ? 1 : 0);
})();
