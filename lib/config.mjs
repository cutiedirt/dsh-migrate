/**
 * 配置加载与校验。
 *
 * migrate.json 形状（version 1）：
 * {
 *   "version": 1,
 *   "sessions":    { "root": "<sessions 目录>", "cwdMap": [ { "from": "...", "to": "..." } ] },
 *   "workspace":   { "registry": "<workspace.json>", "sessionsRoot": "<sessions 目录>" },
 *   "attachments": { "source": "<源 attachments>", "target": "<目标 attachments>" },
 *   "usage":       { "sources": ["<账本>"], "target": "<账本>" },
 *   "memory":      { "source": "<memory.db>", "target": "<memory.db>" }
 * }
 *
 * 约定：路径一律"运行本工具的那台机器"上可见的绝对路径；
 * 跨机迁移时，source 侧路径由用户在配置里改写（本工具不做远程访问）。
 */
import { readJson } from './util.mjs'
import { isAbsolute } from 'node:path'

export const KNOWN_STEPS = ['sessions', 'workspace', 'attachments', 'usage', 'memory']

export function loadConfig(p) {
  const cfg = readJson(p)
  const errors = []

  if (cfg.version !== 1) errors.push(`version 必须是 1（当前 ${JSON.stringify(cfg.version)}）`)

  const needAbs = (v, label) => {
    if (typeof v !== 'string' || v === '') { errors.push(`${label} 缺失`); return }
    if (!isAbsolute(v)) errors.push(`${label} 必须是绝对路径：${v}`)
  }

  if (cfg.sessions) {
    needAbs(cfg.sessions.root, 'sessions.root')
    if (!Array.isArray(cfg.sessions.cwdMap) || cfg.sessions.cwdMap.length === 0) {
      errors.push('sessions.cwdMap 必须是非空数组')
    } else {
      cfg.sessions.cwdMap.forEach((m, i) => {
        needAbs(m?.from, `sessions.cwdMap[${i}].from`)
        needAbs(m?.to, `sessions.cwdMap[${i}].to`)
      })
    }
  }
  if (cfg.workspace) {
    needAbs(cfg.workspace.registry, 'workspace.registry')
    if (cfg.workspace.sessionsRoot) needAbs(cfg.workspace.sessionsRoot, 'workspace.sessionsRoot')
  }
  if (cfg.attachments) {
    needAbs(cfg.attachments.source, 'attachments.source')
    needAbs(cfg.attachments.target, 'attachments.target')
  }
  if (cfg.usage) {
    if (!Array.isArray(cfg.usage.sources) || cfg.usage.sources.length === 0) errors.push('usage.sources 必须是非空数组')
    else cfg.usage.sources.forEach((s, i) => needAbs(s, `usage.sources[${i}]`))
    needAbs(cfg.usage.target, 'usage.target')
  }
  if (cfg.memory) {
    needAbs(cfg.memory.source, 'memory.source')
    needAbs(cfg.memory.target, 'memory.target')
  }

  return { config: cfg, errors }
}

/** 取某个步骤实际启用的配置段；返回 undefined 表示该步未配置（跳过）。 */
export function sectionOf(cfg, step) {
  return cfg?.[step]
}
