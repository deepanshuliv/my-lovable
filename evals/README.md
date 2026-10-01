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

## Free platform model

Platform credits run only on `:free` OpenRouter models (always on, default model `poolside/laguna-s-2.1:free`; there is no switch to allow paid models). Every platform request carries `provider.max_price = 0`, so OpenRouter itself refuses a paid endpoint, and a response that reports any cost stops the run. Credits still draw down at a notional rate (`FREE_MODEL_CREDIT_*_PRICE_PER_M`). With free models the runner skips the key-balance checks, but the daily request ledger still applies: OpenRouter allows 20 requests a minute and 1,000 a day.

```bash
bun run eval --cases free-yoga-booking,free-chat-markers-in-code,free-social-footer-icons,free-two-file-feature --trials 3
```

Each `free-*` case targets a failure seen with the free model: missing imports and lucide 1.x icon names (the yoga page), tool-call JSON cut off at `</think>`/`<tool_call>`, guessed `cd` paths, and credits that never drew down. Deterministic versions of the provider failures (429s, mid-stream errors, dropped connections, empty replies, text tool calls, truncated arguments, the spend guard) live in `apps/backend/src/providers/freeModel.test.ts` and run in `bun test`.

## Levels

- **Level 1**: one behaviour per case, one turn: build, edit, repair, clarify (1–5 questions in one call), plan mode, secrets, safety, tools.
- **Level 2**: multi-turn continuity, full-stack features checked over HTTP, dependency installs, plan-then-build, crash recovery.

## Writing a case

Add an entry to `evals/cases.ts`: the rule or promise it checks, the prompt or turns, scripted answers for clarifying questions, optional setup, and graders from `evals/graders.ts`. Prefer deterministic graders (files, HTTP responses, `tsc`, event stream) and mark soft expectations `required: false`. When adding a grader, add known-good and known-bad transcripts to `evals/graders.test.ts`.
