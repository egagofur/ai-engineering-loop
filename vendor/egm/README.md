# vendor/egm

Pinned copy of the files AEL uses from [egagofur/elephant-goldfish-model](https://github.com/egagofur/elephant-goldfish-model),
a fork of [google/elephant-goldfish-model](https://github.com/google/elephant-goldfish-model) (Apache-2.0, Copyright Google LLC).
The commit is in `UPSTREAM.json`. Do not edit these files; they are the input of `scripts/sync-spec-pack.js`,
which writes the `spec` host pack to `adapters/spec/`. This folder is not part of the npm package.

Update from upstream:

1. `gh repo sync egagofur/elephant-goldfish-model` (pulls google/main into the fork)
2. `node scripts/sync-spec-pack.js --pull [ref]`
3. `npm test`, then open a PR.
