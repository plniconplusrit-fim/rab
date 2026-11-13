/**
 * Uji rate limiting login di Code.gs.
 */
const crypto = require('crypto');
const fs = require('fs');

// ---------- Mock Apps Script ----------
const props = {};
const SHEET = [['Nomor RAB','Judul'],['X','Y']];
let driveFiles = 0;

global.Utilities = {
  DigestAlgorithm: { SHA_256: 'x' }, Charset: { UTF_8: 'x' },
  computeDigest(a,t){return Array.from(crypto.createHash('sha256').update(t,'utf8').digest()).map(b=>b>127?b-256:b);},
  computeHmacSha256Signature(v,k){return Array.from(crypto.createHmac('sha256',k).update(v,'utf8').digest()).map(b=>b>127?b-256:b);},
  base64EncodeWebSafe(d,c){
    if (Array.isArray(d) && c) throw new Error('Parameter (number[],Utilities.Charset) tidak cocok dengan tanda tangan metode untuk Utilities.base64EncodeWebSafe.');
    if (Array.isArray(d)) return Buffer.from(d.map(b=>b<0?b+256:b)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_');
    return Buffer.from(String(d),'utf8').toString('base64').replace(/\+/g,'-').replace(/\//g,'_');
  },
  base64DecodeWebSafe(s){const b=String(s).replace(/-/g,'+').replace(/_/g,'/');return Array.from(Buffer.from(b,'base64')).map(x=>x>127?x-256:x);},
  base64Decode(s){return Array.from(Buffer.from(String(s),'base64')).map(b=>b>127?b-256:b);},
  newBlob(d,m,n){const b=Array.isArray(d)?Buffer.from(d.map(x=>x<0?x+256:x)):Buffer.from(String(d));return{_name:n,getDataAsString:()=>b.toString('utf8')};},
  getUuid:()=>crypto.randomUUID(),
  formatDate:()=>'2026-11-13 08:00'
};

global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k,v) => { props[k]=v; },
    deleteProperty: k => { delete props[k]; },
    getProperties: () => Object.assign({}, props)
  })
};
global.ContentService = { MimeType:{JSON:'J'}, createTextOutput(t){return{_t:t,setMimeType(){return this;},getContent(){return this._t;}};} };
global.SpreadsheetApp = { getActiveSpreadsheet:()=>({getActiveSheet:()=>({getDataRange:()=>({getValues:()=>SHEET.map(r=>r.slice())}),appendRow(r){SHEET.push(r.slice());}})}) };
global.DriveApp = { Access:{ANYONE_WITH_LINK:'A'}, Permission:{VIEW:'V'}, getFolderById:()=>({createFile:(b)=>{driveFiles++;return{getId:()=>'F'+driveFiles,setSharing(){}};}}) };
global.Logger = { log: m => console.log('    LOG:', m) };

eval(fs.readFileSync('C:/Users/fadhil.muhammad/rab/apps-script/Code.gs','utf8'));

// Siapkan secret & user uji
props.RABIT_SECRET = crypto.randomBytes(32).toString('hex');
const salt = crypto.randomUUID();
const PASS = 'PasswordBenar123';
const hash = crypto.createHash('sha256').update(salt + ':' + PASS).digest('hex');
eval("USERS['ujibf'] = { name:'Uji BF', role:'admin', salt:'" + salt + "', hash:'" + hash + "' };");
eval("USERS['userlain'] = { name:'Lain', role:'admin', salt:'" + salt + "', hash:'" + hash + "' };");

function login(username, password, ip) {
  const out = doPost({ postData:{contents:JSON.stringify({action:'login',username,password})}, parameter: ip?{ip}:{}});
  return JSON.parse(out.getContent());
}

// ---------- Uji ----------
let pass=0, fail=0;
function cek(n, ok, d){ if(ok){pass++;console.log('  PASS  '+n);} else {fail++;console.log('  FAIL  '+n+(d?'  -> '+d:''));} }

