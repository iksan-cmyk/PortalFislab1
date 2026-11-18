'use strict';

const KOMP = [
  { key:'prelab',                     label:'Pre-Lab',                         bobot:10, cat:'catPrelab'                     },
  { key:'inlab_pengambilan_data',     label:'In-Lab Pengambilan Data',         bobot:15, cat:'catInlabPengambilanData'       },
  { key:'inlab_diskusi',              label:'In-Lab Diskusi',                  bobot:10, cat:'catInlabDiskusi'               },
  { key:'inlab_kerapian',             label:'In-Lab Kerapian',                 bobot:5,  cat:'catInlabKerapian'              },
  { key:'abstrak',                    label:'Laporan Abstrak',                 bobot:5,  cat:'catAbstrak'                    },
  { key:'pendahuluan',                label:'Laporan Pendahuluan',             bobot:5,  cat:'catPendahuluan'                },
  { key:'metodologi',                 label:'Laporan Metodologi',              bobot:5,  cat:'catMetodologi'                 },
  { key:'analisis_data',              label:'Laporan Analisis Data',           bobot:5,  cat:'catAnalisisData'               },
  { key:'analisis_perhitungan_grafik',label:'Laporan Analisis Perhitungan & Grafik', bobot:10, cat:'catAnalisisPerhitunganGrafik' },
  { key:'pembahasan',                 label:'Laporan Pembahasan',              bobot:20, cat:'catPembahasan'                 },
  { key:'kesimpulan',                 label:'Laporan Kesimpulan',              bobot:5,  cat:'catKesimpulan'                 },
  { key:'format',                     label:'Laporan Formating',               bobot:5,  cat:'catFormat'                    },
  { key:'plagiasi',                   label:'Plagiasi',                        bobot:0,  cat:'catPlagiasi'                   },
  { key:'keterlambatan',              label:'Keterlambatan (poin pengurang)',  bobot:0,  cat:'catKeterlambatan'              },
];
function hitungTotal(g) {
  // Meniru rumus server recompute_nilai_akhir (0014_keterlambatan.sql:47-68):
  //   GREATEST(0, ROUND(2 desimal) dari jumlah(bobot_komponen) - plagiasi - keterlambatan).
  // NULL/NaN diperlakukan 0 (setara COALESCE). Bobot dari KOMP (persen).
  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  let sum = 0;
  KOMP.forEach(k => { if (k.bobot > 0) sum += num(g[k.key]) * (k.bobot / 100); });
  sum -= num(g.plagiasi);
  sum -= num(g.keterlambatan);
  return Math.round(Math.max(0, sum) * 100) / 100;
}
// hitungTotalDariForm: baca FormData form input nilai -> objek -> hitungTotal.
function hitungTotalDariForm(form) {
  const fd = new FormData(form);
  const g = {};
  KOMP.forEach(k => { g[k.key] = fd.get(k.key); });
  return hitungTotal(g);
}
// updateTotal: pratinjau form aslab (aStuChange).
function updateTotal(form) {
  const el = document.getElementById('total-preview-val');
  if (!el) return;
  const total = hitungTotalDariForm(form);
  el.textContent = total.toFixed(2);
}
// nilaiVal: tampilan nilai di input form. '' hanya bila undefined/null/'';
// nilai 0 yang sah tetap tampil '0' (Tugas 5).
function nilaiVal(v) {
  return (v === undefined || v === null || v === '') ? '' : v;
}
// totalDisplay: tampilan pratinjau total. '—' hanya bila SEMUA komponen (kecuali
// keterlambatan) kosong. Nilai total 0 tetap tampil '0.00'. (Tugas 1.5)
function totalDisplay(g) {
  const adaNilai = KOMP.some(k => k.key !== 'keterlambatan'
    && g[k.key] !== undefined && g[k.key] !== null && g[k.key] !== '');
  if (!adaNilai) return '—';
  return hitungTotal(g).toFixed(2);
}
function scoreClass(v) {
  if (v === null || v === '') return 'na';
  const n = parseFloat(v);
  if (n >= 80) return 'a';
  if (n >= 65) return 'b';
  if (n >= 50) return 'c';
  return 'd';
}
