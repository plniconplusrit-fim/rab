/**
 * siapkan-user.js — Membuat salt+hash dan blok USERS untuk Code.gs.
 *
 * Pemakaian:
 *   node apps-script/siapkan-user.js
 *
 * Skrip menanyakan username, nama, role, dan password; lalu mencetak blok
 * JavaScript siap tempel ke bagian USERS di apps-script/Code.gs.
 *
 * Hash memakai algoritma yang SAMA dengan Apps Script:
 *   SHA-256(salt + ':' + password) -> hex
 * sehingga hasilnya langsung cocok saat diverifikasi server.
 *
 * Password tidak disimpan ke disk dan tidak dicetak balik.
 */

const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

/* Buffer baris yang datang lebih awal (input dipipe) agar tidak hilang. */
const antrean = [];
let penunggu = null;

rl.on('line', (l) => {
  const v = String(l).replace(/\r$/, '');
  if (penunggu) {
    const p = penunggu;
    penunggu = null;
    p(v);
  } else {
    antrean.push(v);
  }
});

function baris() {
  if (antrean.length) return Promise.resolve(antrean.shift());
  return new Promise((res) => { penunggu = res; });
}

async function tanya(q) {
  process.stdout.write(q);
  const v = await baris();
  return String(v).trim();
}

/* Password: di TTY disembunyikan; saat dipipe dibaca seperti baris biasa. */
async function tanyaPassword(q) {
  if (!process.stdin.isTTY) {
    return tanya(q);
  }

  process.stdout.write(q);
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  rl.pause();

  return new Promise((res) => {
    let buf = '';
    const onData = (ch) => {
      const s = ch.toString('utf8');
      if (s === '\r' || s === '\n') {
        stdin.setRawMode(wasRaw || false);
        stdin.removeListener('data', onData);
        stdin.pause();
        process.stdout.write('\n');
        rl.resume();
        res(buf);
      } else if (s === '\u0003') {
        process.stdout.write('\nDibatalkan.\n');
        process.exit(1);
      } else if (s === '\u007f' || s === '\b') {
        buf = buf.slice(0, -1);
      } else {
        buf += s;
      }
    };
    stdin.on('data', onData);
  });
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function main() {
  console.log('=== Pembuat User RABIT ===\n');

  const jumlah = parseInt(await tanya('Berapa user yang ingin dibuat? [1] '), 10) || 1;
  const hasil = [];

  for (let i = 0; i < jumlah; i++) {
    console.log(`\n--- User ${i + 1} dari ${jumlah} ---`);

    const username = await tanya('Username (mis. admin@rabit.com): ');
    if (!username) {
      console.log('  Username kosong — dilewati.');
      continue;
    }

    const nama = await tanya('Nama tampilan (mis. Admin Pusat): ');
    const role = await tanya('Role [admin / smart_rab_only]: ');

    if (role !== 'admin' && role !== 'smart_rab_only') {
      console.log('  Role harus "admin" atau "smart_rab_only" — dilewati.');
      continue;
    }

    const pass1 = await tanyaPassword('Password (min. 10 karakter): ');
    if (pass1.length < 10) {
      console.log(`  Password hanya ${pass1.length} karakter, minimal 10 — dilewati.`);
      continue;
    }

    const pass2 = await tanyaPassword('Ulangi password: ');
    if (pass1 !== pass2) {
      console.log('  Password tidak sama — dilewati.');
      continue;
    }

    const salt = crypto.randomUUID();
    const hash = sha256Hex(salt + ':' + pass1);
    hasil.push({ username, nama: nama || username, role, salt, hash });
    console.log(`  Berhasil: ${username} (${role})`);
  }

  if (!hasil.length) {
    console.log('\nTidak ada user yang dibuat.');
    rl.close();
    return;
  }

  console.log('\n\n===== TEMPEL BLOK INI KE apps-script/Code.gs =====\n');
  console.log('var USERS = {');
  hasil.forEach((u, i) => {
    console.log(`  '${u.username}': {`);
    console.log(`    name: '${u.nama}',`);
    console.log(`    role: '${u.role}',`);
    console.log(`    salt: '${u.salt}',`);
    console.log(`    hash: '${u.hash}'`);
    console.log(`  }${i < hasil.length - 1 ? ',' : ''}`);
  });
  console.log('};');
  console.log('\n===== SELESAI =====');
  console.log('\nCatat password Anda sekarang — skrip ini tidak menyimpannya,');
  console.log('dan password tidak bisa dipulihkan dari hash.');
  rl.close();
}

main().catch((e) => {
  console.error('\nError:', e.message);
  rl.close();
  process.exit(1);
});
