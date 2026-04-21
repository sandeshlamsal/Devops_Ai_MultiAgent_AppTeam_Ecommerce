import { BaseAgent } from '../shared/base-agent'
import { EventBus } from '../shared/event-bus'
import { ContextStore } from '../shared/context-store'
import { AgentEvent, EventType, PullRequest } from '../shared/types'

const SYSTEM_PROMPT = `You are a Senior Backend Developer specializing in Node.js and Fastify.

Your responsibilities:
- Build robust REST APIs that implement the API contracts exactly as specified
- Write TypeScript with strict typing
- Use Fastify for the HTTP layer, Prisma ORM for database access, Zod for input validation
- Implement proper error handling: correct HTTP status codes, structured error responses
- Use Redis for session management and caching where appropriate
- Follow security best practices: parameterized queries, input sanitization, auth middleware
- Never expose internal errors or stack traces to API consumers

Tech stack: Node.js 20, Fastify 5, TypeScript, Prisma, PostgreSQL, Redis (ioredis), Zod, Stripe SDK, JWT (jsonwebtoken).

When implementing a contract, output a JSON array of files: [{ path: string, content: string }].
Use src/ directory structure. Produce real, production-quality code.`

export class BackendDevAgent extends BaseAgent {
  constructor(bus: EventBus, store: ContextStore) {
    super('backend-dev', SYSTEM_PROMPT, bus, store)
  }

  protected subscribedEvents(): EventType[] {
    return ['contract.ready', 'review.changes_requested']
  }

  protected async handleEvent(event: AgentEvent): Promise<void> {
    if (event.type === 'contract.ready') {
      await this.implementBackendContracts()
    } else if (event.type === 'review.changes_requested' && event.payload.agent === 'backend-dev') {
      await this.addressReviewFeedback(event.payload.prId as string)
    }
  }

  private async implementBackendContracts(): Promise<void> {
    const contracts = this.store.getContracts()
    const stories = this.store.getStories()

    this.store.log('backend-dev', `Implementing API from ${contracts.length} contracts`)

    // Group contracts by domain and implement in batches
    const domains = ['auth', 'products', 'cart', 'orders']
    for (const domain of domains) {
      const domainContracts = contracts.filter(c =>
        c.endpoint.toLowerCase().includes(domain),
      )
      if (domainContracts.length === 0) continue

      await this.implementDomain(domain, domainContracts, stories)
    }
  }

  private async implementDomain(domain: string, contracts: unknown[], stories: unknown[]): Promise<void> {
    this.store.log('backend-dev', `Implementing ${domain} domain (${(contracts as unknown[]).length} endpoints)`)

    const files = await this.callLLMJson<Array<{ path: string; content: string }>>(
      `Implement the ${domain} domain of the API.

API Contracts to implement:
${JSON.stringify(contracts, null, 2)}

Relevant user stories for context:
${JSON.stringify(
  (stories as Array<{ epic: string }>).filter(s =>
    s.epic.toLowerCase().includes(domain),
  ).slice(0, 3),
  null,
  2,
)}

Generate all necessary files:
- Route handler file (src/routes/${domain}.ts)
- Service/business logic file (src/services/${domain}.ts)
- Prisma schema additions for this domain (src/prisma/schema-${domain}.prisma — just the model definitions)
- Input validation schemas (src/schemas/${domain}.ts using Zod)

Return JSON array: [{ "path": "...", "content": "..." }]`,
    )

    const prId = crypto.randomUUID()
    const story = (stories as Array<{ epic: string; id: string }>).find(s =>
      s.epic.toLowerCase().includes(domain),
    )

    const pr: PullRequest = {
      id: prId,
      agent: 'backend-dev',
      title: `[Backend] ${domain} API implementation`,
      storyId: story?.id ?? `${domain}-story`,
      files,
      reviewComments: [],
      status: 'open',
    }

    this.store.addPullRequest(pr)
    for (const file of files) {
      this.store.writeArtifact(`backend/${file.path}`, file.content)
    }

    this.store.log('backend-dev', `PR opened for ${domain} domain — ${files.length} files`)
    await this.emit('pr.opened', { prId, storyId: pr.storyId, agent: 'backend-dev' })
  }

  private async addressReviewFeedback(prId: string): Promise<void> {
    const pr = this.store.getPullRequests().find(p => p.id === prId)
    if (!pr || pr.agent !== 'backend-dev') return

    this.store.log('backend-dev', `Addressing review feedback on PR ${prId}`)

    const updatedFiles = await this.callLLMJson<Array<{ path: string; content: string }>>(
      `Address these code review comments and update the files.

Review comments:
${pr.reviewComments.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Original files:
${pr.files.map(f => `--- ${f.path} ---\n${f.content.slice(0, 1200)}`).join('\n\n')}

Return updated files as JSON array: [{ "path": "...", "content": "..." }]`,
    )

    this.store.updatePullRequest(prId, { files: updatedFiles, status: 'open' })
    for (const file of updatedFiles) {
      this.store.writeArtifact(`backend/${file.path}`, file.content)
    }

    this.store.log('backend-dev', `PR ${prId} updated — re-submitting for review`)
    await this.emit('pr.opened', { prId, storyId: pr.storyId, agent: 'backend-dev' })
  }
}
