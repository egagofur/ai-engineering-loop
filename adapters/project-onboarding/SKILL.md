---
name: project-onboarding
description: Use when the user asks to onboard onto a repository or to fill or refresh .ai-engineering-loop/architecture.md and conventions.md from the actual code. Does NOT run the engineering loop, edit source code, or trigger automatically on every session.
---

# Project Onboarding

Turn an unfamiliar repository into evidence-backed living context for the AI Engineering Loop. Output goes into `.ai-engineering-loop/architecture.md` and `.ai-engineering-loop/conventions.md`, in the language the user writes in (Indonesian or English).

Run `npx ai-engineering-loop init` first if `.ai-engineering-loop/` is missing. Never edit source code here.

## Procedure

1. **Shape.** List the top two directory levels and the manifests (package.json, go.mod, pyproject.toml, pom.xml, Gemfile, composer.json, Cargo.toml, Dockerfile, CI files). Record languages, frameworks, entry points, and how to run, test, and build.
2. **History.** `git log --oneline -n 100` (or `--since=<date>` for a large repo) and `git shortlog -sn -n 100`. Note hot directories, recent large changes, and reverts. Reverts and repeated fixes in one area are gotcha candidates.
3. **Data path.** Follow one real request or job from ingress to persistence and side effects. Name the modules and seams.
4. **Conventions.** Grep for the patterns the code actually uses: error handling, logging, validation, config, test layout, naming. Check `*.{js,ts,tsx,jsx,py,go,rb,java,kt,php,rs,cs,swift,sql}`. Prefer what most files do over what one file does.
5. **Gotchas.** Only record ones you can prove: cite a file:line, commit, test, or command output for each. No speculation.
6. **Write.** Update the two files with the template in `references/output.md`. Keep existing human-written sections; add or replace only the sections this skill owns.
7. **Report** what you added, the evidence count, and any open question for the human.

## Rules

- Evidence over adjectives: every claim names its source.
- Do not paste secrets, tokens, customer data, or `.env` values; name the variable instead.
- Keep each file short (aim for under 150 lines). Link to code instead of copying it.
- Commands you ran go into `.ai-engineering-loop/verification.md` only if they actually passed.
