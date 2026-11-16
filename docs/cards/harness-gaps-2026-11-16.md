# Harness gap cards (2026-11-16)

Audit `ai-engineering-loop` terhadap praktik di [walkinglabs/learn-harness-engineering](https://github.com/walkinglabs/learn-harness-engineering) (lecture 01-14, MIT). Ide diadaptasi dengan kata sendiri.

Yang **sudah** dipenuhi AEL (tidak dibuat card): Goal Contract sebagai scope eksternal (L07), WIP=1 lewat `ACTIVE_RUN` di `lib/run-state.js:305` (L07), Maker terpisah dari Devil's Advocate dan Judge (L09/L13), tier + iteration cap + no-progress (L13), budget token (L13), guard scope dan perintah destruktif (L10), learnings dari ledger (L10, sebagian), handoff ter-redaksi (L05), dan sejak card #110 lanjutan: gate L3 untuk AC `crossComponent`/T2.

Prioritas: **P1** = celah verifikasi (agen bisa klaim selesai tanpa bukti), **P2** = celah feedback/kontinuitas, **P3** = kebersihan harness.

---

## C-01 · P1 · Layer tag harus terikat ke command yang benar-benar direkam

**Sumber:** L09 (penilaian selesai harus dari luar agen), L10.
**Bukti:** `lib/claimed-vs-reality.js:224-233` hanya membaca teks kolom Layer. Maker bisa menulis `L3` padahal `verification.json` tidak punya command `e2e`. Pengecekan "tag L3 tapi Reality cuma unit test" sekarang hanya ada di prompt DA dan Judge, bukan di gate.
**Usulan:** Saat `gate review`, cocokkan tiap tag dengan command yang terekam dan terikat ke diff: `L1` butuh `typecheck|lint|build`, `L2` butuh `test_*`, `L3` butuh `e2e` atau baris Reality yang memuat bukti manual flow (URL/log/screenshot path). Mapping command ke layer diambil dari key di `verification.md`.
**AC:**
- AC-1: Row bertag `L3` tanpa command `e2e` yang terekam dan tanpa bukti manual flow gagal di `gate review`, dengan pesan FIX.
- AC-2: Row bertag `L1` tanpa command L1 yang terekam juga gagal.
- AC-3: Waiver `L3 waived:` tetap lolos (tidak butuh command).
**Effort:** M.

## C-02 · P1 · `verify` default harus menjalankan L1 dan L2, bukan hanya `test_unit`

**Sumber:** L09 (urutan L1 -> L2 -> L3, berhenti di kegagalan pertama), L02 (feedback subsystem paling murah dan paling besar dampaknya).
**Bukti:** `bin/ai-engineering-loop.js:4097`: default command hanya `test_unit`. `validateVerificationBundle` (`lib/gates.js:183`) menerima bundle yang isinya satu command saja. `templates/repo-config/verification.md` sudah mendefinisikan urutan cheapest-first, tapi tidak dipakai.
**Usulan:** Kalau `--cmd` tidak diberikan, `verify` menjalankan key yang terkonfigurasi sesuai `## Default order` (build -> typecheck -> lint -> test_unit), serial, dan berhenti di kegagalan pertama. Gate verification T1/T2 menolak bundle tanpa satu pun command L1 kalau `typecheck` atau `lint` terkonfigurasi.
**AC:**
- AC-1: `verify --run <id>` tanpa `--cmd` menjalankan `typecheck` dan `lint` sebelum `test_unit` kalau keduanya ada.
- AC-2: Kegagalan L1 menghentikan run sebelum L2.
- AC-3: Repo yang tidak punya key L1 tetap jalan seperti sekarang.
**Effort:** M.

## C-03 · P1 · Startup/health check sebagai bukti runtime (L2)

**Sumber:** L09 ("aplikasi benar-benar start dan siap?"), L11 (runtime signal).
**Bukti:** `templates/repo-config/verification.md` tidak punya key `start`/`healthcheck`. Tidak ada mekanisme yang membuktikan aplikasi bisa boot setelah perubahan config, migrasi, atau env.
**Usulan:** Tambah key opsional `smoke` (start app + probe readiness + stop) di `verification.md`. `verify` menjalankannya setelah test L2 kalau diff menyentuh config, migrasi, env, atau entrypoint. Hasilnya terekam sebagai evidence L2.
**AC:**
- AC-1: Diff yang menyentuh file migrasi/config memicu `smoke` kalau key-nya ada.
- AC-2: Proses `smoke` yang timeout atau exit non-zero memblokir gate.
- AC-3: Proses app selalu dihentikan (tidak ada proses yatim).
**Effort:** M.

## C-04 · P2 · Pesan gate yang ditulis untuk agen: apa, kenapa, cara memperbaiki

**Sumber:** L09 dan L10 (error message harus berisi instruksi perbaikan).
**Bukti:** Ada 31 `gateError(...)` di `lib/gates.js`. Yang punya baris `FIX:` hanya pesan claimed-vs-reality yang baru. Sisanya ditutup dengan kalimat generik "After correcting the reported issue, retry" (`bin/ai-engineering-loop.js:2032`).
**Usulan:** Tambah field `fix` di `gateError(message, details, { why, fix })`, isi untuk semua gate error, dan render dalam format `ERROR / WHY / FIX`. Tambahkan test yang gagal kalau ada `gateError` tanpa `fix`.
**AC:**
- AC-1: Setiap `gateError` di `lib/gates.js` punya `fix` yang tidak kosong (dicek oleh test).
- AC-2: Output CLI dan `--json` menampilkan `why` dan `fix`.
**Effort:** M.

## C-05 · P2 · Promosi feedback review menjadi check yang bisa dieksekusi

**Sumber:** L10 (review feedback promotion; aturan arsitektur harus jalan otomatis di setiap commit).
**Bukti:** `lib/learn.js` mengelompokkan finding VALID ke `learnings.md` lalu menyuntikkannya ke context. Itu masih teks yang harus dibaca agen, bukan check. `lib/guard.js` hanya memeriksa scope dan perintah destruktif (`DESTRUCTIVE_RULES`, `lib/guard.js:86`).
**Usulan:** `ael learn promote <learningId> --check "<command>" --fix "<instruksi>"` menulis rule ke `.ai-engineering-loop/rules.json`. `verify` menjalankan semua rule sebagai command L1 dan menampilkan `fix` saat gagal. Learning yang muncul di 3 run atau lebih ditandai sebagai kandidat promosi.
**AC:**
- AC-1: Rule yang sudah dipromosikan ikut berjalan di `verify` dan pelanggarannya memblokir gate dengan pesan FIX dari rule tersebut.
- AC-2: `ael learn` menampilkan kandidat promosi beserta jumlah run-nya.
**Effort:** L.

## C-06 · P2 · Gate clean state saat delivery

**Sumber:** L12 (5 dimensi clean state: build, test, progress, artifact, startup), checklist clean-state di L09.
**Bukti:** Delivery gate (`lib/gates.js:585`) hanya mewajibkan final verification. Tidak ada pengecekan file untracked atau sementara, artifact setengah jadi, maupun catatan progres untuk sesi berikutnya. `docs/board.md`, `docs/cuts/`, dan `qa/` di repo ini sendiri masih untracked setelah #110 delivered.
**Usulan:** Tambah `cleanState` di delivery: (1) tidak ada file untracked di luar allowlist, (2) tidak ada file `_templateOnly` yang tersisa, (3) final verification hijau, (4) handoff atau next-action tertulis, (5) `smoke` hijau kalau ada (C-03). Pelanggaran memblokir gate di UNATTENDED dan menjadi peringatan di ASSISTED.
**AC:**
- AC-1: File untracked baru di luar allowlist menggagalkan delivery dengan daftar path dan FIX.
- AC-2: Artifact yang masih `_templateOnly` menggagalkan delivery.
**Effort:** M.

## C-07 · P2 · AC sebagai feature-list triple: perilaku + command verifikasi + status

**Sumber:** L08 (setiap item butuh triple; status hanya naik lewat verifikasi yang dijalankan harness).
**Bukti:** `schemas/goal-contract.schema.json` hanya punya `evidenceRequired` (teks bebas). Tidak ada command per AC dan tidak ada status per AC yang dikendalikan harness. Status "AC terbukti" hanya disimpulkan Judge dari prosa.
**Usulan:** Tambah `verify: { layer, command | testName }` opsional per AC. Harness menurunkan status per AC (`pending | proven | failed`) dari evidence yang terekam, menampilkannya di run-summary, dan Judge PASS hanya kalau semua AC `proven` atau di-waive.
**AC:**
- AC-1: AC dengan `verify.command` mendapat status `proven` hanya setelah command itu exit 0 di diff yang sedang di-gate.
- AC-2: `gate judge` PASS ditolak kalau ada AC berstatus `pending`/`failed`.
**Effort:** L. Gabung dengan C-01 kalau mau satu PR.

## C-08 · P3 · Audit harness debt: entry file, aturan kedaluwarsa, learnings basi

**Sumber:** L04 (entry file adalah router, 50-200 baris; tiap instruksi punya sumber, syarat berlaku, dan kedaluwarsa), L12 (sederhanakan harness secara berkala), L03 (dokumen basi lebih berbahaya daripada tidak ada dokumen).
**Bukti:** Tidak ada command yang mengaudit ukuran `SKILL.md`/references, umur `learnings.md`, atau rule tanpa provenance. Budget context hanya dijaga oleh `scripts/measure.js` (T1 <= 50% baseline). #110 sendiri hampir melewatinya (17855/17859 char).
**Usulan:** `ael doctor --harness` melaporkan: ukuran setiap reference vs budget, learning yang tidak terpakai N run, rule tanpa `source`/`expires`, dan file context yang lebih tua dari kode yang dijelaskannya. Output berupa daftar kandidat untuk dihapus.
**AC:**
- AC-1: Laporan menyebut file yang sisa budget-nya kurang dari 2% dan learning yang tidak dipakai lebih dari 10 run.
**Effort:** S-M.

## C-09 · P3 · Rubrik untuk AC subjektif (UI/design/copy)

**Sumber:** L09 (self-evaluation selalu terlalu positif di tugas subjektif), L11 (rubrik membuat evaluasi bisa diulang).
**Bukti:** Judge memutuskan dari severity ledger. Untuk AC seperti "layout rapi", tidak ada rubrik terstruktur sehingga hasilnya bergantung pada model.
**Usulan:** Field opsional `rubric: [{criterion, pass}]` per AC. DA menilai setiap kriteria dengan bukti (screenshot path atau DOM snapshot), dan Judge menolak AC rubrik yang tidak punya skor per kriteria.
**AC:**
- AC-1: AC dengan `rubric` tanpa skor per kriteria di ledger menghasilkan ITERATE.
**Effort:** M.
