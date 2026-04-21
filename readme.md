# DevOps AI Multi-Agent App Team — E-Commerce

> A self-organizing AI software company: specialized agents running in parallel, continuously exchanging feedback, to autonomously design, build, test, and ship a production-grade e-commerce web application.

---

## Live Output — Agents Running

When you run `docker compose up`, all 9 agents boot simultaneously and begin working:

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
[ba]     Analyzing product brief — generating epics and user stories...   ← LLM call
[devops] Provisioning infrastructure and CI/CD pipeline...               ← LLM call (parallel)

[ba]     Generated 18 user stories across 6 epics
[bus]    ba → story.ready  (×18, one per story)
[architect] Designing system architecture and API contracts...            ← triggered by 3+ epics
[devops] Infrastructure configs generated — 6 files written

[architect] System design document written to workspace/artifacts/architecture/system-design.md
[architect] Defined 22 API contracts — emitting contract.ready
[bus]    architect → contract.ready
[frontend-dev] Picking up 3 frontend stories                             ← parallel
[backend-dev]  Implementing API from 22 contracts                        ← parallel

[backend-dev]  Implementing auth domain (4 endpoints)
[frontend-dev] Implementing story US-001: "User Registration page"
[bus]    frontend-dev → pr.opened
[bus]    backend-dev  → pr.opened

[code-reviewer] Reviewing PR abc123: "[Frontend] User Registration page"
[code-reviewer] PR abc123 — ✅ APPROVED: clean component, good validation
[bus]    code-reviewer → review.approved

[qa]       Testing merged PR abc123: "[Frontend] User Registration page"  ← parallel
[security] Running security scan on PR abc123...                          ← parallel

[qa]       ✅ Tests passed — coverage: 87%
[bus]      qa → test.passed
[security] ✅ Security scan clear for PR abc123

[devops]   Deploying PR abc123 to staging (deployment xyz789)
[devops]   ✅ Staging deployment xyz789 succeeded
[bus]      devops → deploy.succeeded
[pm]       Deployment succeeded — sprint milestone reached. Notifying team.
```

---

## How Agents Are Built and Communicate

### Single Process, 9 Agents, One Redis Channel

All 9 agents run inside a **single Node.js process** as concurrent async tasks — not separate containers or processes. Communication is entirely event-driven through Redis pub/sub.

```
Node.js Process
├── PMAgent          ┐
├── BAAgent          │
├── ArchitectAgent   │  All share one EventBus instance
├── FrontendDevAgent │  (two Redis connections: pub + sub)
├── BackendDevAgent  │
├── QAAgent          │  All share one ContextStore instance
├── CodeReviewerAgent│  (JSON file on disk: workspace/context.json)
├── SecurityAgent    │
└── DevOpsAgent      ┘
         │
         ▼
   Redis channel: "agent:events"
```

### How Each Agent Is Constructed

Every agent extends `BaseAgent`:

```typescript
// agents/shared/base-agent.ts
export abstract class BaseAgent {
  protected client: Anthropic       // each agent has its own Anthropic SDK client
  protected bus: EventBus           // shared — same Redis pub/sub instance
  protected store: ContextStore     // shared — same JSON context store

  start(): void {
    // registers this agent's handlers on the shared event bus
    for (const type of this.subscribedEvents()) {
      this.bus.on(type, (event) => this.handleEvent(event))
    }
  }

  // subclasses declare which event types they care about
  protected abstract subscribedEvents(): EventType[]

  // subclasses react to incoming events
  protected abstract handleEvent(event: AgentEvent): Promise<void>

  // call the LLM with this agent's cached system prompt
  protected async callLLM(message: string): Promise<string>

  // call the LLM and parse the response as JSON
  protected async callLLMJson<T>(message: string): Promise<T>

  // publish an event to all other agents
  protected emit(type: EventType, payload: {}): Promise<void>
}
```

Each concrete agent provides its role, a detailed system prompt, and its event handlers:

```typescript
// agents/ba/index.ts
export class BAAgent extends BaseAgent {
  constructor(bus: EventBus, store: ContextStore) {
    super('ba', SYSTEM_PROMPT, bus, store)
  }

  protected subscribedEvents() { return ['sprint.started'] }

