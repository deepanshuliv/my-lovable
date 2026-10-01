# Agent evals

Evals measure the agent's behaviour with the real model, unlike `bun test` and the endpoint harness, which check plumbing with a scripted model.

## Running

```bash
docker compose up -d postgres redis        # or any reachable Postgres + Redis
export DATABASE_URL=... REDIS_URL=...
bun run eval                               # every case, 2 trials
bun run eval --level 2 --trials 1          # only Level 2
bun run eval --cases repair-type-error     # one case
```

The runner starts the real backend and worker with `evals/support/preload.ts`, which mocks Clerk and replaces Daytona with throwaway Docker containers built from `evals/sandbox.Dockerfile`. Agent commands never run on the host. Containers are removed after each trial.

## Spending

- `--budget` caps one run; the check happens before each trial.
- `--max-total` (default `0.6`) caps the sum of every run recorded in `evals/results/*.json`.
- `--min-remaining` (default `0.15`) refuses to start when the OpenRouter key has less left.
- Set `AGENT_MAX_TURN_COST_USD` (for example `0.03`) so a single runaway turn cannot exceed its share.
- `EVAL_JUDGE=1` enables the optional LLM judge, which costs an extra call per judged trial.

## Levels

- **Level 1**: one behaviour per case, one turn: build, edit, repair, clarify (1–5 questions in one call), plan mode, secrets, safety, tools.
- **Level 2**: multi-turn continuity, full-stack features checked over HTTP, dependency installs, plan-then-build, crash recovery.

## Writing a case

Add an entry to `evals/cases.ts`: the rule or promise it checks, the prompt or turns, scripted answers for clarifying questions, optional setup, and graders from `evals/graders.ts`. Prefer deterministic graders (files, HTTP responses, `tsc`, event stream) and mark soft expectations `required: false`. When adding a grader, add known-good and known-bad transcripts to `evals/graders.test.ts`.
