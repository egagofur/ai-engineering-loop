# Cards from "All Code Is Slop (Except Mine)" (2026-11-16)

> **Status: closed.** C-17 and C-18 shipped in [#116](https://github.com/egagofur/ai-engineering-loop/pull/116), C-19..C-25 in [#117](https://github.com/egagofur/ai-engineering-loop/pull/117), released in v2.8.0. Deviations: C-22 keeps the driver per feature in the map; C-23 became a full verification catalog.

Sumber: talk Lauren Tan ("Potato"), SpaceXSI, AI Engineer, 17:31, [youtube.com/watch?v=O_zcc6Xl12g](https://www.youtube.com/watch?v=O_zcc6Xl12g). Timestamp diambil dari auto-caption YouTube, sehingga nama produk di caption tidak konsisten. Ide diadaptasi dengan kata sendiri.

**Tesis talk:** kualitas harus naik bersamaan dengan volume kode. Caranya: setiap koreksi diubah menjadi pemeriksaan deterministik di codebase (01:02–03:23, 09:06), verifikasi dibuat kuat (09:26–12:46), dan prosa dipakai paling akhir (02:43). Mengotomasi inner loop yang masih sloppy hanya menghasilkan slop lebih banyak (15:26).

**Sudah ada di AEL (tidak dibuat card):** koreksi menjadi rule L1 dengan WHY/FIX (C-05, C-04), gate deterministik yang menghitung ulang hasil dari artifact, `smoke`/`e2e` dan `glossary.md`, link evidence per AC di receipt, rubric dengan bukti (C-09), outcome `revert` yang dicatat manual (C-13), dan debt ledger (C-14).

Prioritas: **P1** = mencegah slop masuk, **P2** = membuat review dan verifikasi lebih kuat, **P3** = metrik.

---

## C-17 · P1 · Rule mode ratchet: hanya baris baru yang dinilai

**Sumber:** 15:06 ("start with a lint rule to prevent new occurrences of anti-patterns and then clean up those old patterns as well"), 04:24–04:44 (agen menyalin pola yang sudah ada).
**Bukti:** `rulePlan` (`lib/rules.js:71`) menjalankan `check` untuk seluruh repo, dan `missingRules` (`lib/rules.js:94`) mewajibkan semua rule lulus. Repo yang sudah punya banyak pelanggaran lama langsung merah begitu rule dipromosikan, sehingga rule cenderung tidak pernah dipromosikan.
**Usulan:** field `scope: "repo" | "diff"` di rule (`learn promote --scope diff`). Untuk `diff`, AEL menjalankan `check` dengan env `AEL_CHANGED_FILES` dan `AEL_ADDED_LINES_FILE` (berisi baris yang ditambahkan diff yang sedang di-gate), sehingga rule menilai kemunculan baru saja. `doctor --harness` melaporkan jumlah pelanggaran lama per rule `diff` sebagai backlog pembersihan, dengan saran untuk naik ke `repo` setelah angkanya nol.
**AC:**
- AC-1: Rule `diff` lulus kalau pelanggaran hanya ada di baris lama, dan gagal kalau diff menambah satu pelanggaran baru (dengan `file:line` dan FIX).
- AC-2: Rule `repo` berperilaku sama seperti sekarang.
- AC-3: `doctor --harness` menampilkan sisa pelanggaran lama per rule `diff`.
**Effort:** M.

## C-18 · P1 · Komentar yang membenarkan jalan pintas jadi finding

**Sumber:** 06:46–08:06 (agen memakai markdown dan komentar untuk "write down their justifications for not doing the right thing"; komentar membenarkan timer quick-fix lalu timer itu menyebar), 08:06–08:46 (komentar tidak bisa di-enforce dan cepat basi).
**Bukti:** integrity scan (`lib/verification-integrity.js:69`) hanya memeriksa test dan config verifikasi. Komentar baru di kode produk yang berisi pembenaran (`// workaround`, `// quick fix`, `// eslint-disable`, `@ts-ignore`, `# noqa`, `// TODO: proper fix later`) lolos tanpa sinyal apa pun.
**Usulan:** tambah ke integrity scan: baris komentar baru di file non-test yang cocok dengan pola pembenaran atau suppress (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `# type: ignore`, `# noqa`, `nolint`, kata seperti `workaround|quick fix|hack|temporary|for now`). Hasilnya finding `axis: "standards"` MEDIUM (HIGH untuk suppress tanpa alasan), sehingga DA atau Judge harus memutuskan apakah ini akar masalah atau tambalan. Finding ini boleh di-dismiss reviewer dengan evidence; tidak perlu dismissal manusia seperti C-11.
**AC:**
- AC-1: Diff yang menambah `// eslint-disable-next-line` tanpa alasan menghasilkan finding HIGH dengan `file:line`.
- AC-2: Komentar biasa yang menjelaskan "kenapa" (tanpa kata pembenaran atau suppress) tidak menghasilkan finding.
- AC-3: Pola bisa diperluas per project lewat `.ai-engineering-loop/rules.json` (`justificationPatterns`).
**Effort:** S-M.

## C-19 · P2 · Learnings tentatif tidak boleh jadi aturan mutlak

**Sumber:** 06:46–07:06 (agen "over rotate on some small correction ... treat it like a hard rule that can never be broken ever again").
**Bukti:** `selectLearnings` (`lib/learn.js:261`) menyuntikkan learning yang relevan ke context pack walaupun baru muncul di satu run (`score > 0 || runIds.length > 1`). Context pack tidak membedakan lesson dari satu kejadian dengan pola yang sudah terbukti berulang.
**Usulan:** setiap learning di context pack diberi label `confidence: tentative` (1 run), `recurring` (2 run), atau `rule-candidate` (3+ run, `PROMOTE_AFTER_RUNS`). Label `tentative` dirender sebagai "pertimbangkan, bukan aturan". Instruksi DA: jangan membuat finding BLOCKER/HIGH hanya karena melanggar learning `tentative`.
**AC:**
- AC-1: Context pack menampilkan confidence untuk setiap learning.
- AC-2: Learning dari satu run dirender dengan kata "consider" dan tidak pernah dengan "must".
**Effort:** S.

## C-20 · P2 · Template rule boundary dan API terlarang

**Sumber:** 05:24–06:05 (melarang API yang butuh nuansa, seperti `useEffect`, di product code; hanya boleh di dalam framework, sehingga masalahnya "categorically eliminated"), 06:05–06:46 (batas arsitektur lewat struktur folder dan dependency graph).
**Bukti:** `learn promote` (`lib/rules.js:37`) menerima command bebas, jadi setiap tim harus merangkai sendiri skrip grep untuk pola yang paling umum: import lintas folder dan API terlarang di luar folder tertentu.
**Usulan:** dua jenis rule bawaan selain `check`:
- `--forbid-import "<fromGlob> -> <toGlob>"`: dicek dengan scan import/require pada file yang berubah.
- `--forbid-api "<regex>" --except "<glob>"`: dicek pada baris yang ditambahkan (menyatu dengan C-17).

Keduanya punya FIX bawaan, misalnya "pindahkan akses ke <toGlob> lewat ..."; teks FIX tetap wajib diisi manusia.
**AC:**
- AC-1: `forbid-import "src/renderer/** -> src/main/**"` gagal ketika diff menambah import dari renderer ke main, dengan `file:line`.
- AC-2: `forbid-api "\buseEffect\(" --except "src/framework/**"` lulus di dalam framework dan gagal di luarnya.
**Effort:** M.

## C-21 · P2 · Review berbasis artifact verifikasi

**Sumber:** 09:26–09:46 ("our code review process has now really shrunk into looking at verification artifacts ... videos, screenshots, diagrams, formal verification"), 12:46–13:06 (state chart dari sudut pandang user untuk mengecek apakah agen memahami maksud).
**Bukti:** receipt (`lib/receipt.js:255`) menampilkan command, claim, dan link evidence, tapi tidak ada bagian artifact per AC yang ditaruh paling atas. Goal draft juga tidak punya representasi alur yang bisa di-review sebelum kode ditulis.
**Usulan:** (1) Receipt mendapat bagian "Verification artifacts" di urutan pertama: per AC, link video, screenshot, dan diagram dari `--evidence`, dengan tanda ❌ untuk AC tanpa artifact kalau AC itu `crossComponent` atau punya `rubric`. (2) Field opsional `flow` di Goal Contract (daftar state → event → state dari sudut pandang user), dirender sebagai tabel transisi di `goal draft` dan di receipt, supaya manusia bisa memeriksa maksudnya sebelum kode ditulis.
**AC:**
- AC-1: Receipt menampilkan artifact per AC sebelum daftar command.
- AC-2: AC `crossComponent` tanpa artifact ditandai ❌ di receipt.
- AC-3: `goal draft` merender `flow` sebagai tabel transisi.
**Effort:** M.

## C-22 · P2 · Feature map untuk runtime verification

**Sumber:** 10:06–10:26 (feature map: "a site map of all of the features ... from the user's point of view", sehingga agen tidak perlu menebak maksud "the thingy in the left sidebar"), 10:26–10:46 (CLI/driver khusus di dalam skill yang dipakai ulang, hemat token, dan bisa dites).
**Bukti:** `glossary.md` (dibaca di setiap run, `skill-src/ael/SKILL.template.md:24`) berisi istilah domain, bukan peta fitur UI beserta cara mencapainya. Belum ada konvensi untuk driver verifikasi yang bisa dipakai ulang.
**Usulan:** file opsional `.ai-engineering-loop/feature-map.md` (fitur → lokasi di UI atau endpoint → cara mencapainya → command driver, kalau ada). Review pack menyertakan entri yang relevan dengan file yang berubah, dan baris L3 di claimed-vs-reality boleh merujuk ID fitur. Key `driver` di `verification.md` untuk CLI yang menjalankan alur user (dipakai `smoke`/`e2e`).
**AC:**
- AC-1: Review pack memuat entri feature map yang path-nya beririsan dengan diff.
- AC-2: `doctor --harness` memperingatkan kalau `e2e`/`smoke` ada tapi feature map kosong.
**Effort:** S-M.

## C-23 · P2 · Key verifikasi property-based dan formal

**Sumber:** 10:46–11:26 (TLA+ untuk model checking alur utama, Lean untuk membuktikan algoritma), 11:26–11:46 (property-based testing untuk UI), 12:26–12:46 (teknik yang dulu mahal sekarang murah berkat agen).
**Bukti:** `LAYER_OF_KEY` (`lib/verification-lanes.js:77`) hanya mengenal `build`, `typecheck`, `lint`, `test_*`, `smoke`, dan `e2e`. Hasil `property` atau `formal` jatuh ke default L2 tanpa identitas, dan C-07/C-01 tidak bisa mensyaratkannya.
**Usulan:** key opsional `property` (L2) dan `formal` (layer baru `LF`, tidak menggantikan L3) di `verification.md`. AC boleh menuntut `verify.layer: "LF"`. Default plan menjalankan `property` setelah `test_unit`; `formal` hanya jalan kalau diminta AC atau `--cmd`, karena biasanya lambat.
**AC:**
- AC-1: Record `property`/`formal` membawa layer yang benar di verification.json.
- AC-2: AC dengan `verify.layer: "LF"` hanya `proven` oleh command `formal` yang lulus.
**Effort:** S-M.

## C-24 · P3 · Revert rate dan porsi token verifikasi otomatis

**Sumber:** 13:26–14:46 (ribuan PR per bulan dengan revert rate stabil sekitar 0,5%, dan performa justru membaik), 11:46–12:26 ("70% of her daily tokens go into verification").
**Bukti:** `computeStats` (`lib/stats.js:31`) hanya membaca `iterations.jsonl`. Revert hanya masuk lewat `outcome record` manual (C-13). Budget ledger (`lib/budget.js`) mencatat token per `nodeId` tanpa membedakan generasi (Maker) dari verifikasi (DA, Judge, command).
**Usulan:** `stats` menghitung revert rate dari git: commit `Revert "..."` yang menunjuk commit hasil run DELIVERED (receipt menyimpan `HEAD`), dibagi jumlah run yang delivered. `budget record` menerima `--role maker|reviewer|judge|verification`, dan `stats` melaporkan porsi token verifikasi. Revert yang terdeteksi otomatis dicatat sebagai outcome `revert` untuk `calibrate`.
**AC:**
- AC-1: Repo dengan 1 revert dari 20 run delivered menghasilkan revert rate 5% di `stats`.
- AC-2: `stats` menampilkan porsi token per role kalau ledger punya `role`.
**Effort:** M.

## C-25 · P3 · Integrasi pstack `/statechart` lewat `formal` + diagram Mermaid untuk `flow`

**Sumber:** 12:46–13:06 (skill `statechart` di plugin pstack, untuk memvisualisasikan state machine dari sudut pandang user dan mereview-nya bersama video dan screenshot); [`cursor/plugins/pstack/skills/statechart`](https://github.com/cursor/plugins/tree/main/pstack/skills/statechart) (MIT, Lauren Tan).
**Bukti:** skill `statechart` melakukan model checking TLA+ dengan TLC lalu menggambar hasilnya sebagai statechart Mermaid, dengan jalur terpendek ke setiap state yang melanggar rule. Dependensinya Java + TLC (lewat `mise`, butuh internet saat pertama jalan), runtime TypeScript, dan renderer Pele; skill ini juga `disable-model-invocation`. AEL adalah Node murni tanpa dependency, jadi skill ini tidak di-vendor. AEL sudah punya slot `formal` (layer `LF`, C-23) dan link `--evidence` bertipe diagram (C-21), tapi belum ada resep yang menyambungkan keduanya. `flow` di Goal (C-21) sejauh ini hanya dirender sebagai tabel, belum sebagai diagram (`lib/receipt.js:286`).
**Usulan:**
1. **Resep (hanya dokumentasi):** `docs formal-statechart` di `core/` menjelaskan alurnya. Pasang pstack sebagai plugin (Cursor, atau Claude Code lewat `/pstack:statechart`), tulis spec `.tla` beserta rule INVARIANT untuk alur berisiko (pembayaran, sinkronisasi, protokol), lalu daftarkan command-nya sebagai key `formal` di `verification.md`, misalnya `- **formal**: \`<pstack>/skills/statechart/scripts/statechart spec/checkout.tla --out .tmp/statechart\``. AC mensyaratkannya dengan `"verify": { "layer": "LF" }`, dan `chart.mmd` (atau gambar hasil render) dilampirkan lewat `--evidence AC-N=<url>`. Dokumen ini juga menjelaskan bahwa TLC melanjutkan pemeriksaan melewati bug, jadi konstanta model harus dijaga kecil.
2. **Diagram Mermaid untuk `flow` (kode kecil):** receipt merender `flow` sebagai blok ```` ```mermaid stateDiagram-v2 ```` di samping tabel yang sudah ada (GitHub merender Mermaid), dan `goal draft` mengembalikan teks Mermaid yang sama di `extra.flow.mermaid`. Ini visualisasi saja, bukan model checking, jadi tidak menggantikan `formal`. Mermaid tidak boleh masuk ke SKILL.md (test Kiro-safe); aturan itu hanya berlaku untuk skill, sedangkan receipt adalah output PR.
**AC:**
- AC-1: Receipt dengan `flow` memuat blok `mermaid` berisi `stateDiagram-v2` dan satu baris transisi per langkah (`A --> B: event`). Nama state yang mengandung spasi atau karakter khusus di-escape, sehingga diagram tetap valid.
- AC-2: `goal draft` dengan `flow` mengembalikan `flow.mermaid` (string) di samping `flow.table`.
- AC-3: `ael docs formal-statechart` tersedia dan menyebut lisensi MIT serta sumber pstack. Tidak ada dependency atau file pstack yang ikut dipaket ke npm (`audit:package` tetap lolos).
**Effort:** S.

---

**Sengaja tidak dibuat card:** outer loop fuzz → PR fix → auto-merge (16:07–16:47) dan auto-merge saat "nothing left to review" (09:26). Keduanya bergantung pada C-17..C-24 dan fondasi yang sudah ada berjalan lebih dulu, sesuai peringatan di 15:26.

## C-26 · P1 · Tanpa komentar di kode produk (aturan default)

**Sumber:** 08:06–08:46 (ban 99% komentar: komentar basi, manusia tidak membacanya, agent memakainya untuk membenarkan tidak melakukan hal yang benar, dan komentar tidak bisa di-enforce; intent harus ada di kode, tes, dan lint).
**Bukti:** C-18 hanya menangkap suppress dan komentar pembenaran (`quick fix`, `for now`). Komentar biasa yang ditulis agent lolos, dan deteksinya tidak paham sintaks bahasa (`#` dianggap komentar di JS, `//` di dalam URL string ikut terdeteksi).
**Usulan:** di `gate review`, setiap baris komentar baru di file produk non-tes menjadi satu finding `source: "no-comments"` per file (`axis: standards`, `hardConvention: true`, HIGH, VALID), sehingga Judge ITERATE. Deteksi mengikuti sintaks bahasa per ekstensi dan mengabaikan string. Pengecualian: shebang, lisensi/SPDX/copyright, `@generated`, `/// <reference`, `//go:build`, encoding, `#region`. Opt-out per project hanya lewat `"comments": "allow"` di `rules.json` (diedit manusia); dismiss per finding butuh `dismissal.evidence`. Prompt Maker melarang komentar; DA tidak boleh meminta komentar.
**AC:**
- AC-1: Komentar biasa di `src/*.js` dan `*.py` menghasilkan satu finding `no-comments` per file yang `isBlockingFinding` = true, dengan nomor baris sebagai evidence.
- AC-2: Shebang, SPDX, `@generated`, `//go:build`, tes, docs, config, `#private` di JS, dan `//` atau `#` di dalam string tidak menghasilkan finding.
- AC-3: Suppress dan komentar pembenaran tetap menjadi finding C-18 dan tidak dihitung dua kali.
- AC-4: `"comments": "allow"` mematikan C-26; menurunkan severity atau `hardConvention` tanpa `dismissal.evidence` menggagalkan review gate.
**Effort:** S.

## C-27 · P2 · Diagram sebelum freeze

**Sumber:** permintaan user 2026-11-17: sebelum freeze, user ingin melihat dampak ke fitur lain dan data, bukan hanya membaca AC. Desain: `docs/superpowers/specs/2026-11-17-goal-freeze-diagrams-design.md`.
**Usulan:** `flow` Goal diperluas (`actor`, `guard`, `effects`, `hotspot`, `flowSubject`, `forbiddenTransitions`). `goal draft` menawarkan view yang direkomendasikan; `goal diagram --view state|storyboard|lanes` hanya merender view yang dipilih. Tabel transisi state × event dihitung CLI, jadi setiap `?` terlihat.
**AC:** validasi Goal gate, rekomendasi view, file hanya dibuat saat diminta, escaping, state Run tidak berubah (tests/flow-model, flow-diagram, goal-diagram-cli).
**Effort:** M.

## C-28 · P2 · `ael recap`

**Sumber:** permintaan user 2026-11-17: ringkasan per N hari berupa visualisasi fitur yang dikerjakan, untuk saya, lead, atau klien, dengan bukti. Spike dari 7 run asli dltx diterima. Desain: `docs/superpowers/specs/2026-11-17-ael-recap-design.md`.
**Usulan:** satu halaman HTML offline dengan tiga tab; semua angka dari artefak Run; view klien dibangun dari allowlist.
**AC:** filter jendela waktu, durasi per tahap, judul dan teks klien dari Goal, tidak ada kebocoran di view klien, perbandingan hanya jika periode lalu punya run, CLI menolak recap klien multi-project (tests/recap).
**Effort:** M.

