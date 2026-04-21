import { randomUUID } from 'node:crypto'
import { BaseAgent } from '../shared/base-agent'
import { EventBus } from '../shared/event-bus'
import { ContextStore } from '../shared/context-store'
import { AgentEvent, EventType, DeploymentRecord } from '../shared/types'

const SYSTEM_PROMPT = `You are a Senior DevOps / SRE Engineer at a software company.

Your responsibilities:
- Provision infrastructure and configure CI/CD pipelines
- Deploy applications to staging and production environments
- Monitor deployments and respond to failures with rollback procedures
- Write Dockerfiles, Docker Compose configs, GitHub Actions workflows
- Configure environment variables, secrets management, and health checks
- Ensure zero-downtime deployments

Stack: Docker, Docker Compose, GitHub Actions, Vercel (frontend), Railway (backend), PostgreSQL, Redis.

When generating deployment configs, output JSON array: [{ path: string, content: string }].
When evaluating deployment readiness, output: { ready: boolean, issues: string[], environment: "staging"|"production" }.`

export class DevOpsAgent extends BaseAgent {
  private infraProvisioned = false

  constructor(bus: EventBus, store: ContextStore) {
    super('devops', SYSTEM_PROMPT, bus, store)
  }

  protected subscribedEvents(): EventType[] {
    return ['sprint.started', 'test.passed']
  }

  protected async handleEvent(event: AgentEvent): Promise<void> {
    if (event.type === 'sprint.started' && !this.infraProvisioned) {
      await this.provisionInfrastructure()
    } else if (event.type === 'test.passed') {
      await this.deployToStaging(event.payload.prId as string)
    }
  }

  private async provisionInfrastructure(): Promise<void> {
    this.infraProvisioned = true
    this.store.log('devops', 'Provisioning infrastructure and CI/CD pipeline...')

    const brief = this.store.getProductBrief()

    const configs = await this.callLLMJson<Array<{ path: string; content: string }>>(
      `Generate complete infrastructure configuration for this e-commerce application.

Product Brief: ${brief.slice(0, 400)}

Generate:
1. Dockerfile for the Next.js frontend (multi-stage, production-optimized)
2. Dockerfile for the Fastify backend (multi-stage)
3. docker-compose.override.yml for local development with hot reload
4. .github/workflows/ci.yml — run lint, typecheck, tests on PR
5. .github/workflows/deploy-staging.yml — deploy to staging on merge to main
6. .env.staging.example — all required environment variables for staging

Return JSON array: [{ "path": "...", "content": "..." }]`,
    )

    for (const file of configs) {
      this.store.writeArtifact(`infra/${file.path}`, file.content)
    }

    this.store.log('devops', `Infrastructure configs generated — ${configs.length} files written`)
  }

  private async deployToStaging(prId: string): Promise<void> {
    const pr = this.store.getPullRequests().find(p => p.id === prId)
    if (!pr) return

    const deploymentId = randomUUID()
    const deployment: DeploymentRecord = {
      id: deploymentId,
      environment: 'staging',
      status: 'running',
      timestamp: new Date().toISOString(),
      logs: [],
    }

    this.store.addDeployment(deployment)
    this.store.log('devops', `Deploying PR ${prId} to staging (deployment ${deploymentId})`)

    const result = await this.callLLMJson<{ success: boolean; logs: string[]; issues: string[] }>(
      `Simulate a staging deployment for this PR and report the result.

PR: ${pr.title}
Files being deployed:
${pr.files.map(f => f.path).join('\n')}

Consider: database migrations, environment variable requirements, health check endpoints, startup order.
Be realistic — occasionally surface a minor issue that would be caught in staging.

Return: { "success": boolean, "logs": string[], "issues": string[] }`,
    )

    this.store.updateDeployment(deploymentId, {
      status: result.success ? 'succeeded' : 'failed',
      logs: result.logs,
    })

    if (result.success) {
      this.store.log('devops', `✅ Staging deployment ${deploymentId} succeeded`)
      await this.emit('deploy.succeeded', { deploymentId, prId, environment: 'staging' })
    } else {
      this.store.log('devops', `❌ Staging deployment ${deploymentId} failed: ${result.issues.join(', ')}`)
      await this.emit('deploy.failed', { deploymentId, prId, environment: 'staging', issues: result.issues })
    }
  }
}
