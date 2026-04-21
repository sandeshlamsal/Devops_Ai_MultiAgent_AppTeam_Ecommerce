# DevOps AI Multi-Agent App Team — E-Commerce

> A self-organizing AI software company: 9 specialized agents running in parallel, continuously exchanging feedback via Redis, to autonomously design, build, test, and ship a production-grade e-commerce web application — powered by your Claude Pro plan.

---

## Billing & Authentication

> **This is the most important section before you run anything.**

### The Problem: Two Separate Billing Systems

Anthropic has two completely independent products with separate billing:

| | Claude Pro ($20/mo) | Anthropic API (pay-as-you-go) |
|---|---|---|
| **What it covers** | claude.ai web app, Claude Code CLI | Direct API access via `@anthropic-ai/sdk` |
| **How you pay** | Monthly subscription | Credit balance at console.anthropic.com |
| **Starts with credits?** | Yes — unlimited via Pro plan | No — starts at $0, minimum top-up |
| **API key source** | Not available | console.anthropic.com/api-keys |

A Claude Pro subscription does **not** include API credits. If you run agents that call the `@anthropic-ai/sdk` directly with your own API key, that is billed separately even if you pay $20/month for Pro.

---

### Option A — Anthropic API (direct SDK)

Each agent calls `new Anthropic({ apiKey })` directly. Fast, simple, full control over model and parameters.