  protected async handleEvent(event: AgentEvent) {
    if (event.type === 'sprint.started') {
      // calls Anthropic API → parses JSON → writes stories → emits story.ready × N
      await this.generateStories(event.payload.brief)
    }
  }
}
```

### How Agents Communicate — Step by Step

```
Agent A calls:  this.emit('story.ready', { storyId: 'US-001' })
                        │
                        ▼
EventBus.emit() serializes to JSON and publishes to Redis channel "agent:events"
                        │
                        ▼
Redis delivers the message to the single subscriber connection
                        │
                        ▼
EventBus routes by event.type → calls ALL handlers registered for 'story.ready'
                        │
              ┌─────────┴──────────┐
              ▼                    ▼
     ArchitectAgent         (no other agent subscribed to story.ready)
     .handleEvent(event)    
              │
              ▼
     Batches 3+ epics, then calls Anthropic API
     Parses response → writes API contracts to ContextStore
     this.emit('contract.ready', { contractCount: 22 })
              │
     ┌────────┴────────┐
     ▼                 ▼
FrontendDevAgent  BackendDevAgent    ← both react in parallel
```

### Why Multiple Agents Can React to One Event

The event bus does not use queues or exclusive consumers. It uses Redis **pub/sub** — broadcast semantics. Every subscriber sees every message. This means:

- `QAAgent` and `SecurityAgent` both subscribe to `review.approved` and run concurrently on every merged PR
- If two dev agents both emit `pr.opened`, the `CodeReviewerAgent` handles each independently
- No agent needs to know another agent exists — they only know about events

### Anthropic API — Prompt Caching

Each agent's system prompt is sent with `cache_control: { type: 'ephemeral' }`, meaning the first call primes a 5-minute cache. Subsequent calls within that window skip re-tokenizing the long system prompt, reducing cost and latency significantly for agents that handle many events in a burst.

---

## Agent Roster

| # | Agent | Subscribes To | Emits |
|---|-------|---------------|-------|
| 1 | **PM** | `blocker.raised`, `deploy.*`, `human.review_needed` | `sprint.started`, `human.review_needed` |
| 2 | **BA** | `sprint.started` | `story.ready` ×N |
| 3 | **Architect** | `story.ready` (batched) | `contract.ready` |
| 4 | **Frontend Dev** | `contract.ready`, `review.changes_requested` | `pr.opened` |
| 5 | **Backend Dev** | `contract.ready`, `review.changes_requested` | `pr.opened` |
| 6 | **Code Reviewer** | `pr.opened`, `review.changes_requested` | `review.approved`, `review.changes_requested` |
| 7 | **QA** | `review.approved` | `test.passed`, `test.failed` |
| 8 | **Security** | `review.approved` | `vuln.found` |
| 9 | **DevOps** | `sprint.started`, `test.passed` | `deploy.succeeded`, `deploy.failed` |

---

## Parallel Execution Model

```
PM emits sprint.started
        │
        ├──▶ BA generates stories ──▶ story.ready ──▶ Architect designs API contracts
        │                                                       │
        │                                               contract.ready
        │                                            ┌────────┴────────┐
        │                                            ▼                 ▼
        └──▶ DevOps provisions infra         Frontend Dev        Backend Dev
                                              (parallel)          (parallel)
                                                  │                   │
                                              pr.opened           pr.opened
                                                  └────────┬──────────┘
                                                           ▼
                                                    Code Reviewer
                                                           │
                                                    review.approved
                                                  ┌────────┴────────┐
                                                  ▼                 ▼
                                               QA Agent       Security Agent
                                               (parallel)      (parallel)
                                                  │                 │
                                             test.passed      (clear/vuln.found)
                                                  │
                                              DevOps deploys to staging
