import 'dotenv/config'
import { EventBus } from './shared/event-bus'
import { ContextStore } from './shared/context-store'
import { PMAgent } from './pm'
import { BAAgent } from './ba'
import { ArchitectAgent } from './architect'
import { FrontendDevAgent } from './frontend-dev'
import { BackendDevAgent } from './backend-dev'
import { QAAgent } from './qa'
import { CodeReviewerAgent } from './code-reviewer'
import { SecurityAgent } from './security'
import { DevOpsAgent } from './devops'

async function main() {
  console.log('\x1b[1m\x1b[35m')
  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║   AI Multi-Agent E-Commerce Team — Booting up...    ║')
  console.log('╚══════════════════════════════════════════════════════╝')
  console.log('\x1b[0m')

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌  ANTHROPIC_API_KEY is not set. Copy .env.example → .env and add your key.')
    process.exit(1)
  }

  // Shared infrastructure — one bus and one store for the whole team
  const bus = new EventBus()
  const store = new ContextStore()

  await bus.connect()
  console.log('✅  Event bus connected (Redis)')

  // Instantiate all agents
  const agents = [
    new PMAgent(bus, store),
    new BAAgent(bus, store),
    new ArchitectAgent(bus, store),
    new FrontendDevAgent(bus, store),
    new BackendDevAgent(bus, store),
    new QAAgent(bus, store),
    new CodeReviewerAgent(bus, store),
    new SecurityAgent(bus, store),
    new DevOpsAgent(bus, store),
  ]

  // Start all agents (subscribe to events) — they run concurrently
  for (const agent of agents) {
    agent.start()
  }

  console.log(`\n✅  ${agents.length} agents online — team is ready\n`)

  // PM kicks off Sprint 1
  const pm = agents[0] as PMAgent
  await pm.kickoff()

  // Keep the process alive — agents react to events asynchronously
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down agent team...')
    await bus.disconnect()
    process.exit(0)
  })
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
