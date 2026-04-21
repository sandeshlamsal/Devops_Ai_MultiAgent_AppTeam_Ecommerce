import { BaseAgent } from '../shared/base-agent'
import { EventBus } from '../shared/event-bus'
import { ContextStore } from '../shared/context-store'
import { AgentEvent, EventType, VulnerabilityReport } from '../shared/types'

const SYSTEM_PROMPT = `You are a Senior Security Engineer at a software company.

Your responsibilities:
- Review all merged code for security vulnerabilities before deployment
- Check for OWASP Top 10 issues: injection, broken auth, XSS, IDOR, misconfiguration, etc.
- Review infrastructure and CI/CD configs for secrets exposure or privilege escalation
- Provide clear vulnerability reports with severity ratings and remediation steps
- Block deployments when critical or high vulnerabilities are found

When reviewing code, output JSON:
{ clear: boolean, vulnerabilities: Array<{ id, severity, description, file, line, recommendation }> }

Severity levels: "critical" (block deploy), "high" (block deploy), "medium" (fix in next sprint), "low" (informational).`

export class SecurityAgent extends BaseAgent {
  constructor(bus: EventBus, store: ContextStore) {
    super('security', SYSTEM_PROMPT, bus, store)
  }

  protected subscribedEvents(): EventType[] {
    return ['review.approved']
  }

  protected async handleEvent(event: AgentEvent): Promise<void> {
    if (event.type === 'review.approved') {
      await this.scanPR(event.payload.prId as string)
    }
  }

  private async scanPR(prId: string): Promise<void> {
    const pr = this.store.getPullRequests().find(p => p.id === prId)
    if (!pr) return

    this.store.log('security', `Running security scan on PR ${prId}: "${pr.title}"`)

    const result = await this.callLLMJson<{
      clear: boolean
      vulnerabilities: VulnerabilityReport[]
    }>(
      `Perform a security review of this code.

PR: ${pr.title}
Files:
${pr.files.map(f => `--- ${f.path} ---\n${f.content.slice(0, 2000)}`).join('\n\n')}

Check for:
- SQL injection / NoSQL injection
- Authentication and authorization issues (missing auth middleware, IDOR)
- XSS vulnerabilities in rendered output
- Secrets or API keys hardcoded in source
- Insecure direct object references
- Missing input validation
- Unsafe dependencies usage
- CORS misconfiguration
- Information disclosure in error messages

Be thorough. Generate vulnerability IDs like "VULN-001".`,
    )

    this.store.writeArtifact(
      `reports/security-scan-${prId}.json`,
      JSON.stringify({ prId, ...result }, null, 2),
    )

    const blockers = result.vulnerabilities.filter(
      v => v.severity === 'critical' || v.severity === 'high',
    )

    for (const v of result.vulnerabilities) {
      this.store.addVulnerability(v)
    }

    if (blockers.length > 0) {
      this.store.log(
        'security',
        `🚨 ${blockers.length} critical/high vuln(s) found in PR ${prId} — blocking deployment`,
      )
      await this.emit('vuln.found', {
        prId,
        storyId: pr.storyId,
        agent: pr.agent,
        vulnerabilities: blockers,
      })
    } else {
      this.store.log(
        'security',
        `✅ Security scan clear for PR ${prId}${result.vulnerabilities.length > 0 ? ` (${result.vulnerabilities.length} low/medium findings noted)` : ''}`,
      )
    }
  }
}
