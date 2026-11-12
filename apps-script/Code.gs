/**
 * RABIT — Server (Google Apps Script)
 * ============================================================================
 * GABUNGAN kode asli (simpan PDF ke Drive + catat riwayat ke Sheets) dengan
 * lapisan autentikasi baru (login hash + token bertanda tangan).
 *
 * CARA PASANG:
 *   1. Buka project Apps Script yang sudah berjalan.
 *   2. Backup dulu: File > Make a copy.
 *   3. Ganti SELURUH isi Code.gs dengan file ini.
 *   4. Project Settings > Script properties > tambah RABIT_SECRET (wajib).
 *   5. Deploy > Manage deployments > pensil > Version: New version > Deploy
 *      (Execute as: Me, Who has access: Anyone).
 *
 * YANG DIPERTAHANKAN DARI KODE ASLI (perilaku tidak diubah):
 *   - FOLDER_ID Anda: 1Y9maql4IUTnGljkSVSd_t89QL0RxQOB2
 *   - File PDF di-share ANYONE_WITH_LINK agar preview web berjalan
 *   - previewUrl berformat /preview (dipakai iframe di riwayat.html)
 *   - Urutan riwayat: terbaru -> terlama
 *   - Filter pencarian q pada Nomor RAB / Judul / Lokasi
 *   - Format tanggal simpan: yyyy-MM-dd HH:mm zona GMT+8
 *   - Bentuk respons: { status, data } dan { status, message, fileId, previewUrl }
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// KONFIGURASI
// ---------------------------------------------------------------------------

/** Folder Drive tujuan PDF (dari kode asli, jangan diubah). */
var FOLDER_ID = '1Y9maql4IUTnGljkSVSd_t89QL0RxQOB2';

/** Umur token (detik). 8 jam. */
var TOKEN_TTL_SECONDS = 8 * 60 * 60;

/** Nama Script Property yang menyimpan kunci tanda tangan token. */
var SECRET_PROP = 'RABIT_SECRET';

// ---------------------------------------------------------------------------
// DAFTAR USER
// ---------------------------------------------------------------------------
// hash = SHA-256(salt + ':' + password) dalam bentuk hex.
// Password plaintext TIDAK pernah disimpan di sini.
// Tambah akun dengan: node apps-script/siapkan-user.js
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

// ===========================================================================
// UTIL: RESPONS
// ===========================================================================

function jsonRes(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===========================================================================
// UTIL: KRIPTO
// ===========================================================================

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

/** Buat token: base64url(payload) + '.' + base64url(hmac) */
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

  // Bila RABIT_SECRET belum diset, tolak dengan aman (jangan lempar error).
  var expected;
  try {
    expected = base64UrlEncode(Utilities.computeHmacSha256Signature(body, secret()));
  } catch (e) {
    return null;
  }

  if (!safeEquals(sig, expected)) return null;

  var payload;
  try {
    payload = JSON.parse(base64UrlDecode(body));
  } catch (e) {
    return null;
  }

  var now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;   // kedaluwarsa
  if (!payload.u || !USERS[payload.u]) return null;      // user sudah dihapus

  return payload;
}

/**
 * Ambil token dari request. Menerima beberapa bentuk agar kompatibel:
 *   1. body.token             -> POST (dipakai rab-auth.js)
 *   2. e.parameter.token      -> GET  (?token=...)
 */
function tokenDariRequest(e, body) {
  if (body && body.token) return String(body.token);
  if (e && e.parameter && e.parameter.token) return String(e.parameter.token);
  return '';
}

// ===========================================================================
// GET — riwayat RAB (kini WAJIB token)
// ===========================================================================
function doGet(e) {
  try {
    var payload = verifikasiToken(tokenDariRequest(e, null));
    if (!payload) {
      return jsonRes({ status: 'error', message: 'Unauthorized' });
    }

    // ---- sisa logika kode asli, perilaku tidak diubah ----
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var rows = sheet.getDataRange().getValues();

    if (rows.length <= 1) {
      return jsonRes({ status: 'success', data: [] });
    }

    var headers = rows[0];
    var data = [];

    // Ambil data dari baris terbaru ke terlama
    for (var i = rows.length - 1; i >= 1; i--) {
      var item = {};
      for (var j = 0; j < headers.length; j++) {
        item[headers[j]] = rows[i][j];
      }
      data.push(item);
    }

    // Jika ada filter pencarian (q)
    var q = (e && e.parameter && e.parameter.q)
      ? String(e.parameter.q).toLowerCase()
      : null;
    var filtered = data;
    if (q) {
      filtered = data.filter(function (it) {
        return String(it['Nomor RAB']).toLowerCase().indexOf(q) > -1 ||
               String(it['Judul']).toLowerCase().indexOf(q) > -1 ||
               String(it['Lokasi']).toLowerCase().indexOf(q) > -1;
      });
    }

    return jsonRes({ status: 'success', data: filtered });

  } catch (error) {
    return jsonRes({ status: 'error', message: error.toString() });
  }
}

