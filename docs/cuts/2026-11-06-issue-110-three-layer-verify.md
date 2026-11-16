# Cut 2026-11-06: Issue #110 three-layer termination check

Status: APPROVED (user, 2026-11-06 13:30 WIB). Menggantikan: tidak ada.
Repo: egagofur/ai-engineering-loop, base main @ bc1504b. Issue: #110.

## Keputusan dibutuhkan
approve | tolak <item OUT tertentu> | pilih urutan unlock.

## Hasil yang terlihat
Dokumentasi loop-verify menamai tiga layer (L1 static, L2 behavioral, L3 end-to-end) dan memetakan tiap layer ke key command yang sudah ada di verification.md, sehingga Maker tidak bisa menutup AC lintas-komponen dengan unit test saja.

## Hasil cek PM (pengganti dua item "belum terverifikasi")
- `scaffold verification` menulis `verification.template.json` lewat `scaffoldArtifact` (lib/agent-artifacts.js:106), bukan template markdown. Penambahan "kolom Layer" di sana tidak berlaku; kolom hanya relevan untuk claimed-vs-reality.md.
- Tidak ada key `test_e2e`. Key yang ada: test_unit, test_all, typecheck, lint, build, dan `e2e` (opsional) di core/repo-config-schema.md:61-66. Init hanya mendeteksi `scripts.e2e` dari `test:e2e` (bin/ai-engineering-loop.js:515). Proposal wajib memakai nama `e2e`.
- Parser claimed-vs-reality membaca sel secara posisi (lib/claimed-vs-reality.js:144-149: cells[0..2] = AC, Claimed, Reality). Kolom Layer harus di posisi ke-4, bukan disisipkan di tengah.

## IN
- Bagian "Layers" di core/verification-loop.md dan skill-src/ael/references/loop-verify.md: L1 = typecheck/lint/build, L2 = test_unit/test_related/test_all, L3 = e2e. Satu tabel pemetaan, kata sendiri.
- Template claimed-vs-reality: tambah kolom ke-4 `Layer` (opsional diisi, L1|L2|L3) di renderClaimedVsRealityTemplate.
- Aturan dokumen: AC yang melintasi komponen wajib punya Reality dari L3, atau alasan tertulis kenapa L3 tidak tersedia (key `e2e` kosong).
- Test untuk parser dan template.

## OUT
- Tidak ada gate baru yang memblok verify/DA ketika `e2e` kosong. Hanya dokumen + kolom opsional.
- Tidak mengubah arti `verify --related` / `--final`.
- Tidak menambah key command baru, tidak mengubah `scaffold verification`.
- Tidak menyentuh adapters, evals, atau copy di .claude/worktrees dan .agents (hasil build; regenerasi mengikuti proses repo).

## Acceptance Criteria
- AC-1: loop-verify.md dan verification-loop.md memuat tabel L1/L2/L3 dengan key command yang benar (`e2e`, bukan `test_e2e`).
  Proof: SHA + grep output. QA: pass jika grep `test_e2e` di dua file = 0 hasil dan grep `L3` ≥1 per file.
- AC-2: `context claimed-vs-reality --run <id>` menghasilkan header `| AC | Claimed | Reality from command log | Layer |`.
  Proof: fixture id (run fixture dari tests) + output file. QA: pass jika header persis, urutan 3 kolom lama tidak berubah.
- AC-3: file lama tanpa kolom Layer tetap lolos `readyForDa`.
  Proof: API/test JSON. QA: pass jika tests/claimed-vs-reality.test.js memuat kasus 3-kolom dan hijau.
- AC-4: file dengan kolom Layer terisi lolos `readyForDa`; Reality kosong atau "seems green" tetap gagal.
  Proof: output test. QA: pass jika kedua kasus ada di test dan hijau.
- AC-5: `npm test` penuh hijau di SHA hasil kerja. Proof: SHA + output exit 0. QA: pass jika exit 0 dan tidak ada test dihapus atau di-skip.
- AC-6: diff hanya menyentuh core/, skill-src/ael/, lib/claimed-vs-reality.js, tests/. Proof: `git diff --stat` dari main. QA: pass jika tidak ada path lain.

## Urutan unlock
AC-3 dan AC-2 PASS dulu (kompatibilitas parser), lalu AC-4, AC-1, AC-6. AC-5 terakhir. Polish wording dibuka setelah AC-2..4 PASS.

## Kontrol perubahan
Cut bertanggal 2026-11-06. Scope tambah (gate wajib e2e, perubahan scaffold verification) = cut baru, bukan geser lewat chat.

## Handoff
- Engineer Bot: cut di work/ai-engineering-loop/docs/cuts/2026-11-06-issue-110-three-layer-verify.md, tanggal 2026-11-06, unlock AC-3 > AC-2 > AC-4 > AC-1 > AC-6 > AC-5, proof map di atas. Jangan mulai delegasi ke Ega Junior C2 sebelum cut APPROVED.
- QA Bot: tulis ulang AC pack kanonik khusus cut ini; soft-pass dilarang; proof map sama.
