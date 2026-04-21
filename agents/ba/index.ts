import { BaseAgent } from '../shared/base-agent'
import { EventBus } from '../shared/event-bus'
import { ContextStore } from '../shared/context-store'
import { AgentEvent, EventType, Story } from '../shared/types'
import { z } from 'zod'

const SYSTEM_PROMPT = `You are a Senior Business Analyst at a software company.

Your responsibilities:
- Analyze product briefs and decompose them into epics and user stories
- Write clear, testable acceptance criteria for every story
- Ensure stories are small enough to be completed in 1–3 days of development
- Communicate with developers to clarify requirements on demand

Output format: When generating stories, always produce a JSON array of Story objects.
Each Story has: id (string), epic (string), title (string), description (string), acceptanceCriteria (string[]), status ("pending").`

const storyArraySchema = z.array(
  z.object({
    id: z.string(),
    epic: z.string(),
    title: z.string(),
    description: z.string(),
    acceptanceCriteria: z.array(z.string()),
    status: z.enum(['pending', 'in-progress', 'review', 'done']),
  }),
)

export class BAAgent extends BaseAgent {
  constructor(bus: EventBus, store: ContextStore) {
    super('ba', SYSTEM_PROMPT, bus, store)
  }

  protected subscribedEvents(): EventType[] {
    return ['sprint.started']
  }

  protected async handleEvent(event: AgentEvent): Promise<void> {
    if (event.type === 'sprint.started') {
      await this.generateStories(event.payload.brief as string)
    }
  }

  private async generateStories(brief: string): Promise<void> {
    this.store.log('ba', 'Analyzing product brief — generating epics and user stories...')

    const raw = await this.callLLMJson<Story[]>(
      `Given this product brief, generate a comprehensive set of user stories covering all MVP features.
Group them by epic. Generate at least 15 stories covering: auth, product catalog, cart, checkout, orders, admin.
Use story IDs like "US-001", "US-002", etc.

Product Brief:
${brief}`,
    )

    const stories = storyArraySchema.parse(raw)

    for (const story of stories) {
      this.store.addStory(story)
    }

    this.store.log('ba', `Generated ${stories.length} user stories across ${new Set(stories.map(s => s.epic)).size} epics`)
    this.store.writeArtifact('stories/user-stories.json', JSON.stringify(stories, null, 2))

    for (const story of stories) {
      await this.emit('story.ready', { storyId: story.id, epic: story.epic, title: story.title })
    }
  }
}
