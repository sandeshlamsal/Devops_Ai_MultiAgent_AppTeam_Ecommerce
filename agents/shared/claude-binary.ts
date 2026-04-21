import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

let resolved: string | null = null

export function findClaudeBinary(): string {
  if (resolved) return resolved

  // 1. Check if claude is on PATH (global npm install or manual)
  try {
    const bin = execSync('command -v claude', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    if (bin) return (resolved = bin)
  } catch { /* not on PATH */ }

  // 2. Fall back to Claude Code VS Code extension binary (latest version)
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  const extDir = path.join(home, '.vscode', 'extensions')

  if (fs.existsSync(extDir)) {
    const match = fs.readdirSync(extDir)
      .filter(d => d.startsWith('anthropic.claude-code-'))
      .sort()
      .reverse() // descending = latest version first
      .map(d => path.join(extDir, d, 'resources', 'native-binary', 'claude'))
      .find(p => fs.existsSync(p))

    if (match) {
      console.log(`\x1b[90m[claude-binary] Using VS Code extension binary: ${match}\x1b[0m`)
      return (resolved = match)
    }
  }

  throw new Error(
    '⛔  claude binary not found.\n' +
    '   Option 1: npm install -g @anthropic-ai/claude-code\n' +
    '   Option 2: Install the Claude Code VS Code extension.',
  )
}
