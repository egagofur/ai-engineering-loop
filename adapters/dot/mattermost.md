# DOT Adapter: Mattermost Notifications

## 1. Overview & Objectives

The **Mattermost Notification Module** formats final release notes and automatically delivers them to designated team channels via the Mattermost MCP server or CLI.

This provides seamless visibility to QA engineers, product managers, and reviewers upon successful completion of the delivery pipeline.

---

## 2. Channel Resolution & Dispatch Flow

```mermaid
flowchart TD
    Complete[MRs Created Across Environments] --> CheckMap[Check /Users/egagofur/.gemini/config/mattermost-channel-mapping.json]
    
    CheckMap --> Found{Channel Found for Repo?}
    
    Found -->|Yes| Dispatch[Dispatch via MCP mattermost_send_message]
    Found -->|No| PromptUser[Ask User for Target Channel]
    
    PromptUser --> SaveMap[Save New Channel to mattermost-channel-mapping.json]
    SaveMap --> Dispatch
    
    Dispatch --> CheckMCP{MCP Success?}
    CheckMCP -->|Yes| Done([Notification Complete])
    CheckMCP -->|No / Failed| FallbackCLI[Fallback to Mattermost Agent CLI]
    FallbackCLI --> Done
```

---

## 3. Mandatory Attribution Rule

> [!IMPORTANT]
> When sending messages or replying to threads on Mattermost (via MCP tools or CLI):
> - **Always** include the sender attribution parameter (`from: "AI Agent"`) in MCP calls:
>   ```json
>   {
>     "channel": "internal-dotify",
>     "message": "...",
>     "from": "AI Agent"
>   }
>   ```
> - **Always** include the CLI flag (`--from "AI Agent"`) in CLI calls:
>   ```bash
>   node /Users/egagofur/Development/work/kontribusi/mattermost-agent/dist/cli/index.js send <channel> "<message>" --from "AI Agent"
>   ```
> - Do not omit or suppress sender attribution.

---

## 4. Channel Resolution Logic

1. **Inspect Mapping File**:
   Read `/Users/egagofur/.gemini/config/mattermost-channel-mapping.json` using the current repository name or project slug (e.g. `dotify-new`, `dotify-api`, `dot-system/dotify-new`).
2. **Channel Found**:
   Dispatch message to the mapped channel name (e.g. `"internal-dotify"`).
3. **Channel Unknown**:
   - **DO NOT GUESS** or broadcast to arbitrary channels.
   - Ask the user to specify the target channel for this repository.
   - Immediately persist the user's answer into `/Users/egagofur/.gemini/config/mattermost-channel-mapping.json` for future automated runs.

---

## 5. Standardized Mattermost Markdown Report Format

Render separate, ready-to-copy Markdown blocks for every generated Merge Request:

```text
[MR <ENV_TAG>] <MR_URL>
Changes log 
- <Concise change point 1>
- <Concise change point 2>
- <Concise change point 3>
```

### Environment Tags:
- `[MR DEV]`: Merge Request targeting `develop`.
- `[MR STAGING]`: Merge Request targeting `staging`.
- `[MR MAIN]` (or `[MR PROD]`): Merge Request targeting `main` / `master`.

### Example Report:
```text
[MR DEV] https://gitlab.dot.co.id/dot-system/dotify-new/-/merge_requests/948
Changes log 
- Include user.type.hasNormalHours and timeEntities.overtimeNote in attendanceConfirmationPagination Prisma query.
- Create resolveAttendanceConfirmationDisplayStatus utility to properly evaluate hasPendingTimeEntities by checking overtimeNote, isWeekend, duration > 8, non-normal hours employees, and null statuses.
- Add comprehensive unit tests in src/server/attendance-confirmations/utils/resolve-display-status.test.ts covering all status permutations.

[MR STAGING] https://gitlab.dot.co.id/dot-system/dotify-new/-/merge_requests/947
Changes log 
- Include user.type.hasNormalHours and timeEntities.overtimeNote in attendanceConfirmationPagination Prisma query.
- Create resolveAttendanceConfirmationDisplayStatus utility to properly evaluate hasPendingTimeEntities by checking overtimeNote, isWeekend, duration > 8, non-normal hours employees, and null statuses.
- Add comprehensive unit tests in src/server/attendance-confirmations/utils/resolve-display-status.test.ts covering all status permutations.

[MR MAIN] https://gitlab.dot.co.id/dot-system/dotify-new/-/merge_requests/946
Changes log 
- Include user.type.hasNormalHours and timeEntities.overtimeNote in attendanceConfirmationPagination Prisma query.
- Create resolveAttendanceConfirmationDisplayStatus utility to properly evaluate hasPendingTimeEntities by checking overtimeNote, isWeekend, duration > 8, non-normal hours employees, and null statuses.
- Add comprehensive unit tests in src/server/attendance-confirmations/utils/resolve-display-status.test.ts covering all status permutations.
```
