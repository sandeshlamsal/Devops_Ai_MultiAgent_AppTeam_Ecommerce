import Redis from 'ioredis'
import { AgentEvent, AgentRole, EventType } from './types'

const CHANNEL = 'agent:events'

type Handler = (event: AgentEvent) => Promise<void>

export class EventBus {
  private pub: Redis
  private sub: Redis
  private handlers = new Map<EventType, Handler[]>()

  constructor() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379'
    this.pub = new Redis(url, { lazyConnect: true })
    this.sub = new Redis(url, { lazyConnect: true })
  }

  async connect(): Promise<void> {
    await this.pub.connect()
    await this.sub.connect()
    await this.sub.subscribe(CHANNEL)

    this.sub.on('message', async (_ch, raw) => {
      let event: AgentEvent
      try {
        event = JSON.parse(raw) as AgentEvent
      } catch {
        return
      }
      const list = this.handlers.get(event.type) ?? []
      const results = await Promise.allSettled(list.map(h => h(event)))
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error(`\x1b[31m[bus] Handler error for ${event.type} (from ${event.from}):\x1b[0m`, result.reason)
        }
      }
    })
  }

  on(type: EventType, handler: Handler): void {
    const list = this.handlers.get(type) ?? []
    this.handlers.set(type, [...list, handler])
  }

  async emit(type: EventType, from: AgentRole, payload: Record<string, unknown> = {}): Promise<void> {
    const event: AgentEvent = {
      id: crypto.randomUUID(),
      type,
      from,
      payload,
      timestamp: new Date().toISOString(),
    }
    await this.pub.publish(CHANNEL, JSON.stringify(event))
    console.log(`\x1b[36m[bus]\x1b[0m ${from} → \x1b[33m${type}\x1b[0m`)
  }

  async disconnect(): Promise<void> {
    await this.pub.quit()
    await this.sub.quit()
  }
}
