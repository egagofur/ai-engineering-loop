# Cut 2026-11-06 amendment 1: Issue #110 (build:skills)

Status: APPROVED oleh PM; keputusan PM atas gap, user boleh veto. Menggantikan: AC-5 dan AC-6 plus OUT butir ".claude/.agents" di docs/cuts/2026-11-06-issue-110-three-layer-verify.md. Bagian lain cut itu tetap berlaku.

Sebab: `npm test` menjalankan checkHostSkills (tests/host-skill-build.test.js:20). Perubahan di skill-src/ael/references/loop-verify.md memaksa salinan di .claude/skills/ael/ dan .agents/skills/ael/ ikut berubah. Cut awal salah menulis OUT dan AC-6. Menjalankan `npm run build:skills` memakai proses repo yang ada dan tidak menambah scope.

## Perubahan
- OUT diganti: dilarang mengedit manual file di .claude/ dan .agents/. Regenerasi via `npm run build:skills` wajib.
- AC-6 baru: `git diff --stat` dari main hanya menyentuh core/, skill-src/ael/, lib/claimed-vs-reality.js, tests/, plus tepat dua file turunan: .claude/skills/ael/references/loop-verify.md dan .agents/skills/ael/references/loop-verify.md.
  Proof: git diff --stat + output `npm run check:skills`. QA: pass jika `check:skills` exit 0, dua file turunan identik dengan hasil build:skills, dan tidak ada path lain (docs/, qa/ tidak masuk commit kode).
- AC-5 tidak berubah: `npm test` exit 0, tanpa test dihapus atau di-skip.

## Urutan
AC-6 baru PASS sebelum AC-5 dijalankan ulang.

## Handoff
- Ega Junior C2: jalankan `npm run build:skills`, jangan edit .claude/.agents manual, laporkan diff --stat.
- QA Bot: perbarui AC-6 di pack sesuai amendment, jalankan ulang AC-6 lalu AC-5; AC-1..4 tidak perlu diulang kecuali SHA kode berubah.
