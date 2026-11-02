# Spec pack: design before code

The optional `spec` host pack adds design-document skills derived from Google's
[Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) (EGM,
Apache-2.0) through the fork [egagofur/elephant-goldfish-model](https://github.com/egagofur/elephant-goldfish-model).
The Elephant (your session) drafts; fresh Goldfish reviewers read only the document and
the code it cites; you decide the trade-offs.

## When to use it

- Use it for a new feature, an architecture change, an API or integration design, or a
  data-model change: work that needs decisions before code. A new T2 Run suggests it.
- Do not use it for a bug fix, typo, small refactor, or any T0/T1 task. Use the normal loop.

## Flow

1. `ael-spec-brainstorm <idea>`: clarifying questions, then six review lenses; writes `concepts_brief.md`.
2. `ael-spec-draft`: section-by-section `design_draft.md`, saved under `docs/designs/<name>.md`.
3. `ael-spec-review docs/designs/<name>.md`: staged Goldfish review (zoom out, comprehension,
   critique, readiness). Expect many findings; take what is relevant.
4. `ael-spec-resolve`: each finding is PROPOSE FIX, CONTEST, ESCALATE or DECLINE; you choose.
5. You approve and commit the design. Agreement in chat is not approval.
6. `npx ai-engineering-loop goal draft --run <id> --from-design docs/designs/<name>.md --revision <r>`:
   prefilled acceptance rows with `<fill: …>` placeholders, `outOfScope`, and `designRef`.
   Fill the placeholders; `goal freeze` refuses them. Then run the loop as usual.
7. Verify and review report design drift (planned files untouched, changed files outside
   the plan). Later, `ael-spec-drift docs/designs/` compares all designs with the code.

Personas and standards: `npx ai-engineering-loop docs ael-spec-zoom-out`,
`docs ael-spec-implementation-readiness-standard`, and so on.

## Hosts

`npx ai-engineering-loop sync-hosts --pack spec` installs the six `ael-spec-*` skills on
every enabled host. Reviewers spawn as fresh sibling subagents per `docs loop-hosts`. A host
without a subagent tool runs the reviewers one at a time in-session and labels the reports
`CONTEXT_ISOLATION_ONLY`; that is weaker than a Goldfish review and is disclosed.
`hosts doctor` shows, per host, whether the pack is installed and which mode it gets.

## Updating from upstream

1. `gh repo sync egagofur/elephant-goldfish-model` (pulls google/main into the fork).
2. In this repository: `node scripts/sync-spec-pack.js --pull [ref]`, then `npm test`.
3. Open a PR. Users get it through the normal CLI update.

The pinned commit is in `vendor/egm/UPSTREAM.json`; every generated file names it.
Attribution and the list of modifications: `THIRD_PARTY_NOTICES.md` and `adapters/spec/NOTICE-AEL.md`.