```

---

## Feedback Loop Protocol

| Event | Producer | Consumer | Action |
|-------|----------|----------|--------|
| `sprint.started` | PM | BA, DevOps | Generate stories; provision infra |
| `story.ready` | BA | Architect | Design API contracts (batched) |
| `contract.ready` | Architect | Frontend Dev, Backend Dev | Implement in parallel |
| `pr.opened` | Dev agent | Code Reviewer | Review the PR |
| `review.changes_requested` | Code Reviewer | Dev agent | Fix and re-submit |
| `review.approved` | Code Reviewer | QA, Security | Test and scan in parallel |
| `test.failed` | QA | Dev agent | Bug auto-assigned back to author |
| `vuln.found` | Security | Dev agent + PM | Patch ticket; sprint re-evaluated |
| `test.passed` | QA | DevOps | Deploy to staging |
| `deploy.failed` | DevOps | PM | Escalate blocker |
| `deploy.succeeded` | DevOps | PM | Milestone logged |
| `blocker.raised` | Any agent | PM | Re-evaluate sprint plan |

---

## E-Commerce App Scope

**Core Features**
- Product catalog with search, filters, and categories
- Product detail pages with image gallery and reviews
- Shopping cart and guest/auth checkout flow
- Payment integration (Stripe)
- Order management and history
- Admin dashboard — inventory, orders, analytics

**Tech Stack** *(proposed by Architect agent at runtime)*
- **Frontend**: Next.js 15, TypeScript, Tailwind CSS, Zustand, React Query
- **Backend**: Node.js / Fastify, REST API, Prisma ORM
- **Database**: PostgreSQL (primary), Redis (sessions/cache)
- **Auth**: JWT, bcrypt
- **Infra**: Docker, GitHub Actions CI/CD, Vercel (frontend), Railway (backend)
- **Testing**: Vitest, Playwright (E2E), Supertest (API)

---

## Project Structure

```
.
├── agents/
│   ├── index.ts              ← entry point: boots all agents, PM kicks off sprint
│   ├── shared/
│   │   ├── types.ts          ← AgentRole, EventType, Story, ApiContract, PR, etc.
│   │   ├── event-bus.ts      ← Redis pub/sub wrapper (typed emit + subscribe)
│   │   ├── context-store.ts  ← shared JSON state + artifact writer
│   │   └── base-agent.ts     ← abstract class: callLLM, callLLMJson, emit, start
│   ├── pm/                   ← Project Manager
│   ├── ba/                   ← Business Analyst
│   ├── architect/            ← Architect
│   ├── frontend-dev/         ← Frontend Developer
│   ├── backend-dev/          ← Backend Developer
│   ├── qa/                   ← QA Engineer
│   ├── code-reviewer/        ← Code Reviewer
│   ├── security/             ← Security Analyst
│   └── devops/               ← DevOps / SRE
├── workspace/                ← all agent output (created at runtime)
│   ├── context.json          ← live shared state: stories, contracts, PRs, etc.
│   └── artifacts/
│       ├── stories/          ← BA writes user-stories.json
│       ├── architecture/     ← Architect writes system-design.md, api-contracts.json
│       ├── frontend/         ← Frontend Dev writes Next.js source files
│       ├── backend/          ← Backend Dev writes Fastify source files
│       ├── tests/            ← QA writes test suites
│       ├── reports/          ← QA and Security write scan reports
│       └── infra/            ← DevOps writes Dockerfiles, CI/CD workflows
├── Dockerfile.agents         ← Docker image for the agent team
├── docker-compose.yml        ← Redis + Postgres + agents
└── package.json
```

---

## Run It

```bash
# 1. Add your Anthropic API key
cp .env.example .env

# 2. Start everything (Redis + Postgres + all 9 agents)
docker compose up

# 3. In another terminal — stream live logs
npm run logs

# 4. Copy all generated artifacts to your host after agents finish
npm run artifacts

# 5. Tear down everything cleanly
docker compose down -v
```

---

## Key Design Principles

1. **Parallelism by default** — agents only block when they have a hard dependency (e.g., Frontend Dev waits for API contracts, not for backend to finish).
2. **Event-driven, not polling** — no agent checks a queue; Redis pub/sub delivers events immediately.
3. **Broadcast semantics** — multiple agents can react to the same event simultaneously (QA + Security both fire on `review.approved`).
4. **Shared ground truth** — all agents read/write to one `ContextStore`; no private silos.
5. **Self-healing loops** — QA bugs and Security vulns automatically re-trigger the responsible dev agent without PM intervention.
6. **Prompt caching** — each agent's system prompt is cached at the Anthropic layer, reducing cost on high-volume event bursts.

---

## Status

> **Stage**: Running — Sprint 1 in progress
> **Agents**: 9 online
> **Infrastructure**: Docker (Redis + Postgres + agents container)

---

*Built on [Claude Code](https://claude.ai/code) — multi-agent orchestration powered by the Anthropic SDK.*
