/**
 * RABIT — Auth & API Server (Google Apps Script)
 * ============================================================================
 * Tempel file ini ke editor Apps Script (script.google.com) pada project yang
 * SAMA dengan yang selama ini menangani simpan RAB ke Drive/Sheets, lalu
 * Deploy > Manage deployments > Edit > Version: New version > Deploy.
 *
 * Yang berubah dibanding versi lama:
 *   1. Password TIDAK lagi disimpan di HTML. Daftar user ada di sini, disimpan
 *      sebagai hash SHA-256 + salt. Nilai plaintext tidak pernah ada di repo.
 *   2. doPost('login') menerbitkan token bertanda tangan (HMAC-SHA256) berlaku
 *      8 jam. Token inilah yang dipakai untuk semua operasi sesudahnya.
 *   3. Setiap operasi data (simpan RAB, baca riwayat) WAJIB menyertakan token
 *      yang valid. Tanpa token -> ditolak.
 *
 * KONFIGURASI AWAL (wajib, sekali):
 *   Buka Project Settings > Script properties, tambahkan:
 *     RABIT_SECRET  = <string acak panjang>   (dipakai untuk tanda tangan token)
 *   Buat dengan: bash -c "openssl rand -hex 32"
 *   JANGAN taruh secret ini di kode atau di repo.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// KONFIGURASI
// ---------------------------------------------------------------------------

/** Umur token (detik). 8 jam. */
var TOKEN_TTL_SECONDS = 8 * 60 * 60;

/** Nama Script Property yang menyimpan kunci tanda tangan. */
var SECRET_PROP = 'RABIT_SECRET';

/** ID Spreadsheet riwayat. Kosongkan bila skrip terikat (bound) ke Sheet. */
var SPREADSHEET_ID = '';

/** Nama sheet riwayat. */
var SHEET_NAME = 'Riwayat';

/** Folder Drive tujuan PDF. Kosongkan = root Drive. */
var DRIVE_FOLDER_ID = '';

// ---------------------------------------------------------------------------
// DAFTAR USER
// ---------------------------------------------------------------------------
// Format: username -> { name, role, salt, hash }
// hash = SHA-256(salt + ':' + password) dalam hex.
//
// Password sudah diganti (tidak lagi 'admin', 'rabit123', '12345').
// Untuk membuat hash password baru, jalankan buatHashPassword('passwordbaru')
// dari editor Apps Script, atau (lebih mudah) jalankan di terminal repo:
//   node apps-script/siapkan-user.js
//
// Akun yang terdaftar saat ini: 'boge' (admin) dan 'iconmks' (smart RAB saja).
var USERS = {
  'boge': {
    name: 'boge',
    role: 'admin',
    salt: 'c13066f8-4d86-4971-ba54-b42d9857e00d',
    hash: '26d0fb1e2c2e2306c6a321cb4c5cbf80e9ec0ae0c77564c221b13df714d54c04'
  },
  'iconmks': {
    name: 'iconmks',
    role: 'smart_rab_only',
    salt: '80fb92c3-dfc5-4bd5-9a2b-94485db8f23e',
    hash: 'fbf1a45b2ab1ba4facf38885ad0ec9b427e094de8092e449895861f52cdecd13'
  }
};

// ---------------------------------------------------------------------------
// UTIL KRIPTO
// ---------------------------------------------------------------------------

function sha256Hex(text) {
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8
  );
  return raw.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/** Bandingkan string dengan waktu konstan (kurangi timing attack). */
function safeEquals(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function secret() {
  var s = PropertiesService.getScriptProperties().getProperty(SECRET_PROP);
  if (!s) {
    throw new Error(
      'RABIT_SECRET belum diset di Project Settings > Script properties.'
    );
  }
  return s;
}

function base64UrlEncode(str) {
  return Utilities.base64EncodeWebSafe(str, Utilities.Charset.UTF_8).replace(/=+$/, '');
}

function base64UrlDecode(str) {
  var pad = str.length % 4 === 0 ? '' : new Array(5 - (str.length % 4)).join('=');
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(str + pad)).getDataAsString();
}

/** Buat token: base64(payload) + '.' + base64(hmac) */
function buatToken(username) {
  var user = USERS[username];
  if (!user) throw new Error('User tidak dikenal');

  var now = Math.floor(Date.now() / 1000);
  var payload = {
    u: username,
    r: user.role,
    n: user.name,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS
  };

  var body = base64UrlEncode(JSON.stringify(payload));
  var sig = base64UrlEncode(Utilities.computeHmacSha256Signature(body, secret()));
  return body + '.' + sig;
}

/** Verifikasi token. Mengembalikan payload bila valid, null bila tidak. */
function verifikasiToken(token) {
  if (!token || typeof token !== 'string') return null;

  var parts = token.split('.');
  if (parts.length !== 2) return null;

  var body = parts[0];
  var sig = parts[1];

  var expected = base64UrlEncode(Utilities.computeHmacSha256Signature(body, secret()));
  if (!safeEquals(sig, expected)) return null;

  var payload;
  try {
    payload = JSON.parse(base64UrlDecode(body));
  } catch (e) {
    return null;
  }

  var now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;
  if (!payload.u || !USERS[payload.u]) return null;

  return payload;
}