**Requires:** API credits topped up at [console.anthropic.com/settings/billing](https://console.anthropic.com/settings/billing)

```
Your app → @anthropic-ai/sdk → api.anthropic.com → billed against credit balance
```

**Cost estimate for this project:**
- A full sprint run (BA → Architect → 3 PRs → QA + Security → Deploy): ~$0.50–$2.00
- With prompt caching (system prompts cached): ~40% cheaper on repeat calls
- Minimum top-up: $5

**Setup:**
```bash
# 1. Get API key from console.anthropic.com/api-keys
# 2. Top up credits at console.anthropic.com/settings/billing
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env
```

---

### Option B — Claude Code CLI ✅ (this project uses this)

Each agent spawns a `claude --print "..."` subprocess. The `claude` CLI authenticates using the OAuth credentials stored at `~/.claude` on your host — the same session used when you run `claude` in your terminal. **This runs entirely under your Pro plan. No API key, no credit balance needed.**

```
Your app → claude CLI subprocess → ~/.claude credentials → Claude Pro plan
                                        ↑
                            mounted into Docker as read-only volume
```

**How it works technically:**

```
docker-compose.yml
  agents:
    volumes:
      - $HOME/.claude:/root/.claude:ro   ← host credentials, read-only
                                            container's claude CLI uses these
```

```typescript
// agents/shared/base-agent.ts
import { execFile } from 'child_process'

protected async callLLM(userMessage: string): Promise<string> {
  const fullPrompt = `<system_instructions>\n${this.systemPrompt}\n</system_instructions>\n\n${userMessage}`

  const { stdout } = await execFileAsync(
    'claude',
    ['--print', fullPrompt, '--output-format', 'text'],
    { timeout: 120_000 }
  )
  return stdout.trim()
}
```

**Setup (one time):**
```bash
# 1. Make sure you're logged in to Claude Code on your host
claude   # opens interactive session — confirms you're authenticated

# 2. That's it — ~/.claude is automatically mounted into Docker
docker compose up
```

**Tradeoff vs Option A:**

| | Option A (SDK) | Option B (CLI) ✅ |
|---|---|---|
| Billing | Pay-per-token API credits | Included in Pro plan |
| Latency per call | ~1–3s | ~2–5s (subprocess overhead) |
| Model control | Full (model, tokens, temp) | Inherits Claude Code defaults |
| Streaming | Yes | No (waits for full response) |
| Prompt caching | Yes (`cache_control`) | Managed by Claude Code |
| Best for | Production scale, high volume | Development, personal projects |

---

## What Was Built (Workflow So Far)

### Day 1 — Project Setup

1. Designed the multi-agent architecture: 9 specialized agents communicating via Redis pub/sub
2. Scaffolded all 18 TypeScript files — zero type errors from the start
3. Built the shared infrastructure:
   - `EventBus` — Redis pub/sub with typed events, broadcast semantics
   - `ContextStore` — shared JSON state store + artifact writer
   - `BaseAgent` — abstract class all agents extend
4. Implemented all 9 agents with real system prompts and event-driven logic
5. Containerized with Docker Compose (Redis + Postgres + agents)

### First Run — Issue Discovered

On the first `docker compose up`, agents started, subscribed, and PM emitted `sprint.started`. But BA and DevOps hung silently. Root cause after investigation: errors were being swallowed by `Promise.allSettled` in the event bus.

**Fix 1 — Error surfacing:** Added error logging to the bus and a try/catch wrapper in `BaseAgent.start()` that emits `blocker.raised` on failure.

**Fix 2 — Timeout:** Added a 120s race against the API call so hung requests surface instead of waiting forever.

After the fix, the real error became visible:
```
⛔  BadRequestError: Your credit balance is too low to access the Anthropic API.
```

**Fix 3 — Billing architecture:** The API key used had no credits. Discovered the two-billing-system problem (Pro plan ≠ API credits). Rather than top up, migrated the entire LLM backend from `@anthropic-ai/sdk` to `claude` CLI subprocesses (Option B above), so the project runs under the existing Pro plan.

### Current State

```
Infrastructure:  ✅ Redis + Postgres + agents container running
Agents:          ✅ 9 agents subscribed and ready
Auth:            ✅ Migrated to claude CLI (Pro plan, no API credits needed)
Sprint 1:        ⏳ Ready to run — pending docker compose up with new image
```

---

## Live Output — Agents Running

When you run `docker compose up`, all 9 agents boot simultaneously:

```
╔══════════════════════════════════════════════════════╗
║   AI Multi-Agent E-Commerce Team — Booting up...    ║
╚══════════════════════════════════════════════════════╝

✅  Event bus connected (Redis)

[pm]            Agent started — subscribed to: blocker.raised, deploy.succeeded, deploy.failed, human.review_needed
[ba]            Agent started — subscribed to: sprint.started
[architect]     Agent started — subscribed to: story.ready
[frontend-dev]  Agent started — subscribed to: contract.ready, review.changes_requested
[backend-dev]   Agent started — subscribed to: contract.ready, review.changes_requested
[qa]            Agent started — subscribed to: review.approved
[code-reviewer] Agent started — subscribed to: pr.opened, review.changes_requested
[security]      Agent started — subscribed to: review.approved
[devops]        Agent started — subscribed to: sprint.started, test.passed

✅  9 agents online — team is ready

[pm]     Sprint 1 kicked off — emitting sprint.started
[bus]    pm → sprint.started

[ba]     Analyzing product brief — generating epics and user stories...   ← claude CLI
[devops] Provisioning infrastructure and CI/CD pipeline...               ← claude CLI (parallel)

[ba]     Generated 18 user stories across 6 epics
[bus]    ba → story.ready  (×18)
[architect] Designing system architecture and API contracts...

[architect] System design document written to workspace/artifacts/architecture/system-design.md
[architect] Defined 22 API contracts — emitting contract.ready
[bus]    architect → contract.ready

[frontend-dev] Picking up 3 frontend stories                             ← parallel
[backend-dev]  Implementing API from 22 contracts                        ← parallel

[bus]    frontend-dev → pr.opened
[bus]    backend-dev  → pr.opened

[code-reviewer] Reviewing PR: "[Frontend] User Registration page"
[code-reviewer] ✅ APPROVED
[bus]    code-reviewer → review.approved

[qa]       Testing merged PR...                                           ← parallel
[security] Running security scan...                                       ← parallel

[qa]       ✅ Tests passed — coverage: 87%
[bus]      qa → test.passed
[security] ✅ Security scan clear

[devops]   ✅ Staging deployment succeeded
[bus]      devops → deploy.succeeded
[pm]       Deployment succeeded — sprint milestone reached.
```

---

## How Agents Are Built and Communicate

### Architecture — Single Process, 9 Agents, One Redis Channel

```
Node.js Process (agents container)
├── PMAgent            ┐
├── BAAgent            │  All share one EventBus (two Redis connections: pub + sub)
├── ArchitectAgent     │  All share one ContextStore (workspace/context.json)
├── FrontendDevAgent   │  Each spawns `claude --print` subprocesses for LLM calls
├── BackendDevAgent    │  All run concurrently as async tasks — not threads, not processes
├── QAAgent            │
├── CodeReviewerAgent  │
├── SecurityAgent      │
└── DevOpsAgent        ┘
          │
          ▼ Redis pub/sub
    channel: "agent:events"   ← single broadcast channel, all agents see all events
```

### BaseAgent — The Foundation of Every Agent

```typescript
export abstract class BaseAgent {
  protected role: AgentRole
  protected systemPrompt: string  // defines the agent's persona and expertise

  start(): void {
    // subscribe to event types this agent cares about
    for (const type of this.subscribedEvents()) {
      this.bus.on(type, async (event) => {
        try {
          await this.handleEvent(event)   // agent-specific logic
        } catch (err) {
          // emit blocker.raised so PM is notified of failures
        }
      })
    }
  }

  // ── LLM backend: claude CLI subprocess ──────────────────────────────────
  protected async callLLM(message: string): Promise<string> {
    const prompt = `<system_instructions>\n${this.systemPrompt}\n</system_instructions>\n\n${message}`
    const { stdout } = await execFileAsync('claude', ['--print', prompt])
    return stdout.trim()
  }

  protected async callLLMJson<T>(message: string): Promise<T> {
    const raw = await this.callLLM(message + '\n\nRespond with valid JSON only.')
    return JSON.parse(raw.replace(/^```json?\n?/, '').replace(/\n?```$/, ''))
  }

  protected emit(type: EventType, payload = {}): Promise<void> {
    return this.bus.emit(type, this.role, payload)   // publish to Redis
  }
}
```

### Event Flow — How Agents Trigger Each Other

```
PM.kickoff()
    │
    └─ this.emit('sprint.started')
              │
              ▼  Redis pub/sub broadcasts to ALL subscribers
    ┌─────────┴──────────────────────────┐
    │                                    │
BAAgent.handleEvent()            DevOpsAgent.handleEvent()
    │  calls claude CLI                  │  calls claude CLI (parallel)
    │  generates 18 stories              │  generates infra configs
    │
    └─ this.emit('story.ready') ×18
              │
              ▼  (batched after 3+ epics)
    ArchitectAgent.handleEvent()
        │  calls claude CLI
        │  designs API contracts
        │
        └─ this.emit('contract.ready')
                  │
         ┌────────┴────────┐
         ▼                 ▼
  FrontendDevAgent   BackendDevAgent    ← PARALLEL (both react to same event)
         │                 │
         └────────┬────────┘
                  ▼
         this.emit('pr.opened')
                  │
                  ▼
        CodeReviewerAgent
                  │
         ┌────────┴────────┐
         ▼                 ▼
      review.approved   review.changes_requested
         │                      │
         │              Dev agent fixes & re-opens PR (loop)
         │
    ┌────┴────┐
    ▼         ▼
 QAAgent  SecurityAgent   ← PARALLEL (both react to review.approved)
    │
    └─ test.passed → DevOpsAgent → staging deploy
```

### Why Broadcast (Not Queue) Semantics

Redis pub/sub means every subscriber sees every message. This enables:
- **QA + Security** both react to `review.approved` simultaneously — no coordination needed
- **Frontend Dev + Backend Dev** both react to `contract.ready` simultaneously
- Adding a new agent only requires subscribing to the right event — no other agent needs to change

---

## Agent Roster

| # | Agent | System Prompt Role | Subscribes To | Emits |
|---|-------|--------------------|---------------|-------|
| 1 | **PM** | Project Manager | `blocker.raised`, `deploy.*` | `sprint.started` |
| 2 | **BA** | Senior Business Analyst | `sprint.started` | `story.ready` ×N |
| 3 | **Architect** | Senior Software Architect | `story.ready` (batched 3+) | `contract.ready` |
| 4 | **Frontend Dev** | Senior React/Next.js Dev | `contract.ready`, `review.changes_requested` | `pr.opened` |
| 5 | **Backend Dev** | Senior Fastify/Node.js Dev | `contract.ready`, `review.changes_requested` | `pr.opened` |
| 6 | **Code Reviewer** | Senior Code Reviewer | `pr.opened`, `review.changes_requested` | `review.approved`, `review.changes_requested` |
| 7 | **QA** | Senior QA Engineer | `review.approved` | `test.passed`, `test.failed` |
| 8 | **Security** | Senior Security Engineer | `review.approved` | `vuln.found` |
| 9 | **DevOps** | Senior DevOps/SRE | `sprint.started`, `test.passed` | `deploy.succeeded`, `deploy.failed` |

---

## Feedback Loops

| Event | From | To | What Happens |
|-------|------|----|--------------|
| `sprint.started` | PM | BA + DevOps | Stories generated; infra provisioned — **in parallel** |
| `story.ready` ×N | BA | Architect | Batches epics, then designs full API surface |
| `contract.ready` | Architect | Frontend + Backend | Both start coding — **in parallel** |
| `pr.opened` | Dev | Code Reviewer | PR reviewed against contracts + acceptance criteria |
| `review.changes_requested` | Reviewer | Dev | Dev fixes and re-opens — **feedback loop** |
| `review.approved` | Reviewer | QA + Security | Tests written and run; security scan — **in parallel** |
| `test.failed` | QA | Dev | Bug auto-assigned back to author — **feedback loop** |
| `vuln.found` | Security | Dev + PM | Patch ticket created; sprint re-evaluated — **feedback loop** |
| `test.passed` | QA | DevOps | Triggers staging deployment |
| `deploy.failed` | DevOps | PM | Blocker raised, human escalation if needed |
| `deploy.succeeded` | DevOps | PM | Sprint milestone logged |
| `blocker.raised` | Any | PM | Sprint plan re-evaluated |

---

## Project Structure

```
.
├── agents/
│   ├── index.ts              ← boots all 9 agents, PM kicks off sprint
│   ├── shared/
│   │   ├── types.ts          ← AgentRole, EventType, Story, ApiContract, PR, etc.
│   │   ├── event-bus.ts      ← Redis pub/sub (typed, broadcast semantics)
│   │   ├── context-store.ts  ← shared JSON state + artifact writer
│   │   └── base-agent.ts     ← callLLM via claude CLI, emit, start, error handling
│   ├── pm/                   ← Project Manager
│   ├── ba/                   ← Business Analyst
│   ├── architect/            ← Architect
│   ├── frontend-dev/         ← Frontend Developer
│   ├── backend-dev/          ← Backend Developer
│   ├── qa/                   ← QA Engineer
│   ├── code-reviewer/        ← Code Reviewer
│   ├── security/             ← Security Analyst
│   └── devops/               ← DevOps / SRE
├── workspace/                ← all agent output (Docker named volume)
│   ├── context.json          ← live shared state
│   └── artifacts/
│       ├── stories/          ← user-stories.json
│       ├── architecture/     ← system-design.md, api-contracts.json
│       ├── frontend/         ← Next.js source files
│       ├── backend/          ← Fastify source files
│       ├── tests/            ← Vitest + Playwright test suites
│       ├── reports/          ← QA + Security scan reports
│       └── infra/            ← Dockerfiles, GitHub Actions workflows
├── Dockerfile.agents         ← node:20-alpine + @anthropic-ai/claude-code
├── docker-compose.yml        ← Redis + Postgres + agents (mounts ~/.claude)
├── .env.example              ← only REDIS_URL needed (no API key)
└── package.json
```

---

## Run It

**Prerequisites:** Claude Code installed and authenticated (`claude` works in your terminal).

```bash
# 1. Copy env (no API key needed)
cp .env.example .env

# 2. Start everything — Redis, Postgres, and all 9 agents
docker compose up

# 3. Stream live logs in another terminal
npm run logs
# or: docker compose logs agents -f

# 4. Copy all generated artifacts to your host when done
npm run artifacts

# 5. Tear down everything cleanly
docker compose down -v
```

---

## E-Commerce App Being Built

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, TypeScript, Tailwind CSS, Zustand, React Query |
| Backend | Node.js, Fastify, Prisma ORM |
| Database | PostgreSQL (primary), Redis (sessions/cache) |
| Auth | JWT, bcrypt |
| Payments | Stripe (test mode) |
| Testing | Vitest, Playwright E2E, Supertest |
| Infra | Docker, GitHub Actions, Vercel + Railway |

**Features:** Product catalog, search + filters, product detail pages, shopping cart, checkout with Stripe, order history, admin dashboard.

---

## Key Design Principles

1. **Parallelism by default** — agents block only on hard dependencies; everything else runs concurrently.
2. **Broadcast events, not queues** — Redis pub/sub means multiple agents react to the same event simultaneously.
3. **Self-healing feedback loops** — QA bugs and Security vulns re-trigger dev agents automatically.
4. **Shared ground truth** — one `ContextStore`, one `workspace/` volume; no private silos.
5. **Pro plan, no extra billing** — `claude --print` subprocesses run under your Claude Pro OAuth session.

---

*Built with [Claude Code](https://claude.ai/code) — multi-agent orchestration on the Anthropic SDK.*
