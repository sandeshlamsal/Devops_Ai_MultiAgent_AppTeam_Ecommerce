import { execFile } from 'child_process'
import { promisify } from 'util'
import { EventBus } from './event-bus'
import { ContextStore } from './context-store'
import { AgentRole, EventType, AgentEvent } from './types'

const execFileAsync = promisify(execFile)

export abstract class BaseAgent {
  protected role: AgentRole
  protected systemPrompt: string

  constructor(
    role: AgentRole,
    systemPrompt: string,
    protected bus: EventBus,
    protected store: ContextStore,
  ) {
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

          if (msg.includes('claude: not found') || msg.includes('ENOENT')) {
            console.error('\x1b[31m\n⛔  FATAL: claude CLI not found.')
            console.error('   Make sure @anthropic-ai/claude-code is installed and you are authenticated.\n\x1b[0m')
            process.exit(1)
          }

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
    // Compose the full prompt: system instructions + optional context + user message
    const parts: string[] = [
      `<system_instructions>\n${this.systemPrompt}\n</system_instructions>`,
    ]
    if (extraContext) {
      parts.push(`<context>\n${extraContext}\n</context>`)
    }
    parts.push(userMessage)
    const fullPrompt = parts.join('\n\n')

    console.log(`\x1b[90m[${this.role}] → claude CLI (non-interactive)...\x1b[0m`)

    const { stdout, stderr } = await execFileAsync(
      'claude',
      ['--print', fullPrompt, '--output-format', 'text'],
      { timeout: 120_000 },
    ).catch((err: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => {
      throw new Error(`claude CLI error: ${err.stderr ?? err.message}`)
    })

    if (stderr) {
      console.warn(`\x1b[33m[${this.role}] claude stderr: ${stderr}\x1b[0m`)
    }

    console.log(`\x1b[90m[${this.role}] ← response received (${stdout.length} chars)\x1b[0m`)
    return stdout.trim()
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