// ---------------------------------------------------------------------------
// ENTRY POINT
// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }

    var action = body.action || 'simpanRab';

    switch (action) {
      case 'login':
        return jsonRes(handleLogin(body));
      case 'riwayat':
        return jsonRes(handleRiwayat(body));
      case 'simpanRab':
        return jsonRes(handleSimpanRab(body));
      default:
        return jsonRes({ status: 'error', message: 'Action tidak dikenal' });
    }
  } catch (err) {
    return jsonRes({ status: 'error', message: String(err && err.message || err) });
  }
}

/** GET tetap dipertahankan untuk kompatibilitas, tapi kini WAJIB token. */
function doGet(e) {
  var token = (e && e.parameter && e.parameter.token) || '';
  var payload = verifikasiToken(token);

  if (!payload) {
    return jsonRes({ status: 'error', message: 'Unauthorized' });
  }
  return jsonRes(handleRiwayat({ token: token }));
}

function jsonRes(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// HANDLER
// ---------------------------------------------------------------------------

function handleLogin(body) {
  var username = String(body.username || '').trim().toLowerCase();
  var password = String(body.password || '');

  if (!username || !password) {
    return { status: 'error', message: 'Username dan password wajib diisi' };
  }

  var user = null;
  var key = null;
  for (var k in USERS) {
    if (k.toLowerCase() === username) {
      key = k;
      user = USERS[k];
      break;
    }
  }

  // Pesan error seragam: jangan bocorkan apakah username ada atau tidak.
  var GAGAL = { status: 'error', message: 'Username atau password salah' };
  if (!user) return GAGAL;

  var hash = sha256Hex(user.salt + ':' + password);
  if (!safeEquals(hash, user.hash)) return GAGAL;

  return {
    status: 'success',
    token: buatToken(key),
    user: { username: key, name: user.name, role: user.role },
    expiresIn: TOKEN_TTL_SECONDS
  };
}

function handleRiwayat(body) {
  var payload = verifikasiToken(body.token);
  if (!payload) {
    return { status: 'error', message: 'Unauthorized' };
  }

  var sheet = ambilSheet();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return { status: 'success', data: [] };
  }

  var headers = values[0];
  var rows = values.slice(1).map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });

  return { status: 'success', data: rows };
}

function handleSimpanRab(body) {
  var payload = verifikasiToken(body.token);
  if (!payload) {
    return { status: 'error', message: 'Unauthorized' };
  }

  if (!body.pdfBase64 || !body.fileName) {
    return { status: 'error', message: 'Data tidak lengkap' };
  }

  // Simpan PDF ke Drive
  var base64 = String(body.pdfBase64).replace(/^data:application\/pdf;base64,/, '');
  var blob = Utilities.newBlob(
    Utilities.base64Decode(base64),
    'application/pdf',
    body.fileName
  );

  var folder = DRIVE_FOLDER_ID ? DriveApp.getFolderById(DRIVE_FOLDER_ID) : DriveApp.getRootFolder();
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);

  // Catat ke Sheets
  var sheet = ambilSheet();
  sheet.appendRow([
    body.nomorRab || '',
    body.judul || '',
    body.lokasi || '',
    body.tipeRab || '',
    new Date(),
    Number(body.totalBiaya) || 0,
    file.getId(),
    'https://drive.google.com/file/d/' + file.getId() + '/view',
    payload.u
  ]);

  return {
    status: 'success',
    message: 'Tersimpan',
    fileId: file.getId(),
    url: 'https://drive.google.com/file/d/' + file.getId() + '/view'
  };
}

function ambilSheet() {
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'Nomor RAB', 'Judul', 'Lokasi', 'Tipe RAB (CONVEN / FTTH / FTTH 6 CORE)',
      'Tanggal', 'Total Biaya', 'File ID', 'URL Drive', 'Dibuat Oleh'
    ]);
  }
  return sheet;
}

// ---------------------------------------------------------------------------
// ALAT BANTU PEMBUATAN USER (jalankan manual dari editor)
// ---------------------------------------------------------------------------

/**
 * Jalankan dari editor Apps Script untuk membuat salt+hash password baru.
 * Hasilnya disalin ke objek USERS di atas.
 *
 * Contoh: buatHashPassword('PasswordBaruYangKuat123!')
 */
function buatHashPassword(password) {
  var salt = Utilities.getUuid();
  var hash = sha256Hex(salt + ':' + password);
  var hasil = { salt: salt, hash: hash };
  Logger.log(JSON.stringify(hasil, null, 2));
  return hasil;
}

/** Uji cepat: pastikan token dibuat & diverifikasi dengan benar. */
function tesToken() {
  var t = buatToken(Object.keys(USERS)[0]);
  var p = verifikasiToken(t);
  Logger.log('token valid = ' + (p ? 'YA (' + p.u + ')' : 'TIDAK'));
}
