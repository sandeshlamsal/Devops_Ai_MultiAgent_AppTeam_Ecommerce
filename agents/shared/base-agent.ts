import Anthropic from '@anthropic-ai/sdk'
import { EventBus } from './event-bus'
import { ContextStore } from './context-store'
import { AgentRole, EventType, AgentEvent } from './types'

export abstract class BaseAgent {
  protected client: Anthropic
  protected role: AgentRole
  protected systemPrompt: string

  constructor(
    role: AgentRole,
    systemPrompt: string,
    protected bus: EventBus,
    protected store: ContextStore,
  ) {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    this.role = role
    this.systemPrompt = systemPrompt
  }

  start(): void {
    for (const type of this.subscribedEvents()) {
      this.bus.on(type, async (event) => {
        try {
          await this.handleEvent(event)
        } catch (err) {
          const msg = String(err)
          console.error(`\x1b[31m[${this.role}] Error in handleEvent(${event.type}):\x1b[0m`, msg)

          // Credit errors are fatal — stop the whole process with a clear message
          if (msg.includes('credit balance is too low')) {
            console.error('\x1b[31m\n⛔  FATAL: Anthropic API credit balance is too low.')
            console.error('   Add credits at: https://console.anthropic.com/settings/billing\n\x1b[0m')
            process.exit(1)
          }

          // Don't escalate from the PM's own blocker handler — it would loop forever
          if (this.role !== 'pm' && event.type !== 'blocker.raised') {
            await this.emit('blocker.raised', { agent: this.role, event: event.type, error: msg })
          }
        }
      })
    }
    this.store.log(this.role, 'Agent started — subscribed to: ' + this.subscribedEvents().join(', '))
  }

  protected abstract subscribedEvents(): EventType[]
  protected abstract handleEvent(event: AgentEvent): Promise<void>

  protected async callLLM(userMessage: string, extraContext?: string): Promise<string> {
    const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
      {
        type: 'text',
        text: this.systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ]

    if (extraContext) {
      systemBlocks.push({ type: 'text', text: extraContext })
    }

    console.log(`\x1b[90m[${this.role}] → Anthropic API call (max_tokens=8096)...\x1b[0m`)

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[${this.role}] API call timed out after 120s`)), 120_000),
    )

    const apiCall = this.client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 8096,
      system: systemBlocks,
      messages: [{ role: 'user', content: userMessage }],
    })

    const response = await Promise.race([apiCall, timeout])

    console.log(`\x1b[90m[${this.role}] ← API response received (${response.usage?.output_tokens ?? '?'} output tokens)\x1b[0m`)

    const block = response.content[0]
    if (block.type !== 'text') throw new Error(`Unexpected content type: ${block.type}`)
    return block.text
  }

  protected async callLLMJson<T>(userMessage: string, extraContext?: string): Promise<T> {
    const raw = await this.callLLM(
      userMessage + '\n\nRespond with valid JSON only. No markdown fences, no explanation outside the JSON.',
      extraContext,
    )
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    return JSON.parse(cleaned) as T
  }

  protected emit(type: EventType, payload: Record<string, unknown> = {}): Promise<void> {
    return this.bus.emit(type, this.role, payload)
  }
}
