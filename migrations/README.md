# Major-version migrations

`update apply` runs `ai-engineering-loop migrate --from <old-version>` with the
new version whenever an update crosses a major (1.x -> 2.x). For each major in
`(old, new]` that has a `migrations/<major>.js`, AEL runs `migrateHome` once and
`migrateProject` once per registered project, and records what ran in
`~/.ai-engineering-loop/migrations.json`.

```js
// migrations/2.js
module.exports = {
  major: 2,
  description: 'Rename X to Y in project context',
  migrateHome({ home }) {},
  migrateProject({ projectDir }) {}
};
```

Rules: idempotent (safe to run twice), no network, touch only AEL-managed files,
and describe the change in CHANGELOG.md under the major's heading. No migration
ships yet (1.x).
