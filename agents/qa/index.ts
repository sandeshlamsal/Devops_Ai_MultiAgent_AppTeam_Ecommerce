import { BaseAgent } from '../shared/base-agent'
import { EventBus } from '../shared/event-bus'
import { ContextStore } from '../shared/context-store'
import { AgentEvent, EventType } from '../shared/types'

const SYSTEM_PROMPT = `You are a Senior QA Engineer at a software company.

Your responsibilities:
- Write comprehensive test suites for every feature that lands in main
- Cover: unit tests (Vitest), integration tests (Supertest for API), and E2E tests (Playwright)
- Always test the happy path AND edge cases AND error conditions
- Ensure acceptance criteria from user stories are verified by at least one test
- Identify and report bugs with clear reproduction steps

When writing tests, output JSON array of test files: [{ path: string, content: string }].
After reviewing a PR, output: { passed: boolean, bugs: Array<{ title: string, steps: string[], expected: string, actual: string }>, coverage: string }.

Testing stack: Vitest, React Testing Library, Playwright, Supertest.`

export class QAAgent extends BaseAgent {
  constructor(bus: EventBus, store: ContextStore) {
    super('qa', SYSTEM_PROMPT, bus, store)
  }

  protected subscribedEvents(): EventType[] {
    return ['review.approved']
  }

  protected async handleEvent(event: AgentEvent): Promise<void> {
    if (event.type === 'review.approved') {
      await this.testMergedCode(event.payload.prId as string)
    }
  }

  private async testMergedCode(prId: string): Promise<void> {
    const pr = this.store.getPullRequests().find(p => p.id === prId)
    if (!pr) return

    const story = this.store.getStories().find(s => s.id === pr.storyId)
    this.store.log('qa', `Testing merged PR ${prId}: "${pr.title}"`)

    // Generate tests
    const testFiles = await this.callLLMJson<Array<{ path: string; content: string }>>(
      `Write a comprehensive test suite for this merged pull request.

PR: ${pr.title}
Story & Acceptance Criteria: ${JSON.stringify(story, null, 2)}

Files to test:
${pr.files.map(f => `--- ${f.path} ---\n${f.content.slice(0, 1500)}`).join('\n\n')}

Generate:
- Unit tests with Vitest for all business logic functions
- Integration tests with Supertest if this is a backend PR
- Playwright E2E test if this is a frontend PR
- Test every acceptance criterion with at least one test case

Return JSON array: [{ "path": "tests/...", "content": "..." }]`,
    )

    for (const file of testFiles) {
      this.store.writeArtifact(file.path, file.content)
    }

    // Evaluate test results (simulated — LLM acts as the test runner)
    const result = await this.callLLMJson<{
      passed: boolean
      bugs: Array<{ title: string; steps: string[]; expected: string; actual: string }>
      coverage: string
    }>(
      `Review the implementation against the acceptance criteria and simulate test results.
Be realistic — find at least one edge case to scrutinize.

Story: ${JSON.stringify(story, null, 2)}
Implementation:
${pr.files.map(f => `--- ${f.path} ---\n${f.content.slice(0, 1000)}`).join('\n\n')}`,
    )

    this.store.writeArtifact(
      `reports/qa-report-${prId}.json`,
      JSON.stringify({ prId, storyId: pr.storyId, ...result }, null, 2),
    )

    if (result.passed) {
      this.store.log('qa', `✅ Tests passed for PR ${prId} — coverage: ${result.coverage}`)
      await this.emit('test.passed', { prId, storyId: pr.storyId, coverage: result.coverage })
    } else {
      this.store.log('qa', `❌ ${result.bugs.length} bug(s) found in PR ${prId}`)
      await this.emit('test.failed', {
        prId,
        storyId: pr.storyId,
        agent: pr.agent,
        bugs: result.bugs,
      })
    }
  }
}
