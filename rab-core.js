/**
 * rab-core.js — Logika bersama aplikasi RABIT.
 *
 * Sebelumnya fungsi-fungsi ini disalin identik ke conven.html, ftth.html,
 * dan ftthxconven.html (13 fungsi x 3 file = ~700 baris duplikat). Perubahan
 * rumus atau bug fix harus dilakukan 3-4 kali dan mudah terlewat.
 *
 * Modul ini memakai dependency injection: setiap fungsi menerima `ctx` berisi
 * state & config halaman, sehingga tidak bergantung pada variabel global.
 *
 * Kontrak ctx:
 *   { items: { install: [], hardware: [] }, config: {...}, gasUrl: string }
 *
 * Dimuat SEBELUM script halaman. Tidak ada build step.
 */
(function (global) {
  'use strict';

  // ===========================================================================
  // Format & util
  // ===========================================================================

  /** Format angka ke Rupiah. 1250000 -> "Rp 1.250.000" */
  function formatIDR(n) {
    const val = Number(n) || 0;
    return 'Rp ' + val.toLocaleString('id-ID');
  }

  /** Bersihkan nama file dari karakter ilegal Windows/macOS. */
  function sanitizeFileName(name) {
    return String(name || '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Ambil angka murni dari teks berformat, mis. "Rp 1.250.000" -> 1250000 */
  function parseCurrency(text) {
    return Number(String(text || '').replace(/[^0-9]/g, '')) || 0;
  }

  // ===========================================================================
  // Perhitungan
  // ===========================================================================

  /** Hitung total per item dan grand total seluruh tabel. */
  function hitungTotal(ctx) {
    const semua = [].concat(ctx.items.install || [], ctx.items.hardware || []);
    let grand = 0;
    const rincian = semua.map(function (item) {
      const total = (Number(item.qty) || 0) * (Number(item.price) || 0);
      grand += total;
      return { id: item.id, total: total };
    });
    return { grand: grand, rincian: rincian };
  }

  /** Perbarui label total di DOM. ID elemen diambil dari config halaman. */
  function updateTotals(ctx, doc) {
    doc = doc || global.document;
    const ids = ctx.config.ids || {};
    const hitung = function (arr) {
      return (arr || []).reduce(function (acc, it) {
        return acc + (Number(it.qty) || 0) * (Number(it.price) || 0);
      }, 0);
    };

    const totalInstall = hitung(ctx.items.install);
    const totalHardware = hitung(ctx.items.hardware);
    const grand = totalInstall + totalHardware;

    const elInstall = ids.subtotalInstall ? doc.getElementById(ids.subtotalInstall) : null;
    const elHardware = ids.subtotalHardware ? doc.getElementById(ids.subtotalHardware) : null;
    const elGrand = ids.grandTotal ? doc.getElementById(ids.grandTotal) : null;

    if (elInstall) elInstall.innerText = formatIDR(totalInstall);
    if (elHardware) elHardware.innerText = formatIDR(totalHardware);
    if (elGrand) elGrand.innerText = formatIDR(grand);

    return { totalInstall: totalInstall, totalHardware: totalHardware, grand: grand };
  }

  /**
   * Terapkan rumus otomatis. Rumus disediakan per halaman lewat config.formula,
   * karena tiap tipe RAB punya aturan berbeda (FTTH tidak punya rumus).
   */
  function applyFormulas(ctx, qty) {
    if (typeof ctx.config.formula === 'function') {
      ctx.config.formula(ctx.items, qty);
    }
    updateTotals(ctx);
  }

  // ===========================================================================
  // Render tabel
  // ===========================================================================

  /** Render satu tabel item ke tbody tertentu. */
  function renderTable(ctx, tbodyId, type, doc) {
    doc = doc || global.document;
    const tbody = doc.getElementById(tbodyId);
    if (!tbody) return;

    const items = (type === 'install' ? ctx.items.install : ctx.items.hardware) || [];
    let html = '';

    items.forEach(function (item, index) {
      const total = (Number(item.qty) || 0) * (Number(item.price) || 0);
      const zebra = index % 2 !== 0 ? 'bg-slate-50/50' : 'bg-white';
      const rowClass = zebra + ' hover:bg-slate-100/60 transition-colors' +
        (item.editing ? ' bg-emerald-50/30' : '');

      let contentCells = '';
      let actionButtons = '';

      if (item.editing) {
        // Item hasil rumus otomatis: qty tidak boleh diubah manual.
        const qtyInput = item.isCalculated
          ? '<div class="w-16 mx-auto block p-1 bg-slate-100 border border-slate-200 rounded text-xs text-center font-mono text-slate-400">' + (item.qty || 0) + '</div>'
          : '<input type="number" value="' + (item.qty || 0) + '" onchange="updateItemQty(\'' + type + '\', ' + item.id + ', this.value)" class="w-16 mx-auto block p-1 bg-white border border-slate-200 rounded text-xs text-center font-mono focus:ring-1 focus:ring-crm-active focus:border-crm-active"/>';

        contentCells =
          '<td class="px-4 py-2.5"><input type="text" value="' + escapeAttr(item.desc) + '" onchange="updateItemField(\'' + type + '\', ' + item.id + ', \'desc\', this.value)" class="w-full p-1 bg-white border border-slate-200 rounded text-xs focus:ring-1 focus:ring-crm-active focus:border-crm-active"/></td>' +
          '<td class="px-4 py-2.5"><input type="text" value="' + escapeAttr(item.unit) + '" onchange="updateItemField(\'' + type + '\', ' + item.id + ', \'unit\', this.value)" class="w-16 mx-auto block p-1 bg-white border border-slate-200 rounded text-xs text-center focus:ring-1 focus:ring-crm-active focus:border-crm-active"/></td>' +
          '<td class="px-4 py-2.5">' + qtyInput + '</td>' +
          '<td class="px-4 py-2.5"><input type="number" value="' + (item.price || 0) + '" onchange="updateItemField(\'' + type + '\', ' + item.id + ', \'price\', parseFloat(this.value))" class="w-28 ml-auto block p-1 bg-white border border-slate-200 rounded text-xs text-right font-mono focus:ring-1 focus:ring-crm-active focus:border-crm-active"/></td>';

        actionButtons =
          '<button onclick="toggleEdit(\'' + type + '\', ' + item.id + ', false)" class="text-crm-active hover:bg-emerald-50 p-1 rounded-md transition-colors" title="Simpan">' +
          '<span class="material-symbols-outlined text-base">check</span></button>';
      } else {
        const qtyDisplay = item.isCalculated
          ? '<span class="inline-flex items-center gap-1 text-crm-active/80 font-mono text-xs" title="Otomatis terhitung"><span class="material-symbols-outlined text-[11px]">functions</span>' + (item.qty || 0) + '</span>'
          : '<span class="font-mono text-xs">' + (item.qty || 0) + '</span>';

        contentCells =
          '<td class="px-4 py-3 font-medium text-slate-800 text-xs">' + escapeHtml(item.desc) + '</td>' +
          '<td class="px-4 py-3 text-center text-slate-500 text-xs">' + escapeHtml(item.unit) + '</td>' +
          '<td class="px-4 py-3 text-center">' + qtyDisplay + '</td>' +
          '<td class="px-4 py-3 text-right font-mono text-slate-600 text-xs">' + formatIDR(item.price) + '</td>';

        actionButtons =
          '<button onclick="toggleEdit(\'' + type + '\', ' + item.id + ', true)" class="text-slate-400 hover:text-crm-active p-1 rounded-md transition-colors" title="Edit">' +
          '<span class="material-symbols-outlined text-[17px]">edit</span></button>' +
          '<button onclick="removeItem(\'' + type + '\', ' + item.id + ')" class="text-slate-400 hover:text-rose-600 p-1 rounded-md transition-colors" title="Hapus">' +
          '<span class="material-symbols-outlined text-[17px]">delete</span></button>';
      }

      html +=
        '<tr class="' + rowClass + '">' +
        '<td class="px-4 py-3 text-center text-slate-400 font-mono text-xs">' + (index + 1) + '</td>' +
        contentCells +
        '<td class="px-4 py-3 text-right font-mono font-semibold text-slate-900 text-xs">' + formatIDR(total) + '</td>' +
        '<td class="no-print px-4 py-3"><div class="flex items-center justify-center gap-1">' + actionButtons + '</div></td>' +
        '</tr>';
    });

    tbody.innerHTML = html;
  }

  /** Render kedua tabel (instalasi + material). */
  function renderTables(ctx, doc) {
    doc = doc || global.document;
    const ids = ctx.config.ids || {};
    renderTable(ctx, ids.tbodyInstall || 'installation-body', 'install', doc);
    renderTable(ctx, ids.tbodyHardware || 'hardware-body', 'hardware', doc);
    updateTotals(ctx, doc);
  }

  // ===========================================================================
  // Edit item
  // ===========================================================================

  function cariItem(ctx, type, id) {
    const arr = type === 'install' ? ctx.items.install : ctx.items.hardware;
    return (arr || []).find(function (i) { return i.id === id; });
  }

  function updateItemField(ctx, type, id, field, value) {
    const item = cariItem(ctx, type, id);
    if (!item) return;
    if (field === 'desc' || field === 'unit') {
      item[field] = value;
    } else {
      item[field] = Number(value) || 0;
    }
    updateTotals(ctx);
  }

  function updateItemQty(ctx, type, id, value) {
    const item = cariItem(ctx, type, id);
    if (!item) return;
    const qtyBaru = Number(value) || 0;
    item.qty = qtyBaru;
    // Item pemicu rumus ditentukan per halaman lewat config.formulaTrigger.
    if (ctx.config.formulaTrigger && ctx.config.formulaTrigger.type === type &&
        Number(ctx.config.formulaTrigger.id) === Number(id)) {
      applyFormulas(ctx, qtyBaru);
    }
    updateTotals(ctx);
  }

  function toggleEdit(ctx, type, id, show) {
    const item = cariItem(ctx, type, id);
    if (!item) return;
    // show eksplisit dari onclick (true = mode edit, false = simpan).
    item.editing = (typeof show === 'boolean') ? show : !item.editing;
    renderTables(ctx);
  }

  function addItem(ctx, type) {
    const arr = type === 'install' ? ctx.items.install : ctx.items.hardware;
    const nextId = arr.reduce(function (m, i) { return Math.max(m, Number(i.id) || 0); }, 0) + 1;
    arr.push({ id: nextId, desc: 'Item baru', unit: 'ls', qty: 1, price: 0, editing: true });
    renderTables(ctx);
  }

  function removeItem(ctx, type, id) {
    const key = type === 'install' ? 'install' : 'hardware';
    // Mutasi array di tempat agar referensi yang dipegang halaman tetap valid.
    const arr = ctx.items[key] || [];
    const idx = arr.findIndex(function (i) { return Number(i.id) === Number(id); });
    if (idx > -1) arr.splice(idx, 1);
    renderTables(ctx);
  }

  // ===========================================================================
  // Header (judul & subjudul)
  // ===========================================================================

  function toggleHeaderEdit(show, doc) {
    doc = doc || global.document;
    const display = doc.getElementById('header-display');
    const edit = doc.getElementById('header-edit');
    if (!display || !edit) return;

    if (show) {
      const inputTitle = doc.getElementById('input-title');
      const inputSubtitle = doc.getElementById('input-subtitle');
      const titleText = doc.getElementById('title-text');
      const subtitleText = doc.getElementById('subtitle-text');
      if (inputTitle && titleText) inputTitle.value = titleText.innerText.trim();
      if (inputSubtitle && subtitleText) inputSubtitle.value = subtitleText.innerText.trim();
      display.classList.add('hidden');
      edit.classList.remove('hidden');
    } else {
      display.classList.remove('hidden');
      edit.classList.add('hidden');
    }
  }

  function saveHeader(ctx, doc) {
    doc = doc || global.document;
    const inputTitle = doc.getElementById('input-title');
    const inputSubtitle = doc.getElementById('input-subtitle');
    const titleText = doc.getElementById('title-text');
    const subtitleText = doc.getElementById('subtitle-text');

    // Judul default berasal dari config halaman, bukan di-hardcode per file.
    const judul = (inputTitle && inputTitle.value.trim()) ||
      ctx.config.defaultTitle || 'RAB AKTIVASI';
    const subjudul = (inputSubtitle && inputSubtitle.value.trim()) ||
      ctx.config.defaultSubtitle || 'TECHNICAL ACTIVATION COST ESTIMATION';

    if (titleText) titleText.innerText = judul;
    if (subtitleText) subtitleText.innerText = subjudul;

    toggleHeaderEdit(false, doc);
  }

  // ===========================================================================
  // Export PDF + simpan ke Drive
  // ===========================================================================

  /**
   * Ekspor PDF lalu kirim ke Google Apps Script.
   * @param {object} ctx  konteks halaman
   * @param {string} tipe tipe RAB ("CONVEN" | "FTTH" | "FTTH X CONVEN")
   * @param {Event}  ev   event klik (untuk state tombol)
   */
  async function simpanRAB(ctx, tipe, ev, doc) {
    doc = doc || global.document;

    const inputTitle = doc.getElementById('input-title');
    const displayTitle = doc.getElementById('title-text');
    const judul = (inputTitle && inputTitle.value.trim())
      ? inputTitle.value.trim()
      : (displayTitle ? displayTitle.innerText.trim() : 'RAB AKTIVASI VIA ' + tipe);

    const inputSubtitle = doc.getElementById('input-subtitle');
    const displaySubtitle = doc.getElementById('subtitle-text');
    const subNama = (inputSubtitle && inputSubtitle.value.trim())
      ? inputSubtitle.value.trim()
      : (displaySubtitle ? displaySubtitle.innerText.trim() : 'Pelanggan');

    const defaultFileName = 'RAB_' + tipe.replace(/\s+/g, '') + '_' + sanitizeFileName(subNama);

    const customName = prompt('Konfirmasi / Edit nama file PDF sebelum disimpan:', defaultFileName);
    if (!customName || !customName.trim()) return;

    const finalFileName = customName.trim().endsWith('.pdf')
      ? customName.trim()
      : customName.trim() + '.pdf';
    const namaDokumen = finalFileName.replace(/\.pdf$/i, '');

    const btn = (ev && ev.currentTarget) || null;
    const originalText = btn ? btn.innerHTML : '';

    const grandTotalEl = doc.getElementById('grand-total');
    const grandTotalAngka = parseCurrency(grandTotalEl ? grandTotalEl.innerText : '');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-base">progress_activity</span> Memproses PDF...';
    }

    const printTitle = doc.getElementById('print-title');
    const printSubtitle = doc.getElementById('print-subtitle');
    if (printTitle) printTitle.innerText = judul;
    if (printSubtitle) printSubtitle.innerText = subNama;

    doc.body.classList.add('exporting-pdf');
    await new Promise(function (r) { setTimeout(r, 100); });

    const element = doc.querySelector('main');

    const opt = {
      margin: [8, 8, 8, 8],
      filename: finalFileName,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    try {
      if (btn) {
        btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-base">cloud_upload</span> Mengunggah ke Drive...';
      }

      const pdfBlob = await html2pdf().set(opt).from(element).output('blob');
      html2pdf().set(opt).from(element).save();

      const base64Data = await new Promise(function (resolve) {
        const reader = new FileReader();
        reader.onloadend = function () { resolve(reader.result); };
        reader.readAsDataURL(pdfBlob);
      });

      const payload = {
        nomorRab: namaDokumen,
        judul: judul,
        lokasi: subNama,
        tipeRab: tipe,
        tanggal: new Date().toLocaleDateString('id-ID', {
          year: 'numeric', month: 'short', day: 'numeric'
        }),
        totalBiaya: grandTotalAngka,
        fileName: finalFileName,
        pdfBase64: base64Data
      };

      // Kirim lewat RabAuth.api — token sesi disertakan otomatis dan
      // endpoint server menolak permintaan tanpa token valid.
      let result;
      if (global.RabAuth && typeof global.RabAuth.api === 'function') {
        result = await global.RabAuth.api('simpanRab', payload);
      } else {
        result = { status: 'error', message: 'Modul autentikasi tidak termuat.' };
      }

      if (result.status === 'success') {
        alert('\u2713 Sukses!\nFile "' + finalFileName + '" berhasil disimpan ke Google Drive & dicatat ke Riwayat.');
      } else {
        alert('PDF terunduh, tapi gagal masuk ke Google Drive: ' + (result.message || 'kesalahan tidak diketahui'));
      }
    } catch (err) {
      console.error(err);
      alert('Terjadi kesalahan saat kirim ke Drive: ' + err.message);
    } finally {
      doc.body.classList.remove('exporting-pdf');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  }

  // ===========================================================================
  // Helper escape (cegah HTML injection dari input pengguna)
  // ===========================================================================

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/\n/g, '&#10;');
  }

  // ===========================================================================
  // Ekspor
  // ===========================================================================

  global.RabCore = {
    // util
    formatIDR: formatIDR,
    sanitizeFileName: sanitizeFileName,
    parseCurrency: parseCurrency,
    escapeHtml: escapeHtml,
    // kalkulasi
    hitungTotal: hitungTotal,
    updateTotals: updateTotals,
    applyFormulas: applyFormulas,
    // render
    renderTable: renderTable,
    renderTables: renderTables,
    // item
    updateItemField: updateItemField,
    updateItemQty: updateItemQty,
    toggleEdit: toggleEdit,
    addItem: addItem,
    removeItem: removeItem,
    // header
    toggleHeaderEdit: toggleHeaderEdit,
    saveHeader: saveHeader,
    // export
    simpanRAB: simpanRAB
  };
})(typeof window !== 'undefined' ? window : this);
