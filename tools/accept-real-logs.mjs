/**
 * 独立验收（不采信 Codex 自述）：用**真实 DSH 会话日志**验证 frames 模块。
 * 只读真实文件；改写只发生在临时副本上。
 *
 * 用法：node D:\dsh-ref\accept-dsh-migrate.mjs <repoDir> <sessionsRoot> [maxFiles]
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const [, , repoDir, sessionsRoot, maxArg] = process.argv
if (!repoDir || !sessionsRoot) {
  console.error('usage: node accept-dsh-migrate.mjs <repoDir> <sessionsRoot> [maxFiles]')
  process.exit(2)
}
const maxFiles = Number(maxArg ?? 3)
const load = (p) => import(pathToFileURL(join(repoDir, p)).href)
const { scanFrames, decodeFrames, readHeader, rewriteFirstFrame } = await load('lib/frames.mjs')
const sessions = await load('lib/steps/sessions.mjs')

const sha = (b) => createHash('sha256').update(b).digest('hex')

// 收集真实日志（浅层遍历，够用）；按文件大小降序，优先压测大文件
async function collect(root) {
  const fs = await import('node:fs')
  const out = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    let ents = []
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (e.name.endsWith('.zstd')) {
        let size = 0
        try { size = fs.statSync(p).size } catch {}
        out.push({ p, size })
      }
    }
  }
  walk(root, 0)
  return out.sort((a, b) => b.size - a.size)
}

const picks = (await collect(sessionsRoot)).slice(0, maxFiles).map((x) => x.p).sort()
if (picks.length === 0) { console.error('没有找到真实会话日志'); process.exit(1) }

const work = mkdtempSync(join(tmpdir(), 'dshmig-accept-'))
const results = []

for (const file of picks) {
  const buf = readFileSync(file)
  const before = sha(buf)
  const scan = scanFrames(buf)
  const info = readHeader(buf)
  const text = decodeFrames(buf)
  const lines = text.split('\n').filter((l) => l.trim()).length

  const NEW = 'X:\\accept-check'
  const out = rewriteFirstFrame(buf, { cwd: NEW })
  const scan2 = scanFrames(out.buffer)
  const text2 = decodeFrames(out.buffer)
  const lines2 = text2.split('\n').filter((l) => l.trim()).length
  const tailEqual = out.buffer.subarray(scan2.frames[0].end).equals(buf.subarray(scan.frames[0].end))

  // 写盘再读回
  const dst = join(work, basename(dirname(file)), basename(file))
  mkdirSync(dirname(dst), { recursive: true })
  writeFileSync(dst, out.buffer)
  const reread = readHeader(readFileSync(dst))

  // 真实文件必须没被改动
  const after = sha(readFileSync(file))

  results.push({
    file: file.replace(sessionsRoot, '<sessions>'),
    bytes: buf.length,
    frames: scan.frames.length,
    trailing: scan.trailing,
    decodedLines: lines,
    headerCwd: info.header?.cwd,
    version: info.header?.version,
    afterFrames: scan2.frames.length,
    afterLines: lines2,
    tailByteIdentical: tailEqual,
    afterHeaderCwd: reread.header?.cwd,
    realFileUnchanged: before === after,
  })
}

// 额外：用 sessions.plan 只读跑一次真实目录（cwdMap 故意给一个不存在的映射）
const plan = await sessions.plan(
  { root: sessionsRoot, cwdMap: [{ from: '__no_such_cwd__', to: 'Z:\\nope' }] },
  {},
)

const allOk = results.every((r) =>
  r.trailing === 0 && r.frames === r.afterFrames && r.decodedLines === r.afterLines &&
  r.tailByteIdentical && r.afterHeaderCwd === 'X:\\accept-check' && r.realFileUnchanged,
)
console.log(JSON.stringify({ ok: allOk, checked: results.length, plan: plan.counts, results }, null, 2))
process.exit(allOk ? 0 : 1)
