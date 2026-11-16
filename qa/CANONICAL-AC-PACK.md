# Canonical AC Pack: Issue #110 Three-Layer Termination Check

- **Cut Reference:** `docs/cuts/2026-11-06-issue-110-three-layer-verify.md` + `docs/cuts/2026-11-06-issue-110-amendment-1.md` (BINDING, 2026-11-06)
- **Base Commit:** `bc1504b` pada branch `main`
- **Urutan Unlock:** AC-3 dan AC-2 wajib PASS sebelum AC-4, AC-1, AC-6. AC-6 baru wajib PASS sebelum AC-5 dijalankan ulang.
- **Enforcement:** Semua item berkategori BLOCK. Soft-pass dilarang. Expected result tidak diubah.

---

## Acceptance Criteria

### AC-1: Dokumentasi Layer dan Pemetaan Command (BLOCK)
- **Kriteria:** `core/verification-loop.md` dan `skill-src/ael/references/loop-verify.md` memuat tabel L1/L2/L3 dengan key command `e2e` (bukan `test_e2e`).
- **Proof:** SHA commit + grep output.
- **Pass Criteria:** `grep "test_e2e"` di kedua file menghasilkan 0 baris, dan `grep "L3"` menghasilkan minimal 1 baris per file.

### AC-2: Template Header Claimed vs Reality 4-Kolom (BLOCK)
- **Kriteria:** Eksekusi `context claimed-vs-reality --run <id>` menghasilkan tabel dengan header `| AC | Claimed | Reality from command log | Layer |`.
- **Proof:** Fixture run ID dari tests + output markdown.
- **Pass Criteria:** Header tabel persis 4 kolom sesuai spesifikasi, posisi 3 kolom pertama tidak berubah.

### AC-3: Kompatibilitas Mundur File 3-Kolom (BLOCK)
- **Kriteria:** File `claimed-vs-reality.md` format lama tanpa kolom Layer tetap lolos validasi `readyForDa`.
- **Proof:** Test output JSON di `tests/claimed-vs-reality.test.js`.
- **Pass Criteria:** Kasus file 3-kolom teruji di `tests/claimed-vs-reality.test.js` dan berstatus hijau.

### AC-4: Validasi Format 4-Kolom (BLOCK)
- **Kriteria:** File dengan kolom Layer terisi lolos `readyForDa`. Reality kosong atau hanya "seems green" tetap ditolak.
- **Proof:** Test output di `tests/claimed-vs-reality.test.js`.
- **Pass Criteria:** Kedua kasus (lolos dengan Layer valid, gagal jika Reality kosong/"seems green") ada di test suite dan berstatus hijau.

### AC-5: Full Test Suite Hijau (BLOCK)
- **Kriteria:** Seluruh test suite berjalan bersih tanpa kegagalan.
- **Proof:** SHA commit + execution exit code 0 dari `npm test`.
- **Pass Criteria:** `npm test` keluar dengan exit code 0 tanpa test yang di-skip atau dihapus.

### AC-6 (Rev Amendment 1): Batasan Blast Radius Diff & Host Skill Sync (BLOCK)
- **Kriteria:** Diff dari base main `bc1504b` hanya menyentuh `core/`, `skill-src/ael/`, `lib/claimed-vs-reality.js`, `tests/`, plus tepat dua file turunan hasil regenerasi `npm run build:skills` (`.claude/skills/ael/references/loop-verify.md` dan `.agents/skills/ael/references/loop-verify.md`). Dilarang edit manual di `.claude/` dan `.agents/`.
- **Proof:** Output `git diff --stat` terhadap base `bc1504b` + exit code `npm run check:skills`.
- **Pass Criteria:** `npm run check:skills` keluar dengan exit code 0, dua file turunan identik dengan hasil build resmi, dan tidak ada path kode lain di luar daftar tersebut.
