/**
 * 备份清单（manifest）：每一步落盘前先把将改动的文件备份，并记录哈希。
 * rollback 只依赖这份清单，不做任何推断。
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { sha256File, writeJson, readJson, nowStamp, statOf } from './util.mjs'

export function createManifest(root, configPath) {
  const stamp = nowStamp()
  const dir = join(root, `run-${stamp}`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'manifest.json')
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    config: configPath,
    backupDir: join(dir, 'backup'),
    entries: [],
  }
  mkdirSync(manifest.backupDir, { recursive: true })
  writeJson(path, manifest)
  return { dir, path, manifest }
}

/** 备份单个文件（若已备份过则复用），返回记录。 */
export function backupFile(manifest, absPath) {
  const existing = manifest.entries.find((e) => e.path === absPath)
  if (existing) return existing
  if (!existsSync(absPath)) {
    const rec = { path: absPath, existed: false, at: new Date().toISOString() }
    manifest.entries.push(rec)
    return rec
  }
  // 目标文件名加序号，避免同名冲突
  const n = manifest.entries.filter((e) => e.existed).length
  const target = join(manifest.backupDir, `${String(n).padStart(4, '0')}-${basename(absPath)}`)
  copyFileSync(absPath, target)
  const rec = {
    path: absPath,
    existed: true,
    backupPath: target,
    bytes: statOf(absPath)?.size ?? null,
    sha256: sha256File(absPath),
    at: new Date().toISOString(),
  }
  manifest.entries.push(rec)
  return rec
}

export function saveManifest(path, manifest) {
  writeJson(path, manifest)
  return path
}

export function loadManifest(path) {
  return readJson(path)
}

/** 按清单还原（只覆盖 existed=true 的记录；existed=false 表示当初文件不存在）。 */
export function rollback(manifest, { log } = {}) {
  const result = { restored: [], missingBackup: [], skipped: [] }
  for (const e of manifest.entries) {
    if (!e.existed) { result.skipped.push(e.path); continue }
    if (!e.backupPath || !existsSync(e.backupPath)) { result.missingBackup.push(e.path); continue }
    mkdirSync(dirname(e.path), { recursive: true })
    copyFileSync(e.backupPath, e.path)
    result.restored.push(e.path)
    log?.info(`restored ${e.path}`)
  }
  return result
}
