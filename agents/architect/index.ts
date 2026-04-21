import { BaseAgent } from '../shared/base-agent'
import { EventBus } from '../shared/event-bus'
import { ContextStore } from '../shared/context-store'
import { AgentEvent, EventType, ApiContract } from '../shared/types'
import { z } from 'zod'

const SYSTEM_PROMPT = `You are a Senior Software Architect at a software company.

Your responsibilities:
- Design scalable system architectures and define API contracts
- Produce OpenAPI-style contract definitions (endpoint, method, request/response schemas)
- Define database models and ERDs
- Set coding standards and technology decisions
- Ensure frontend and backend agents are aligned on interfaces before coding begins

When generating API contracts, output a JSON array. Each contract has:
id, endpoint, method, description, requestSchema (JSON Schema object), responseSchema (JSON Schema object), auth (boolean).

Tech stack in use: Next.js 15, Fastify, PostgreSQL, Redis, Prisma ORM, Stripe, JWT.`

const contractArraySchema = z.array(
  z.object({
    id: z.string(),
    endpoint: z.string(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    description: z.string(),
    requestSchema: z.record(z.unknown()),
    responseSchema: z.record(z.unknown()),
    auth: z.boolean(),
  }),
)

export class ArchitectAgent extends BaseAgent {
  private storyBuffer: string[] = []
  private designTriggered = false

  constructor(bus: EventBus, store: ContextStore) {
    super('architect', SYSTEM_PROMPT, bus, store)
  }

  protected subscribedEvents(): EventType[] {
    return ['story.ready']
  }

  protected async handleEvent(event: AgentEvent): Promise<void> {
    if (event.type === 'story.ready') {
      this.storyBuffer.push(event.payload.epic as string)

      // Batch: trigger after collecting stories from 3+ epics, only once
      if (this.storyBuffer.length >= 3 && !this.designTriggered) {
        this.designTriggered = true
        await this.designSystem()
      }
    }
  }

  private async designSystem(): Promise<void> {
    this.store.log('architect', 'Designing system architecture and API contracts...')

    const stories = this.store.getStories()
    const brief = this.store.getProductBrief()

    // Generate system design document
    const design = await this.callLLM(
      `Based on these user stories and product brief, produce a concise system design document covering:
1. High-level architecture diagram (text-based)
2. Database schema (main tables and key relationships)
3. Authentication strategy
4. Key technology decisions with rationale

User Stories (sample):
${JSON.stringify(stories.slice(0, 8), null, 2)}

Product Brief: ${brief.slice(0, 500)}`,
    )

    this.store.writeArtifact('architecture/system-design.md', design)
    this.store.log('architect', 'System design document written to workspace/artifacts/architecture/system-design.md')

    // Generate API contracts
    const contracts = await this.callLLMJson<ApiContract[]>(
      `Based on the following user stories, generate a complete REST API contract set covering:
auth (register, login, logout, profile), products (CRUD, search, filters), cart (add, update, remove, get),
orders (create, list, get), reviews (create, list), admin (dashboard stats, inventory, order management).

Generate at least 20 endpoints. Use IDs like "API-001".

User Stories:
${JSON.stringify(stories, null, 2)}`,
    )

    const parsed = contractArraySchema.parse(contracts)
    for (const contract of parsed) {
      this.store.addContract(contract)
    }

    this.store.writeArtifact('architecture/api-contracts.json', JSON.stringify(parsed, null, 2))
    this.store.log('architect', `Defined ${parsed.length} API contracts — emitting contract.ready`)

    await this.emit('contract.ready', { contractCount: parsed.length })
  }
}
