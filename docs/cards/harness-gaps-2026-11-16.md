# Harness gap cards (2026-11-16)

> **Status: closed.** All cards C-01..C-16 shipped in [#113](https://github.com/egagofur/ai-engineering-loop/pull/113) (v2.7.0); the L3 gate that started this audit shipped in [#112](https://github.com/egagofur/ai-engineering-loop/pull/112). Deviation: C-10 labels pre-existing failures but still blocks the gate.

Audit `ai-engineering-loop` terhadap praktik di [walkinglabs/learn-harness-engineering](https://github.com/walkinglabs/learn-harness-engineering) (MIT). Ide diadaptasi dengan kata sendiri.

**Cakupan bacaan (revisi 2):** semua lecture 01-14 (isi lengkap + folder `code/`), dokumen project 01-08, file harness di `projects/*/solution` (AGENTS.md, feature_list, init.sh, handoff, clean-state, quality doc, rubric, sprint contract, script `check-architecture`/`cleanup-scanner`/`benchmark`), `docs/en/resources` (templates, reference, OpenAI advanced pack + SOP), `docs/en/harness-designs` (Claude Code, Codex, DeepSeek, Pi), skill `harness-creator` (SKILL, references, script scoring, templates), `tools/audit-harness.sh`, README dan CLAUDE.md. **Tidak dibaca:** source code aplikasi Electron di `projects/*/src` (kode produk contoh, bukan harness) dan terjemahan non-Inggris.

Yang **sudah** dipenuhi AEL (tidak dibuat card): Goal Contract sebagai scope eksternal (L07), WIP=1 lewat `ACTIVE_RUN` di `lib/run-state.js:305` (L07), Maker terpisah dari Devil's Advocate dan Judge (L09/L13), tier + iteration cap + no-progress (L13), budget token (L13), guard scope dan perintah destruktif (L10), learnings dari ledger (L10, sebagian), handoff ter-redaksi dan decision memory dengan rationale (`lib/handoff.js:53`, L05), deteksi drift context terhadap baseline manifest (L03, sebagian), resume setelah ESCALATE dengan amandemen Goal Contract (`core/escalation-policy.md`, L14/P08), recipe graph + loop group + checkpoint (L14), dan sejak #112: gate L3 untuk AC `crossComponent`/T2.

Di beberapa hal AEL **lebih ketat** dari referensinya. Evidence di `feature_list.json` contoh mereka berupa prosa ("main.ts creates 1200x800 window..."), sedangkan AEL mengikat bukti ke output command dan hash diff. Contract di-freeze, dan ledger reviewer diikat ke hash output mentahnya.

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
**Tambahan (revisi 2):** `RELIABILITY.md` di OpenAI pack dan SOP observability mendefinisikan *golden journeys*: alur utama aplikasi yang punya jalur verifikasi yang bisa diulang. Key `smoke` sebaiknya bisa menunjuk ke golden journey ini.
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
**Tambahan (revisi 2, dari L12 + `cleanup-scanner` di P06):** scan hunk yang ditambahkan diff untuk marker debug (`console.log`/`print` baru di luar logger, `debugger`, `.only(`, `TODO`/`FIXME` baru tanpa referensi issue), file `.env` atau kredensial, dan artifact build di folder source.
**AC:**
- AC-1: File untracked baru di luar allowlist menggagalkan delivery dengan daftar path dan FIX.
- AC-2: Artifact yang masih `_templateOnly` menggagalkan delivery.
- AC-3: Hunk baru yang berisi `debugger` atau `.only(` menggagalkan delivery dengan `file:line`.
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
**Tambahan (revisi 2, dari L02/L12, `QUALITY_SCORE.md` di OpenAI pack, `harness-creator`):**
- **Ablation di bench:** `ael bench --without <komponen>` (misalnya DA, impact map, L3 gate) menjalankan skenario bench dengan satu komponen dimatikan. Hasilnya dicatat di simplification log (komponen, hasil, keputusan keep/remove). Ini cara referensi menentukan komponen harness mana yang masih berguna seiring model makin kuat.
- **Skor anti-gaming:** penilaian struktur dokumen hanya membaca baris terstruktur (heading, list, tabel, code), meniru `structuredText` di `harness-creator/scripts/lib/harness-utils.mjs`, supaya tidak bisa diakali dengan menaburkan keyword (Goodhart, L14).
**AC:**
- AC-1: Laporan menyebut file yang sisa budget-nya kurang dari 2% dan learning yang tidak dipakai lebih dari 10 run.
- AC-2: `bench --without <komponen>` menghasilkan perbandingan metrik terhadap baseline untuk skenario yang sama.
**Effort:** M.

## C-09 · P3 · Rubrik untuk AC subjektif (UI/design/copy)

**Sumber:** L09 (self-evaluation selalu terlalu positif di tugas subjektif), L11 (rubrik membuat evaluasi bisa diulang).
**Bukti:** Judge memutuskan dari severity ledger. Untuk AC seperti "layout rapi", tidak ada rubrik terstruktur sehingga hasilnya bergantung pada model.
**Usulan:** Field opsional `rubric: [{criterion, pass}]` per AC. DA menilai setiap kriteria dengan bukti (screenshot path atau DOM snapshot), dan Judge menolak AC rubrik yang tidak punya skor per kriteria.
**AC:**
- AC-1: AC dengan `rubric` tanpa skor per kriteria di ledger menghasilkan ITERATE.
**Effort:** M.

---

# Revisi 2: card baru setelah membaca seluruh repo

## C-10 · P1 · Baseline verification di awal run

**Sumber:** L06 (startup readiness: harus "bisa test" sebelum mulai kerja), `resources/reference/coding-agent-startup-flow.md`, AGENTS.md di P05 ("If baseline verification is already failing, fix that first. Do not stack new feature work on top of a broken starting state").
**Bukti:** Tidak ada langkah baseline sebelum Maker di AEL. Kata "baseline" di `bin/ai-engineering-loop.js:590` hanya merujuk ke metadata context. Perintah `doctor` (`lib/doctor.js`) memeriksa instalasi AEL, bukan apakah command di `verification.md` benar-benar jalan. Akibatnya kegagalan yang sudah ada sebelum perubahan tidak bisa dibedakan dari kegagalan yang dibuat Maker, dan `verification.md` yang salah baru ketahuan di tengah run.
**Usulan:** Setelah `goal freeze`, jalankan `verify --baseline` di revisi awal (default `test_unit` + L1 yang terkonfigurasi). Simpan hasilnya sebagai `baseline.json` di folder run. Kalau baseline merah, run masuk `BASELINE_RED` dengan dua pilihan: perbaiki dulu (run terpisah) atau lanjut dengan daftar kegagalan yang dibekukan. Di gate verification, kegagalan yang sudah ada di baseline ditandai `pre-existing`, sedangkan kegagalan baru tetap memblokir.
**AC:**
- AC-1: Command yang tidak ditemukan atau exit 127 saat baseline menghentikan run dengan FIX "perbaiki `verification.md`".
- AC-2: Test yang sudah gagal di baseline dan masih gagal sesudah perubahan dilaporkan `pre-existing` dan tidak dihitung sebagai regresi. Test baru yang gagal tetap memblokir gate.
- AC-3: T0 boleh melewati baseline lewat flag di recipe.
**Effort:** M.

## C-11 · P1 · Integritas verifikasi: deteksi test yang dilemahkan

**Sumber:** template `resources/templates/CLAUDE.md` ("Do not remove or weaken tests just to make the task look complete", "Do not rewrite the feature list to hide unfinished work"), AGENTS.md di P05 ("Do not silently change verification rules during implementation"), checker prompt di L13 ("are the tests actually testing something meaningful?").
**Bukti:** Tidak ditemukan pemeriksaan `.skip`, `.only`, `xit`, file test yang dihapus, atau perubahan `verification.md`/config test di diff yang di-gate. Jalur termudah bagi agen untuk "menghijaukan" gate adalah melemahkan test, dan saat ini AEL hanya mengandalkan Devil's Advocate untuk menangkapnya.
**Usulan:** Pemeriksaan deterministik di `gate maker`/`gate review` atas diff: (1) file test yang dihapus atau di-rename tanpa pengganti, (2) penambahan `.skip`/`.only`/`xit`/`@Disabled`/`pytest.mark.skip`, (3) jumlah assertion di file test yang berubah turun, (4) perubahan `.ai-engineering-loop/verification.md`, config jest/vitest/pytest, atau threshold coverage. Temuan masuk ledger sebagai finding `VERIFICATION_WEAKENED` (HIGH; BLOCKER di T2). Finding hanya bisa di-dismiss oleh manusia lewat `dismissal.by`.
**AC:**
- AC-1: Diff yang menambah `it.skip(` di test yang sudah ada memunculkan finding HIGH dengan `file:line`.
- AC-2: Diff yang mengubah `verification.md` saat run aktif memblokir gate kecuali Goal Contract menyebutnya in-scope.
- AC-3: Menghapus file test tanpa test pengganti di path yang sama terdeteksi.
**Effort:** M.

## C-12 · P2 · Atribusi kegagalan per layer harness dan metrik kalibrasi

**Sumber:** L01 (setiap kegagalan diatribusikan ke salah satu dari 5 layer: spesifikasi tugas, context, environment, verifikasi, state), L02 (bottleneck dicari dari catatan atribusi, bukan dari ablation saja), L09 (agen terlalu percaya diri secara sistematis), L13 (verification debt).
**Bukti:** Alasan ITERATE/ESCALATE dan kegagalan gate di AEL tidak diberi kategori layer. Tidak ada metrik "false victory", yaitu Maker sudah lolos verifikasi lalu DA/Judge menemukan BLOCKER yang VALID. `personal-workflow.js` membaca history, tapi tidak dengan taksonomi ini.
**Usulan:** Tambah field `cause` (`task_spec | context | environment | verification | state | model`) pada setiap ITERATE, ESCALATE, dan gate yang gagal; diisi Judge atau ditebak otomatis dari kode error gate. Tambah `ael stats` yang menampilkan: distribusi penyebab, false-victory rate per tier, jumlah iterasi sampai PASS, dan layer yang paling sering menjadi bottleneck.
**AC:**
- AC-1: Setiap verdict ITERATE/ESCALATE punya `cause` yang valid (divalidasi schema).
- AC-2: `ael stats --last 20` menampilkan false-victory rate dan top-2 penyebab.
**Effort:** M.

## C-13 · P2 · Kalibrasi evaluator dan anchor ke hasil nyata

**Sumber:** L11 (evaluator di eksperimen Anthropic "talked itself out of" masalah nyata; diperbaiki dengan membaca log evaluator dan menyesuaikan prompt di titik yang berbeda dari penilaian manusia), `resources/templates/index.md` (evaluator butuh 3-5 putaran tuning), L14 (anchor: metrik harus dipatok ke kenyataan seperti outcome bisnis, ground truth, atau spot-check manusia).
**Bukti:** Ada `REVIEWER_JUDGE_DISAGREEMENT` di `lib/escalation.js:75`, tapi tidak ada umpan balik setelah delivery: komentar MR dari manusia, revert, atau bug yang terlacak ke sebuah run tidak pernah dibandingkan dengan ledger DA/Judge. Skill `ael-receiving-code-review` menindaklanjuti komentar, tapi tidak mencatat apa yang terlewat oleh DA.
**Usulan:** `ael outcome record --run <id> --source mr-comment|revert|bug --file <bukti>` mencatat temuan pasca-delivery. Laporan `ael calibrate` membandingkan temuan itu dengan ledger: mana yang terlewat DA (miss), mana yang di-dismiss tapi ternyata benar (false dismiss). Hasilnya menjadi kandidat perubahan prompt DA/Judge, dengan riwayat perubahan prompt tercatat.
**AC:**
- AC-1: Outcome yang tidak punya pasangan finding di ledger run tersebut dilaporkan sebagai `DA_MISS`.
- AC-2: Finding yang di-dismiss lalu muncul lagi sebagai outcome dilaporkan sebagai `FALSE_DISMISS`.
**Effort:** M.

## C-14 · P2 · Ledger tech debt untuk trade-off yang diterima

**Sumber:** `resources/openai-advanced/repo-template/docs/exec-plans/tech-debt-tracker.md` (tanggal, area, debt, alasan ditunda, risiko, pemicu untuk ditinjau lagi), L12 ("clean up later" sama dengan tidak pernah dibersihkan).
**Bukti:** Finding MEDIUM/LOW yang diterima Judge sebagai trade-off, waiver `L3 waived:` dari #112, dan finding Standards non-hard tidak dibawa ke run berikutnya. Setelah run selesai, semuanya hanya tinggal di folder run.
**Usulan:** Saat delivery, finding `ACCEPT as tradeoff` dan waiver ditulis ke `.ai-engineering-loop/debt.json` beserta file, risiko, dan pemicu peninjauan. Context pack run berikutnya yang menyentuh file yang sama menampilkan debt terkait, dan `ael debt` menampilkan daftarnya.
**AC:**
- AC-1: Waiver L3 dan finding yang diterima sebagai trade-off muncul di `debt.json` setelah delivery.
- AC-2: Run baru yang menyentuh file yang punya debt terbuka menampilkannya di review pack.
**Effort:** S-M.

## C-15 · P3 · Feature ledger lintas run dan metrik VCR

**Sumber:** L08 (feature list sebagai primitive yang menjadi sumber bagi scheduler, verifier, handoff, dan progress tracker; transisi status dikendalikan harness), L07 (VCR = fitur terverifikasi / fitur yang diaktifkan), pola self-feeding loop di L13 level 4.
**Bukti:** AEL bekerja per task (satu Goal Contract per run). Tidak ada daftar fitur tingkat proyek yang statusnya naik otomatis ketika run DELIVERED. `docs/board.md` di repo ini masih diisi manual oleh bot.
**Usulan:** File opsional `.ai-engineering-loop/features.json` berisi `id`, perilaku, command verifikasi, status, dan `runId` sebagai bukti. Run yang mencapai DELIVERED dan terhubung ke sebuah fitur menaikkan statusnya ke `passing`; agen tidak bisa mengubah status langsung. `ael next` menyarankan fitur berikutnya dan menampilkan VCR. Run baru lewat `--new` saat VCR < 1 memunculkan peringatan.
**AC:**
- AC-1: Status fitur hanya berubah lewat transisi run (dicek oleh test), bukan lewat edit manual.
- AC-2: `ael next` memilih fitur `not_started` dengan prioritas tertinggi yang dependensinya sudah terpenuhi.
**Effort:** L.

## C-16 · P3 · Catat input reviewer ("model-visible means logged")

**Sumber:** DeepSeek Harness breakdown ("Anything that reaches a model request must be reconstructable from the log"), L11 (task trace yang bisa di-replay).
**Bukti:** Ledger DA diikat ke hash output mentah (`reviewer.rawSha256`, `lib/review-ingest.js:78`), tapi isi yang dilihat DA/Judge (path dan hash review pack, daftar file context, versi prompt agent) tidak dicatat. Akibatnya kita tidak bisa merekonstruksi kenapa DA melewatkan sesuatu, padahal itu yang dibutuhkan C-13.
**Usulan:** Saat `review-pack` dan saat spawn Judge, catat `inputs: [{path, sha256}]` dan `promptSha256` (hash isi `agents/shared/*.body.md`) di ledger dan verdict. Gate menolak ledger yang `inputs`-nya tidak cocok dengan pack yang ada.
**AC:**
- AC-1: Ledger berisi hash review pack dan hash prompt DA yang dipakai.
- AC-2: Mengubah pack setelah DA berjalan membuat binding gagal.
**Effort:** S.
