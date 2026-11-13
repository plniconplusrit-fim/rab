/**
 * Data Aktivasi — Server (Google Apps Script)
 * ============================================================================
 * Kode ASLI (doGet membaca Sheet -> JSON array) DIPERTAHANKAN PERSIS,
 * ditambah satu lapisan: wajib token login RABIT.
 *
 * KENAPA: sebelumnya siapa pun yang tahu URL bisa mengunduh 620 baris data
 * pelanggan (ID PEL, alamat, koordinat GPS) tanpa login.
 *
 * CARA PASANG:
 *   1. Buka project Apps Script yang menghasilkan data aktivasi.
 *   2. Backup dulu: File > Make a copy.
 *   3. Ganti seluruh isi file kode dengan file ini.
 *   4. Pastikan RABIT_SECRET SAMA PERSIS dengan yang dipakai endpoint RAB.
 *      (Token RABIT ditandatangani dengan secret itu; kalau beda, token ditolak.)
 *   5. Deploy > Manage deployments > pensil > Version: New version > Deploy
 *      (Execute as: Me, Who has access: Anyone).
 *
 * PENTING: bentuk respons TIDAK diubah — masih array JSON polos
 *   [{ "NO": 1, "ID_PA": "...", ... }, ...]
 * sehingga berita-acara.html tetap bisa membacanya tanpa perubahan format.
 * Bila tidak ada token / token tidak valid, respons menjadi objek error.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// KONFIGURASI
// ---------------------------------------------------------------------------

/** Nama Script Property berisi kunci tanda tangan token (sama dengan project RAB). */
var SECRET_PROP = 'RABIT_SECRET';

// ---------------------------------------------------------------------------
// UTIL: KRIPTO & TOKEN
// ---------------------------------------------------------------------------

function secret() {
  var s = PropertiesService.getScriptProperties().getProperty(SECRET_PROP);
  if (!s) {
    throw new Error(
      'Properti "' + SECRET_PROP + '" belum diset di Project Settings > Script properties.'
    );
  }
  return s;
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

/**
 * Penanda tangan kolom ke VERSI RABIT (Kode.gs di project RAB).
 * Versi lama: base64UrlEncode(computeHmacSha256Signature(...)) -> SALAH,
 *   karena computeHmacSha256Signature mengembalikan number[] dan
 *   base64EncodeWebSafe menolak kombinasi (number[], Charset).
 * Versi benar: panggil base64EncodeWebSafe TANPA Charset.
 */
function bytesToBase64Url(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function base64UrlDecode(str) {
  var pad = str.length % 4 === 0 ? '' : new Array(5 - (str.length % 4)).join('=');
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(str + pad)).getDataAsString();
}

/**
 * Verifikasi token RABIT. Mengembalikan payload bila valid, null bila tidak.
 * Token dibuat oleh project RAB (buatToken) dengan RABIT_SECRET yang sama.
 *
 * Catatan: TIDAK mengecek keberadaan user di USERS, karena daftar user ada di
 * project RAB, bukan di sini. Yang diverifikasi: tanda tangan HMAC, masa
 * berlaku, dan struktur payload. Tanda tangan itulah jaminan keasliannya —
 * tanpa RABIT_SECRET, token tidak bisa dipalsukan.
 */
function verifikasiToken(token) {
  if (!token || typeof token !== 'string') return null;

  var parts = token.split('.');
  if (parts.length !== 2) return null;

  var body = parts[0];
  var sig = parts[1];

  var expected;
  try {
    expected = bytesToBase64Url(Utilities.computeHmacSha256Signature(body, secret()));
  } catch (e) {
    return null; // RABIT_SECRET belum diset -> tolak, jangan lempar error
  }

  if (!safeEquals(sig, expected)) return null;

  var payload;
  try {
    payload = JSON.parse(base64UrlDecode(body));
  } catch (e) {
    return null;
  }

  var now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;  // kedaluwarsa
  if (!payload.u) return null;                          // tanpa identitas user

  return payload;
}

/** Ambil token dari request: ?token=... atau POST body.token */
function tokenDariRequest(e) {
  if (!e) return '';
  if (e.parameter && e.parameter.token) return String(e.parameter.token);

  try {
    if (e.postData && e.postData.contents) {
      var b = JSON.parse(e.postData.contents);
      if (b && b.token) return String(b.token);
    }
  } catch (err) {}

  return '';
}

function errOut(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===========================================================================
// doGet — WAJIB token, lalu jalankan logika asli tanpa perubahan
// ===========================================================================

function doGet(e) {
  // ---- lapisan baru: autentikasi ----
  var payload = verifikasiToken(tokenDariRequest(e));
  if (!payload) {
    return errOut('Unauthorized');
  }

  // ---- mulai bagian kode asli (tidak diubah) ----
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = sheet.getDataRange().getValues();

    // Asumsi Baris 1 adalah Header / Judul Kolom
    var headers = data[0];
    var result = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      // Lewati jika baris kosong
      if (!row[0]) continue;

      var item = {};
      for (var j = 0; j < headers.length; j++) {
        var headerName = headers[j].toString().trim();
        item[headerName] = row[j];
      }
      result.push(item);
    }

    // Return JSON dengan akses CORS terbuka (bentuk TIDAK diubah)
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return errOut(error.toString());
  }
}

// ===========================================================================
// ALAT BANTU (jalankan manual dari editor)
// ===========================================================================

/** Uji: token dari project RAB diterima? */
function tesToken() {
  var t = PropertiesService.getScriptProperties().getProperty('TES_TOKEN_UJI');
  if (!t) {
    Logger.log('Belum ada TES_TOKEN_UJI. Buka aplikasi RAB, login, lalu ambil token');
    Logger.log('dari localStorage (key rabit_auth) dan simpan sebagai properti TES_TOKEN_UJI.');
    return;
  }
  var p = verifikasiToken(t);
  Logger.log('token valid = ' + (p ? 'YA (' + p.u + ', role=' + p.r + ')' : 'TIDAK'));
}

/** Uji: akses tanpa token harus ditolak. */
function tesTanpaToken() {
  var out = doGet({ parameter: {} });
  Logger.log('tanpa token -> ' + out.getContent());
}

/** Uji: sekaligus cek data terbaca (butuh token valid). */
function tesDenganToken() {
  var t = PropertiesService.getScriptProperties().getProperty('TES_TOKEN_UJI');
  if (!t) { Logger.log('TES_TOKEN_UJI belum diset'); return; }
  var out = doGet({ parameter: { token: t } });
  var txt = out.getContent();
  Logger.log('panjang respons = ' + txt.length);
  Logger.log('awal: ' + txt.slice(0, 150));
}
