import fs from 'fs'
import path from 'path'
import { ContextData, Story, ApiContract, PullRequest, VulnerabilityReport, DeploymentRecord } from './types'

const STORE_PATH = path.join(process.cwd(), 'workspace', 'context.json')

const empty = (): ContextData => ({
  productBrief: '',
  stories: [],
  contracts: [],
  pullRequests: [],
  vulnerabilities: [],
  deployments: [],
  sprintLog: [],
})

export class ContextStore {
  private data: ContextData

  constructor() {
    this.data = this.load()
  }

  private load(): ContextData {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as ContextData
    }
    return empty()
  }

  private save(): void {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
    fs.writeFileSync(STORE_PATH, JSON.stringify(this.data, null, 2))
  }

  getProductBrief(): string { return this.data.productBrief }
  getStories(): Story[] { return this.data.stories }
  getContracts(): ApiContract[] { return this.data.contracts }
  getPullRequests(): PullRequest[] { return this.data.pullRequests }
  getVulnerabilities(): VulnerabilityReport[] { return this.data.vulnerabilities }
  getDeployments(): DeploymentRecord[] { return this.data.deployments }

  setProductBrief(brief: string): void {
    this.data.productBrief = brief
    this.save()
  }

  addStory(story: Story): void {
    this.data.stories.push(story)
    this.save()
  }

  updateStory(id: string, patch: Partial<Story>): void {
    const idx = this.data.stories.findIndex(s => s.id === id)
    if (idx !== -1) {
      this.data.stories[idx] = { ...this.data.stories[idx], ...patch }
      this.save()
    }
  }

  addContract(contract: ApiContract): void {
    this.data.contracts.push(contract)
    this.save()
  }

  addPullRequest(pr: PullRequest): void {
    this.data.pullRequests.push(pr)
    this.save()
  }

  updatePullRequest(id: string, patch: Partial<PullRequest>): void {
    const idx = this.data.pullRequests.findIndex(p => p.id === id)
    if (idx !== -1) {
      this.data.pullRequests[idx] = { ...this.data.pullRequests[idx], ...patch }
      this.save()
    }
  }

  addVulnerability(v: VulnerabilityReport): void {
    this.data.vulnerabilities.push(v)
    this.save()
  }

  addDeployment(d: DeploymentRecord): void {
    this.data.deployments.push(d)
    this.save()
  }

  updateDeployment(id: string, patch: Partial<DeploymentRecord>): void {
    const idx = this.data.deployments.findIndex(d => d.id === id)
    if (idx !== -1) {
      this.data.deployments[idx] = { ...this.data.deployments[idx], ...patch }
      this.save()
    }
  }

  log(agent: string, message: string): void {
    const entry = `[${new Date().toISOString()}] [${agent}] ${message}`
    this.data.sprintLog.push(entry)
    console.log(`\x1b[32m${entry}\x1b[0m`)
    this.save()
  }

  writeArtifact(relativePath: string, content: string): void {
    const full = path.join(process.cwd(), 'workspace', 'artifacts', relativePath)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
}
