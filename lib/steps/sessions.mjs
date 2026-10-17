/**
 * 步骤：sessions —— 按帧改写会话日志第一帧的 cwd，使会话在新宿主的工作区下可见。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { scanFrames, decodeFrames, readHeader, rewriteFirstFrame } from '../frames.mjs'
import { backupFile } from '../manifest.mjs'

export const step = 'sessions'

/** 只遍历约定的 root/projectKeyDir/sessionDir 三级结构。 */
function discover(section) {
  const files = []
  let skippedNonZstd = 0
  if (!section?.root || !existsSync(section.root)) return { files, skippedNonZstd }
  let projects
  try { projects = readdirSync(section.root, { withFileTypes: true }) } catch { return { files, skippedNonZstd } }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const projectPath = join(section.root, project.name)
    let sessions
    try { sessions = readdirSync(projectPath, { withFileTypes: true }) } catch { continue }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      const sessionPath = join(projectPath, session.name)
      let entries
      try { entries = readdirSync(sessionPath, { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const file = join(sessionPath, entry.name)
        if (entry.name.endsWith('.zstd')) files.push(file)
        else skippedNonZstd++
      }
    }
  }
  return { files, skippedNonZstd }
}

function mapFor(section, cwd) {
  return (section?.cwdMap ?? []).find((m) => m?.from === cwd)
}

function planDetails(section, log) {
  const discovered = discover(section)
  const actions = []
  let alreadyOk = 0
  let unreadable = 0
  for (const file of discovered.files) {
    try {
      const buf = readFileSync(file)
      const info = readHeader(buf)
      const parsed = scanFrames(buf)
      if (parsed.trailing > 0) throw Object.assign(new Error(`尾部存在 ${parsed.trailing} 个字节`), { code: 'EZSTD_TRUNCATED' })
      const mapping = mapFor(section, info.header?.cwd)
      if (mapping && mapping.from !== mapping.to) {
        actions.push({ file, from: mapping.from, to: mapping.to, frameCount: parsed.frames.length })
      } else {
        // 没有映射或已经在目标 cwd 的文件不需要改写，计入幂等统计。
        alreadyOk++
      }
    } catch (e) {
      unreadable++
      log?.warn(`无法读取会话，跳过：${file}（${e.message}）`)
    }
  }
  return {
    actions,
    counts: {
      files: discovered.files.length,
      toRewrite: actions.length,
      alreadyOk,
      skippedNonZstd: discovered.skippedNonZstd,
      unreadable,
    },
  }
}

export async function plan(section, { log } = {}) {
  const result = planDetails(section, log)
  log?.info(`  files=${result.counts.files} toRewrite=${result.counts.toRewrite} alreadyOk=${result.counts.alreadyOk} unreadable=${result.counts.unreadable}`)
  return result
}

export async function apply(section, { log, manifest, write = false } = {}) {
  const planned = planDetails(section, log)
  const result = { changed: 0, wouldChange: planned.actions.length, unchanged: planned.counts.alreadyOk, errors: [] }
  if (!write) return result

  for (const action of planned.actions) {
    try {
      if (manifest) backupFile(manifest, action.file)
      const original = readFileSync(action.file)
      const rewritten = rewriteFirstFrame(original, { cwd: action.to })
      writeFileSync(action.file, rewritten.buffer)
      const check = readHeader(readFileSync(action.file))
      if (check.header?.cwd !== action.to) {
        throw new Error(`写回后 cwd 不一致：${JSON.stringify(check.header?.cwd)} != ${JSON.stringify(action.to)}`)
      }
      result.changed++
      log?.info(`  rewrite ${action.file}`)
    } catch (e) {
      result.errors.push({ file: action.file, message: e.message })
      log?.error(`  rewrite 失败：${action.file}（${e.message}）`)
    }
  }
  return result
}

export async function verify(section, { log } = {}) {
  const discovered = discover(section)
  const cwdHistogram = {}
  const mismatched = []
  let decodedOk = 0
  let badFrames = 0
  for (const file of discovered.files) {
    try {
      const buf = readFileSync(file)
      const info = readHeader(buf)
      decodeFrames(buf)
      decodedOk++
      const cwd = info.header?.cwd
      cwdHistogram[cwd] = (cwdHistogram[cwd] ?? 0) + 1
      const mapping = mapFor(section, cwd)
      if (mapping && mapping.to !== cwd) {
        mismatched.push({ file, cwd, expect: mapping.to })
      }
    } catch (e) {
      badFrames++
      log?.warn(`会话校验失败：${file}（${e.message}）`)
    }
  }
  log?.info(`  files=${discovered.files.length} decodedOk=${decodedOk} badFrames=${badFrames} mismatched=${mismatched.length}`)
  return { files: discovered.files.length, decodedOk, badFrames, cwdHistogram, mismatched }
}