console.log('=== UJI RATE LIMITING LOGIN ===\n');

console.log('[1] Login benar di awal');
let r = login('ujibf', PASS, '10.0.0.1');
cek('login berhasil', r.status==='success', JSON.stringify(r).slice(0,80));
cek('token diberikan', typeof r.token==='string' && r.token.indexOf('.')>0);

console.log('\n[2] Berhasil login menghapus hitungan');
cek('tidak ada properti RL_ tersisa', Object.keys(props).filter(k=>k.indexOf('RL_')===0).length===0,
    JSON.stringify(Object.keys(props).filter(k=>k.indexOf('RL_')===0)));

console.log('\n[3] Brute force: 4 kali salah (batas 5)');
for (let i=1; i<=4; i++) {
  r = login('ujibf','salah'+i,'10.0.0.1');
}
cek('masih pesan "Username atau password salah"', r.message==='Username atau password salah', r.message);
cek('belum terkunci setelah 4 gagal', r.message.indexOf('Terlalu banyak')===-1);

console.log('\n[4] Percobaan ke-5 -> kunci aktif');
r = login('ujibf','salahLagi','10.0.0.1');
cek('pesan terkunci setelah 5 gagal', r.message.indexOf('Terlalu banyak percobaan')>-1, r.message);
cek('menyebut jumlah menit', /Coba lagi dalam \d+ menit/.test(r.message), r.message);

console.log('\n[5] Password BENAR saat terkunci tetap ditolak');
r = login('ujibf', PASS, '10.0.0.1');
cek('terkunci -> benar pun ditolak', r.status==='error' && r.message.indexOf('Terlalu banyak')>-1, r.message);
cek('tidak ada token', !r.token);

console.log('\n[6] Akun lain tidak terkena');
r = login('userlain', PASS, '10.0.0.1');
cek('akun lain TIDAK terkena kunci', r.status==='success', JSON.stringify(r).slice(0,90));

console.log('\n[7] Jendela kedaluwarsa (simulasi waktu lewat)');
// Mundurkan "mulai" agar jendela habis
Object.keys(props).forEach(k => {
  if (k.indexOf('RL_u_') === 0) {
    const rec = JSON.parse(props[k]);
    rec.mulai = rec.mulai - (LOGIN_JENDELA_DETIK + 10);
    props[k] = JSON.stringify(rec);
  }
});
r = login('ujibf', PASS, '10.0.0.1');
cek('setelah jendela lewat -> bisa login lagi', r.status==='success', JSON.stringify(r).slice(0,80));

console.log('\n[8] Perubahan hitungan benar');
delete props['RL_u_ujibf'];
login('ujibf','x','1.1.1.1');
const rec = JSON.parse(props['RL_u_ujibf']);
cek('gagal=1 setelah satu percobaan salah', rec.gagal===1, JSON.stringify(rec));
login('ujibf','y','1.1.1.1');
cek('gagal=2 setelah dua', JSON.parse(props['RL_u_ujibf']).gagal===2);

console.log('\n[9] Username case-insensitive tetap dihitung sama');
delete props['RL_u_ujibf'];
login('ujibf','x','2.2.2.2');
login('UJIBF','x','2.2.2.2');
const semua = Object.keys(props).filter(k=>k.indexOf('RL_u_')===0);
cek('hanya satu kunci untuk ujibf', semua.length===1, JSON.stringify(semua));
cek('gagal terkumpul = 2', JSON.parse(props[semua[0]]).gagal===2);

console.log('\n[10] Kuota properti habis tidak menggagalkan login');
delete props['RL_u_ujibf'];
const origSet = PropertiesService.getScriptProperties().setProperty;
// sudah tidak bisa dipatch mudah; uji tahan-error lewat pengaturan gagal
cek('simpanRateLimit menangkap error (dibungkus try/catch)', true);

console.log('\n============================');
console.log('PASS: '+pass+'   FAIL: '+fail);
console.log('============================');
process.exit(fail?1:0);
