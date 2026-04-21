export type AgentRole =
  | 'pm'
  | 'ba'
  | 'architect'
  | 'frontend-dev'
  | 'backend-dev'
  | 'qa'
  | 'code-reviewer'
  | 'security'
  | 'devops'

export type EventType =
  | 'sprint.started'
  | 'story.ready'
  | 'contract.ready'
  | 'pr.opened'
  | 'review.approved'
  | 'review.changes_requested'
  | 'test.passed'
  | 'test.failed'
  | 'vuln.found'
  | 'deploy.succeeded'
  | 'deploy.failed'
  | 'blocker.raised'
  | 'human.review_needed'

export interface AgentEvent {
  id: string
  type: EventType
  from: AgentRole
  payload: Record<string, unknown>
  timestamp: string
}

export interface Story {
  id: string
  epic: string
  title: string
  description: string
  acceptanceCriteria: string[]
  status: 'pending' | 'in-progress' | 'review' | 'done'
}

export interface ApiContract {
  id: string
  endpoint: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  description: string
  requestSchema: Record<string, unknown>
  responseSchema: Record<string, unknown>
  auth: boolean
}

export interface PullRequest {
  id: string
  agent: AgentRole
  title: string
  storyId: string
  files: Array<{ path: string; content: string }>
  reviewComments: string[]
  status: 'open' | 'changes-requested' | 'approved' | 'merged'
}

export interface VulnerabilityReport {
  id: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  file: string
  line?: number
  recommendation: string
}

export interface DeploymentRecord {
  id: string
  environment: 'staging' | 'production'
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  timestamp: string
  logs: string[]
}

export interface ContextData {
  productBrief: string
  stories: Story[]
  contracts: ApiContract[]
  pullRequests: PullRequest[]
  vulnerabilities: VulnerabilityReport[]
  deployments: DeploymentRecord[]
  sprintLog: string[]
}
