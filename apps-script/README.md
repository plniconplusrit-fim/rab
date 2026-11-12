# Keamanan RABIT — Panduan Deploy

Dokumen ini mencatat perubahan keamanan dan langkah yang **harus Anda lakukan**
agar aktif. Kode di repo sudah siap; tanpa langkah deploy di bawah, login akan
gagal (karena endpoint lama belum mengenal `action: login`).

---

## Ringkasan perubahan

| Sebelum | Sesudah |
|---|---|
| Password plaintext di `index.html` (bisa dibaca View Source) | Password hanya hash di Apps Script; tidak ada di repo |
| Sesi = objek localStorage, bisa dipalsukan 1 baris | Sesi = token HMAC bertanda tangan, kedaluwarsa 8 jam |
| Endpoint RAB terbuka: siapa pun bisa membaca seluruh riwayat | Setiap operasi wajib token valid |
| Akun `admin`/`admin` | Dihapus, diganti akun spesifik |

File baru:
- `apps-script/Code.gs` — server (tempel ke editor Apps Script)
- `rab-auth.js` — klien autentikasi

File diubah: `index.html`, `auth-guard.js`, `rab-core.js`, `riwayat.html`,
`berita-acara.html`, semua halaman (urutan muat script + versi cache).

---

## Langkah deploy (urut)

### 1. Siapkan secret

Buat string acak panjang (64 hex char):

```bash
openssl rand -hex 32
```

### 2. Buka project Apps Script

Buka <https://script.google.com>, pilih project yang selama ini menangani
simpan RAB. **Backup dulu**: `File > Make a copy`.

### 3. Set Script Property

`Project Settings` (ikon gerigi) → `Script properties` → `Add script property`:

| Property | Value |
|---|---|
| `RABIT_SECRET` | hasil langkah 1 |

Tanpa ini, fungsi akan melempar error "RABIT_SECRET belum diset".

### 4. Buat hash password

Buka editor, jalankan fungsi sekali dari editor (pilih nama fungsi →
`Run`), lalu lihat `Execution log`:

```js
buatHashPassword('PASSWORD_BARU_DI_SINI')
```

Hasilnya:

```json
{ "salt": "xxxx-xxxx", "hash": "abcdef..." }
```

### 5. Isi daftar user di `Code.gs`

Cari blok `var USERS = { ... }`, ganti salt & hash dengan hasil langkah 4.
Tambahkan user baru dengan cara yang sama. Peran yang dikenal:
`admin` (semua menu) dan `smart_rab_only` (hanya Smart RAB).

**Penting**: hapus akun `admin` lama — jangan dibuat ulang.

### 6. Tempel seluruh `apps-script/Code.gs`

Ganti isi `Code.gs` di editor dengan isi file dari repo ini, lalu simpan.

Bila project Anda punya fungsi lain (mis. `doGet` untuk data Sheets aktivasi),
**gabungkan**, jangan menimpa. Fungsi yang wajib ada dari file baru:
- `doPost`, `doGet`
- `handleLogin`, `handleRiwayat`, `handleSimpanRab`
- `buatToken`, `verifikasiToken`, `sha256Hex`, `safeEquals`
- `ambilSheet`, `buatHashPassword`, `tesToken`

### 7. Deploy ulang

`Deploy` → `Manage deployments` → ikon pensil pada deployment aktif →
`Version: New version` → `Deploy`.

**Pilih "Execute as: Me"** dan **"Who has access: Anyone"** (harus `Anyone`,
karena browser memanggilnya tanpa login Google; keamanan datang dari token,
bukan dari pembatasan akses Apps Script).

### 8. Verifikasi

Buka URL `/exec`, harus membalas:

```json
{"status":"error","message":"Unauthorized"}
```

Kalau masih membalas daftar RAB, berarti token belum diwajibkan — ulangi
langkah 6–7.

Uji login dari editor:

```js
tesToken();   // harus log "token valid = YA (...)"
```

### 9. Bagikan password baru

Kirim ke pengguna lewat jalur aman (WhatsApp/email langsung, bukan grup):

| Akun | Peran |
|---|---|
| `admin@rabit.com` | admin (semua menu) |
| `iconplusmks` | smart RAB saja |

---

## Kalau ada fungsi lama yang hilang

Jika project lama punya logika tambahan (mis. `doGet` mengembalikan data
aktivasi berbeda, atau ada integrasi lain), **salin fungsi itu kembali** ke
`Code.gs` dan pastikan:

- Setiap `doGet`/`doPost` baru **memanggil `verifikasiToken()` lebih dulu**.
- Jangan kembalikan data apa pun sebelum token valid.

Contoh menambahkan endpoint baru yang aman:

```js
function handleAktivasi(body) {
  var payload = verifikasiToken(body.token);
  if (!payload) return { status: 'error', message: 'Unauthorized' };
  // ... logika Anda ...
}
```

Lalu daftarkan di `doPost`:

```js
case 'aktivasi':
  return jsonRes(handleAktivasi(body));
```

---

## Yang TIDAK bisa dilakukan static site

Perlu dipahami batasnya, supaya tidak ada rasa aman berlebih:

1. **Token tersimpan di localStorage** — pengguna yang membuka DevTools bisa
   menyalin tokennya sendiri dan memakainya 8 jam. Ini setara sedang login.
2. **Halaman HTML tetap bisa diunduh siapa pun** — file statis. Yang dilindungi
   adalah **data** (riwayat, simpan RAB). Tampilan aplikasi bukan rahasia.
3. **Tidak ada pembatasan percobaan login** di tingkat aplikasi. Apps Script
   punya kuota harian yang membatasi brute force, tapi bila butuh kontrol lebih
   ketat, tambahkan penghitung di `PropertiesService`.

---

## Rollback

Bila ada masalah, kembalikan Apps Script ke versi sebelumnya:

`Deploy` → `Manage deployments` → pilih deployment lama → `New version` dari
versi sebelumnya. Lalu `git revert` commit terkait di repo.
