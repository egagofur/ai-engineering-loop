---
name: code-simplifier
description: Use when the user explicitly asks to simplify, tidy, or de-slop a finished diff without changing behavior. Does NOT review for defects (use the Devil's Advocate), refactor architecture, rename public APIs, or run automatically after edits.
---

# Code Simplifier

Rewrite *how* changed code reads; never *what* it does. Behavior, contracts, status codes, queries, and public names stay identical.

Optional in the AI Engineering Loop: only at T1/T2, only on request, after Maker and **before** `verify`, so verification and the Devil's Advocate see the final diff.

## Scope

1. Only files in `git diff` (staged and unstaged) or paths the user named. Do not open neighbors "while you are there".
2. Follow the target repository's own conventions (`.ai-engineering-loop/conventions.md`, `AGENTS.md`, `CLAUDE.md`), not personal taste.
3. Keep architectural layers separate. Never merge or skip a layer.

## Allowed changes

- Remove dead code, unused imports, unreachable branches, and debug output added by this diff.
- Flatten needless nesting with early returns; replace clever one-liners with plain code.
- Collapse duplicated logic introduced by this diff into one local helper.
- Rename local variables whose names hide intent.
- Delete comments that restate the code; keep comments that explain *why*.
- Replace hand-rolled code with an existing helper the repo already uses.

## Not allowed

- Behavior or output changes, including error messages that callers or tests match.
- File moves, public API renames, new dependencies, new abstractions or frameworks.
- Changing or deleting tests to make them pass; new tests are Maker work.
- Formatting churn outside changed hunks.

If the code cannot get simpler without changing behavior, stop and say so; that is a separate task.

## Procedure

1. List the changed files and the hunks you will touch.
2. Apply the smallest edits that make each hunk easier to read.
3. Run the repository's fast checks (unit tests, typecheck, lint) and show the output. Any new failure means revert that edit.
4. Report: files touched, what was simplified, and confirmation that behavior is unchanged with command evidence.

Inside a loop run, the simplified diff still goes through `verify`, claimed-vs-reality, and review; this skill never replaces a gate.
