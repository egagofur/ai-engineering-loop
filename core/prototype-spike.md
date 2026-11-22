# Prototype, then contract

When the design is still a guess, one throwaway spike is allowed before the Goal is frozen. The spike answers one question. You delete it, write the contract from what you learned, and the human freezes. Maker starts from that contract, not from the spike.

## Steps

1. Start the Run (`ael run "<task>"`). Do not edit product code yet.
2. Name one question the code can answer. Example: "Does the list helper already paginate?"
3. Answer it in a scratch branch or an untracked file you will delete. Do not commit that code onto the task branch.
4. Delete the scratch. Nothing from the spike remains in the tree.
5. Record the note:

```bash
npx ai-engineering-loop spike record --discarded \
  --question "Does the list helper already paginate?" \
  --learned "slice(0, 10) is fixed. The contract needs a page argument."
```

6. Draft the Goal from `learned`. Leave the spike's structure out of the acceptance criteria.
7. Show the draft and wait. The human freezes. Then Maker begins.

`spike show` reads `runs/<id>/spike.json`. A missing file is fine: a spike is optional. `discarded` must be true.

Recording is refused when `--discarded` is missing, or the Goal is already frozen. Re-recording before freeze replaces the note.

## Not a tournament

One spike, then the contract. Do not run a bake-off, a second model, or `/arena`. The human does not pick a winner among prototypes. There is nothing to pick: the prototype is gone, and the contract is what gets frozen.
