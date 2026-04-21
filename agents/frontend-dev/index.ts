import { randomUUID } from 'node:crypto'
import { BaseAgent } from '../shared/base-agent'
import { EventBus } from '../shared/event-bus'
import { ContextStore } from '../shared/context-store'
import { AgentEvent, EventType, PullRequest } from '../shared/types'

const SYSTEM_PROMPT = `You are a Senior Frontend Developer specializing in React and Next.js.

Your responsibilities:
- Build pixel-perfect, accessible UI components from user stories and API contracts
- Write TypeScript with strict typing — no "any" types
- Use Tailwind CSS for styling, Zustand for client state, React Query for server state
- Consume the REST API defined by the API contracts exactly as specified
- Write clean, modular components with separation of concerns
- Handle loading states, error states, and empty states

Tech stack: Next.js 15 (App Router), TypeScript, Tailwind CSS, Zustand, React Query, React Hook Form, Zod.

When implementing a story, output a JSON array of files: [{ path: string, content: string }].
Each file should be production-quality code, not pseudocode or placeholders.`

export class FrontendDevAgent extends BaseAgent {
  private pendingStories = new Set<string>()
  private contractsReady = false

  constructor(bus: EventBus, store: ContextStore) {
    super('frontend-dev', SYSTEM_PROMPT, bus, store)
  }

  protected subscribedEvents(): EventType[] {
    return ['contract.ready', 'review.changes_requested']
  }

  protected async handleEvent(event: AgentEvent): Promise<void> {
    if (event.type === 'contract.ready') {
      this.contractsReady = true
      await this.implementFrontendStories()
    } else if (event.type === 'review.changes_requested' && event.payload.agent === 'frontend-dev') {
      await this.addressReviewFeedback(event.payload.prId as string)
    }
  }

  private async implementFrontendStories(): Promise<void> {
    const stories = this.store.getStories().filter(s =>
      ['Product Catalog', 'Authentication', 'Shopping Cart', 'Checkout'].some(epic =>
        s.epic.toLowerCase().includes(epic.toLowerCase()),
      ),
    )

    const contracts = this.store.getContracts()

    this.store.log('frontend-dev', `Picking up ${stories.length} frontend stories`)

    for (const story of stories.slice(0, 3)) {
      await this.implementStory(story.id, contracts)
    }
  }

  private async implementStory(storyId: string, contracts: unknown[]): Promise<void> {
    const story = this.store.getStories().find(s => s.id === storyId)
    if (!story) return

    this.store.updateStory(storyId, { status: 'in-progress' })
    this.store.log('frontend-dev', `Implementing story ${storyId}: "${story.title}"`)

    const files = await this.callLLMJson<Array<{ path: string; content: string }>>(
      `Implement this user story as Next.js 15 App Router components.

Story: ${JSON.stringify(story, null, 2)}

Relevant API Contracts (use these endpoints — don't invent your own):
${JSON.stringify(
  contracts.filter((c: unknown) => {
    const contract = c as { endpoint: string }
    return (
      contract.endpoint.includes(story.epic.split(' ')[0].toLowerCase()) ||
      contract.endpoint.includes('auth') ||
      contract.endpoint.includes('product')
    )
  }).slice(0, 5),
  null,
  2,
)}

Generate all necessary files: page component, any sub-components, and a types file if needed.
Use src/app/ directory structure. Include realistic mock data where API isn't wired yet.
Return a JSON array: [{ "path": "src/app/...", "content": "..." }]`,
    )

    const prId = randomUUID()
    const pr: PullRequest = {
      id: prId,
      agent: 'frontend-dev',
      title: `[Frontend] ${story.title}`,
      storyId,
      files,
      reviewComments: [],
      status: 'open',
    }

    this.store.addPullRequest(pr)
    for (const file of files) {
      this.store.writeArtifact(file.path, file.content)
    }

    this.store.updateStory(storyId, { status: 'review' })
    this.store.log('frontend-dev', `PR opened for story ${storyId} — ${files.length} files`)
    await this.emit('pr.opened', { prId, storyId, agent: 'frontend-dev' })
  }

  private async addressReviewFeedback(prId: string): Promise<void> {
    const pr = this.store.getPullRequests().find(p => p.id === prId)
    if (!pr || pr.agent !== 'frontend-dev') return

    this.store.log('frontend-dev', `Addressing review feedback on PR ${prId}`)

    const updatedFiles = await this.callLLMJson<Array<{ path: string; content: string }>>(
      `Address these code review comments and produce updated files.

Review comments:
${pr.reviewComments.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Original files:
${pr.files.map(f => `--- ${f.path} ---\n${f.content.slice(0, 1000)}`).join('\n\n')}

Return updated files as JSON array: [{ "path": "...", "content": "..." }]`,
    )

    this.store.updatePullRequest(prId, { files: updatedFiles, status: 'open' })
    for (const file of updatedFiles) {
      this.store.writeArtifact(file.path, file.content)
    }

    this.store.log('frontend-dev', `PR ${prId} updated with review fixes — re-submitting`)
    await this.emit('pr.opened', { prId, storyId: pr.storyId, agent: 'frontend-dev' })
  }
}