// ===========================================================================
// POST — login + simpan RAB
// ===========================================================================
function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }

    var action = body.action || 'simpanRab';

    // Login tidak butuh token (justru menghasilkan token).
    if (action === 'login') {
      return jsonRes(handleLogin(body));
    }

    // Aksi lain wajib token.
    if (!verifikasiToken(tokenDariRequest(e, body))) {
      return jsonRes({ status: 'error', message: 'Unauthorized' });
    }

    switch (action) {
      case 'riwayat':
        return jsonRes(handleRiwayat(body));
      case 'simpanRab':
        return jsonRes(handleSimpanRab(body));
      default:
        return jsonRes({ status: 'error', message: 'Action tidak dikenal' });
    }

  } catch (err) {
    return jsonRes({ status: 'error', message: String((err && err.message) || err) });
  }
}

// ===========================================================================
// HANDLER: LOGIN
// ===========================================================================
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

  // Pesan seragam: jangan bocorkan apakah username terdaftar atau tidak.
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

// ===========================================================================
// HANDLER: RIWAYAT (untuk POST action=riwayat)
// ===========================================================================
// Catatan: fungsi ini mengembalikan OBJEK data, bukan ContentService output.
// doGet() sudah membungkus sendiri hasilnya, jadi tidak boleh didelegasikan
// langsung — kalau didelegasikan, respons jadi {status: undefined}.
function handleRiwayat(body) {
  var payload = verifikasiToken(body && body.token);
  if (!payload) {
    return { status: 'error', message: 'Unauthorized' };
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var rows = sheet.getDataRange().getValues();

  if (rows.length <= 1) {
    return { status: 'success', data: [] };
  }

  var headers = rows[0];
  var data = [];

  // Urutan sama seperti kode asli: terbaru -> terlama
  for (var i = rows.length - 1; i >= 1; i--) {
    var item = {};
    for (var j = 0; j < headers.length; j++) {
      item[headers[j]] = rows[i][j];
    }
    data.push(item);
  }

  var q = body.q ? String(body.q).toLowerCase() : null;
  var filtered = data;
  if (q) {
    filtered = data.filter(function (it) {
      return String(it['Nomor RAB']).toLowerCase().indexOf(q) > -1 ||
             String(it['Judul']).toLowerCase().indexOf(q) > -1 ||
             String(it['Lokasi']).toLowerCase().indexOf(q) > -1;
    });
  }

  return { status: 'success', data: filtered };
}

// ===========================================================================
// HANDLER: SIMPAN RAB (logika kode asli dipertahankan)
// ===========================================================================
function handleSimpanRab(body) {
  var nomorRab = body.nomorRab;
  var judul = body.judul;
  var lokasi = body.lokasi;
  var tipeRab = body.tipeRab;
  var tanggal = body.tanggal;
  var totalBiaya = body.totalBiaya;
  var pdfBase64 = body.pdfBase64;
  var fileName = body.fileName;

  if (!pdfBase64) {
    return { status: 'error', message: 'Data PDF kosong' };
  }

  // A. Simpan file PDF ke Folder Google Drive
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var cleanBase64 = String(pdfBase64).replace(/^data:application\/pdf;base64,/, '');
  var decodedBytes = Utilities.base64Decode(cleanBase64);
  var blob = Utilities.newBlob(
    decodedBytes,
    'application/pdf',
    fileName || ('RAB_' + nomorRab + '.pdf')
  );
  var file = folder.createFile(blob);

  // Set izin agar file bisa dilihat melalui preview web
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  var fileId = file.getId();
  var previewUrl = 'https://drive.google.com/file/d/' + fileId + '/preview';

  // B. Catat Riwayat ke Spreadsheet
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.appendRow([
    nomorRab || '-',
    judul || '-',
    lokasi || '-',
    tipeRab || '-',
    tanggal || Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm'),
    totalBiaya || 0,
    fileId,
    previewUrl
  ]);

  return {
    status: 'success',
    message: 'Berhasil disimpan ke Google Drive dan Riwayat!',
    fileId: fileId,
    previewUrl: previewUrl
  };
}

// ===========================================================================
// ALAT BANTU (jalankan manual dari editor Apps Script)
// ===========================================================================

/** Uji cepat: token dibuat & diverifikasi dengan benar? */
function tesToken() {
  var nama = Object.keys(USERS);
  if (!nama.length) {
    Logger.log('USERS kosong');
    return;
  }
  var t = buatToken(nama[0]);
  var p = verifikasiToken(t);
  Logger.log('Akun terdaftar: ' + nama.join(', '));
  Logger.log('token valid = ' + (p ? 'YA (' + p.u + ', role=' + p.r + ')' : 'TIDAK'));
}

/** Uji bahwa akses tanpa token ditolak. */
function tesTanpaToken() {
  var hasil = doGet({ parameter: {} });
  Logger.log('tanpa token -> ' + hasil.getContent());
}

/** Buat salt+hash password baru tanpa perlu Node.js. */
function buatHashPassword(password) {
  var salt = Utilities.getUuid();
  var hash = sha256Hex(salt + ':' + password);
  Logger.log(JSON.stringify({ salt: salt, hash: hash }, null, 2));
  return { salt: salt, hash: hash };
}
