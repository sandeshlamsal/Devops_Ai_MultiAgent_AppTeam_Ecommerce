import { BaseAgent } from '../shared/base-agent'
import { EventBus } from '../shared/event-bus'
import { ContextStore } from '../shared/context-store'
import { AgentEvent, EventType } from '../shared/types'

const SYSTEM_PROMPT = `You are the Project Manager of an AI-powered software team building an e-commerce web application.

Your responsibilities:
- Maintain the sprint board and overall project roadmap
- Coordinate all other agents (BA, Architect, Frontend Dev, Backend Dev, QA, Code Reviewer, Security, DevOps)
- Resolve blockers and re-prioritize when problems arise
- Ensure the team delivers working software incrementally

Communication style: direct, action-oriented, concise. Always reference specific story IDs or contract IDs when tracking work.`

const PRODUCT_BRIEF = `Build a full-stack e-commerce web application with the following features:

**Core Features (MVP):**
- Product catalog with search, filters by category / price / rating
- Product detail pages with image gallery, reviews, and star ratings
- Shopping cart with quantity management and persistent sessions (guest + auth)
- User authentication: register, login, JWT-based sessions, profile management
- Checkout flow with Stripe payment integration (test mode)
- Order management and history for authenticated users
- Admin dashboard: inventory management, order processing, basic sales analytics

**Non-functional requirements:**
- Mobile-responsive (Tailwind CSS)
- API-first: REST backend consumed by Next.js frontend
- PostgreSQL for persistence, Redis for sessions/cache
- Containerized with Docker; deployable to Vercel (frontend) + Railway (backend)
- 80%+ test coverage on business logic

**Target users:** Small/medium businesses selling physical products online.
**Tech stack:** Next.js 15, TypeScript, Tailwind CSS, Fastify, PostgreSQL, Redis, Prisma ORM, Stripe, Vitest, Playwright.`

export class PMAgent extends BaseAgent {
  constructor(bus: EventBus, store: ContextStore) {
    super('pm', SYSTEM_PROMPT, bus, store)
  }

  protected subscribedEvents(): EventType[] {
    return ['blocker.raised', 'deploy.succeeded', 'deploy.failed', 'human.review_needed']
  }

  protected async handleEvent(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case 'blocker.raised':
        await this.handleBlocker(event)
        break
      case 'deploy.succeeded':
        this.store.log('pm', `Deployment succeeded — sprint milestone reached. Notifying team.`)
        break
      case 'deploy.failed':
        this.store.log('pm', `Deployment failed — flagging for human review.`)
        await this.emit('human.review_needed', { reason: 'deploy.failed', context: event.payload })
        break
      case 'human.review_needed':
        this.store.log('pm', `⚠️  Human review needed: ${JSON.stringify(event.payload)}`)
        break
    }
  }

  private async handleBlocker(event: AgentEvent): Promise<void> {
    const context = `Current stories: ${JSON.stringify(this.store.getStories().slice(0, 5))}
Current blockers: ${JSON.stringify(event.payload)}`

    const resolution = await this.callLLM(
      `A blocker was raised by ${event.from}: ${JSON.stringify(event.payload)}.
      What is the resolution plan? Be brief and actionable (2-3 bullet points).`,
      context,
    )
    this.store.log('pm', `Blocker resolution: ${resolution}`)
  }

  async kickoff(): Promise<void> {
    this.store.setProductBrief(PRODUCT_BRIEF)
    this.store.log('pm', 'Sprint 1 kicked off — emitting sprint.started')
    await this.emit('sprint.started', { brief: PRODUCT_BRIEF, sprint: 1 })
  }
}
