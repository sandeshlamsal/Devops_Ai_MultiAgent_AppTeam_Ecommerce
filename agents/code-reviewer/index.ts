import { BaseAgent } from '../shared/base-agent'
import { EventBus } from '../shared/event-bus'
import { ContextStore } from '../shared/context-store'
import { AgentEvent, EventType } from '../shared/types'

const SYSTEM_PROMPT = `You are a Senior Code Reviewer at a software company.

Your responsibilities:
- Review pull requests for correctness, security, performance, and maintainability
- Check that the implementation matches the API contracts and acceptance criteria
- Enforce TypeScript best practices, proper error handling, and no obvious security issues
- Provide clear, actionable feedback as numbered bullet points
- Approve or request changes — never leave ambiguous verdicts

Review criteria:
1. Does the code match the contract/story it claims to implement?
2. Are there TypeScript type errors or unsafe casts?
3. Are there SQL injection, XSS, or auth bypass risks?
4. Is error handling correct (no swallowed errors, proper HTTP status codes)?
5. Is the code readable and following the project conventions?

Output format: JSON with shape { approved: boolean, comments: string[], summary: string }`

export class CodeReviewerAgent extends BaseAgent {
  constructor(bus: EventBus, store: ContextStore) {
    super('code-reviewer', SYSTEM_PROMPT, bus, store)
  }

  protected subscribedEvents(): EventType[] {
    return ['pr.opened', 'review.changes_requested']
  }

  protected async handleEvent(event: AgentEvent): Promise<void> {
    if (event.type === 'pr.opened' || event.type === 'review.changes_requested') {
      await this.reviewPR(event.payload.prId as string)
    }
  }

  private async reviewPR(prId: string): Promise<void> {
    const pr = this.store.getPullRequests().find(p => p.id === prId)
    if (!pr) {
      this.store.log('code-reviewer', `PR ${prId} not found — skipping review`)
      return
    }

    const story = this.store.getStories().find(s => s.id === pr.storyId)
    const contracts = this.store.getContracts()

    this.store.log('code-reviewer', `Reviewing PR ${prId}: "${pr.title}"`)

    const result = await this.callLLMJson<{ approved: boolean; comments: string[]; summary: string }>(
      `Review this pull request against the story acceptance criteria and API contracts.

PR Title: ${pr.title}
Story: ${JSON.stringify(story, null, 2)}

Relevant API Contracts:
${JSON.stringify(contracts.slice(0, 5), null, 2)}

Files changed:
${pr.files.map(f => `--- ${f.path} ---\n${f.content.slice(0, 1500)}`).join('\n\n')}`,
    )

    this.store.updatePullRequest(prId, {
      reviewComments: result.comments,
      status: result.approved ? 'approved' : 'changes-requested',
    })

    this.store.log('code-reviewer', `PR ${prId} — ${result.approved ? '✅ APPROVED' : '🔄 CHANGES REQUESTED'}: ${result.summary}`)

    if (result.approved) {
      this.store.updatePullRequest(prId, { status: 'merged' })
      await this.emit('review.approved', { prId, storyId: pr.storyId, agent: pr.agent })
    } else {
      await this.emit('review.changes_requested', { prId, storyId: pr.storyId, agent: pr.agent, comments: result.comments })
    }
  }
}
