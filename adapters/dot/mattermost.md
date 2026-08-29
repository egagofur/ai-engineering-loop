# DOT Adapter: Mattermost Notifications

## 1. Overview & Objectives

The **Mattermost Notification Module** formats final release notes and delivers them to team channels via the Mattermost MCP server or CLI.

This gives QA, product, and reviewers visibility when the delivery pipeline finishes.

---

## 2. Channel Resolution & Dispatch Flow

```text
MRs created
  -> read ~/.gemini/config/mattermost-channel-mapping.json
     -> channel found  -> MCP mattermost_send_message
     -> channel missing -> ask user, save mapping, then send
  -> if MCP fails -> Mattermost agent CLI once
```

Do not hard-code a machine path. The mapping file lives under the user's home directory.

---

## 3. Mandatory Attribution Rule

When sending messages or replying to threads (MCP or CLI):

- Always set sender attribution (`from: "AI Agent"`) in MCP calls:

```json
{
  "channel": "<team-channel>",
  "message": "...",
  "from": "AI Agent"
}
```

- Always pass `--from "AI Agent"` on the CLI:

```bash
<mattermost-cli> send <channel> "<message>" --from "AI Agent"
```

Resolve the CLI from PATH or the command the user already uses. Do not embed another developer's local checkout.

---

## 4. Channel Resolution Logic

1. **Inspect mapping file**:
   Read `~/.gemini/config/mattermost-channel-mapping.json` using the current repository name or `git` remote slug (`<group>/<repo>`).
2. **Channel found**:
   Dispatch to that channel name.
3. **Channel unknown**:
   - Do not guess or broadcast.
   - Ask the user for the channel for this repository.
   - Persist the answer in `~/.gemini/config/mattermost-channel-mapping.json`.

---

## 5. Standardized Mattermost Markdown Report Format (No AI Slop + Human-Written + PIC at End)

Render a ready-to-copy block per Merge Request:

```text
[MR <ENV_TAG>] <MR_URL>
Changes log
- <Poin 1: Apa yang diperbaiki / fitur apa yang aktif>
- <Poin 2: Perubahan mekanisme/perilaku sistem secara gamblang>
- <Poin 3: Proteksi regresi atau pengujian yang ditambahkan>

cc: <PIC>
```

### Formatting & Writing Rules (Prinsip `no-ai-slop`):

- **No markdown headings** (`#`, `##`, `###`): plain text so Mattermost does not enlarge fonts.
- **No long metadata tables** (branch, repo, verification). MR link + Changes log only.
- **PIC on the last line**: from the mapping file. If missing, ask and save. `cc: <PIC>`.
- **Concrete human language**:
  - Start with an active verb: *"Memperbaiki..."*, *"Memigrasikan..."*, *"Menjaga..."*, *"Menambahkan..."*, *"Mengubah..."*.
  - No puffery: `secara komprehensif`, `memastikan keakuratan`, `memfasilitasi`, `menyelaraskan alur`, `mengoptimalkan proses`, `solusi yang kokoh/robust`, `meningkatkan efisiensi`, `telah berhasil diimplementasikan`.
  - No raw code / AST: do not name internal fields, queries, or ORM calls. Describe the user-visible change.

### Environment Tags:

- `[MR DEV]`: `develop`
- `[MR STAGING]`: `staging`
- `[MR MAIN]` (or `[MR PROD]`): `main` / `master`

### Fictional sample (do not replace with a real ticket):

```text
[MR DEV] https://gitlab.example.com/example-org/work-portal/-/merge_requests/12
Changes log
- Memperbaiki status kartu di daftar request yang masih PENDING padahal semua baris sudah disetujui.
- Menjaga request lain di periode yang sama agar approval-nya tidak ter-reset.
- Menambahkan unit test untuk hari libur, jendela non-standar, dan koleksi baris yang kosong.

cc: @owner
```
