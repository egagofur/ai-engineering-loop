# T2 risky tier

Applies to HIGH_RISK_PATH changes (auth, payments, migrations, secrets, infra), DOT business logic, more than 10 files, or a manual `--tier T2`.

- Grill before the Goal (`docs grill-policy`): design tree, recommended answers, no look-up questions.
- Business-logic changes need a blast radius: lifecycle sketch of what reads and writes the changed state; on `adapter_type: dot` load `task-impact-inquiry`. Skip it for docs, config, or UI-copy changes.
- Full DA (not the T1 lean shortcut) and Judge on STRONG_MODEL resolved through the host model catalog; if unavailable, escalate to the user. Never run the deterministic Judge for T2.
- UNATTENDED: sandbox worktree only, and `budget pause` is the kill switch (`docs runtime-safety`).
- The tier never falls back once raised.
