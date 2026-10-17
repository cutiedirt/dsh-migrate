/**
 * 步骤：workspace —— 让注册表与磁盘会话目录一致。
 *
 * 症状：会话文件在磁盘上（甚至能读），但侧栏里永远看不到 —— 因为
 * `<DSH_HOME>/storages/workspace.json` 的 `sessionIds` 里没有它。
 *
 * 只做「补登记」：把磁盘上存在、projectKey 与某工作区 path 相符、且既未注册也未被归档的
 * 会话，追加进该工作区的 sessionIds。**从不删除**任何注册项（prune 留待后续版本）。
 */
import { readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson, sha256File } from '../util.mjs'
import { backupFile } from '../manifest.mjs'
import { projectKey, normalizeSessionId } from '../projectkey.mjs'

export const step = 'workspace'

/** 扫描磁盘：{ projectKeyDir -> Set<sessionId> } */
export function scanDisk(sessionsRoot, log) {
  const out = new Map()
  if (!existsSync(sessionsRoot)) { log?.warn(`sessionsRoot 不存在：${sessionsRoot}`); return out }
  for (const wsDir of readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!wsDir.isDirectory()) continue
    const dir = join(sessionsRoot, wsDir.name)
    const ids = new Set()
    for (const s of readdirSync(dir, { withFileTypes: true })) {
      if (!s.isDirectory()) continue
      const hasLog = readdirSync(join(dir, s.name)).some((f) => f.endsWith('.zstd'))
      if (hasLog) ids.add(normalizeSessionId(s.name))
    }
    out.set(wsDir.name, ids)
  }
  return out
}

function analyze(section, log) {
  const reg = readJson(section.registry)
  const workspaces = reg?.tables?.workspaces ?? {}
  const archived = new Set(reg?.global?.archivedSessionIds ?? [])
  const disk = scanDisk(section.sessionsRoot ?? '', log)

  const report = { workspaces: [], unregistered: [], ghosts: [], archivedOnDisk: 0 }
  for (const [id, ws] of Object.entries(workspaces)) {
    const key = projectKey(ws.path)
    const onDisk = disk.get(key) ?? new Set()
    const registered = new Set(ws.sessionIds ?? [])
    const unreg = [...onDisk].filter((s) => !registered.has(s) && !archived.has(s))
    const ghosts = [...registered].filter((s) => !onDisk.has(s))
    report.workspaces.push({ id, path: ws.path, key, registered: registered.size, onDisk: onDisk.size, unregistered: unreg.length, ghosts: ghosts.length })
    for (const s of unreg) report.unregistered.push({ workspaceId: id, path: ws.path, key, sessionId: s })
    for (const s of ghosts) report.ghosts.push({ workspaceId: id, sessionId: s })
  }
  for (const [, ids] of disk) for (const s of ids) if (archived.has(s)) report.archivedOnDisk++
  return { reg, workspaces, archived, disk, report }
}

export async function plan(section, { log } = {}) {
  const { report } = analyze(section, log)
  for (const w of report.workspaces) {
    log?.info(`  ${w.path} | 注册 ${w.registered} / 磁盘 ${w.onDisk} / 待登记 ${w.unregistered} / 幽灵 ${w.ghosts}`)
  }
  return { counts: { workspaces: report.workspaces.length, unregistered: report.unregistered.length, ghosts: report.ghosts.length }, ...report }
}

export async function apply(section, { log, manifest, write = false } = {}) {
  const { reg, workspaces, archived, disk } = analyze(section, log)
  const adds = []
  for (const [id, ws] of Object.entries(workspaces)) {
    const key = projectKey(ws.path)
    const onDisk = disk.get(key) ?? new Set()
    const registered = new Set(ws.sessionIds ?? [])
    const unreg = [...onDisk].filter((s) => !registered.has(s) && !archived.has(s)).sort()
    if (unreg.length) adds.push({ id, unreg })
  }
  const wouldAdd = adds.reduce((a, b) => a + b.unreg.length, 0)
  if (!write) return { wouldAdd, changed: 0, workspacesTouched: adds.length }
  if (wouldAdd === 0) return { wouldAdd: 0, changed: 0, workspacesTouched: 0 }

  backupFile(manifest, section.registry)
  for (const { id, unreg } of adds) {
    const ws = workspaces[id]
    ws.sessionIds = [...(ws.sessionIds ?? []), ...unreg]
    log?.info(`  + ${id}: ${unreg.length} 个会话补登记`)
  }
  writeJson(section.registry, reg)
  return { wouldAdd, changed: wouldAdd, workspacesTouched: adds.length }
}

export async function verify(section, { log } = {}) {
  const { report } = analyze(section, log)
  return {
    workspaces: report.workspaces,
    unregistered: report.unregistered,
    ghosts: report.ghosts,
    archivedOnDisk: report.archivedOnDisk,
    ok: report.unregistered.length === 0,
    registrySha256: existsSync(section.registry) ? sha256File(section.registry) : null,
  }
}
