/** 通用工具：哈希、JSON 读写、目录遍历、时间戳、人读字节。 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const nowStamp = (d = new Date()) =>
  d.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')

export function ensureDir(p) {
  mkdirSync(p, { recursive: true })
  return p
}

export function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

export function writeJson(p, obj) {
  ensureDir(dirname(p))
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8')
  return p
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

export function sha256File(p) {
  return sha256(readFileSync(p))
}

export function humanBytes(n) {
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  do { n /= 1024; i++ } while (n >= 1024 && i < u.length - 1)
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`
}

/** 递归列出文件（跳过 .bak-* 之类由调用方过滤）。 */
export function listFiles(root, filter = () => true) {
  const out = []
  if (!existsSync(root)) return out
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (filter(p)) out.push(p)
    }
  }
  walk(root)
  return out
}

export function statOf(p) {
  try { return statSync(p) } catch { return undefined }
}

/**
 * 危险位置检测：SQLite 库放在 /mnt/*（drvfs/9p）上，WSL 侧访问会
 * `disk I/O error` 甚至损坏（2026-10-06 实测）。命中即拒绝。
 * @param {string} p
 */
export function isDangerousForSqlite(p) {
  const s = resolve(p).replace(/\\/g, '/')
  return /^\/mnt\/[a-z]\//i.test(s) || /^[A-Za-z]:\//.test(s) === false && s.startsWith('/mnt/')
}

/** 简易 logger：human 输出 + 结构化收集。 */
export function makeLog({ json = false } = {}) {
  const events = []
  const emit = (level, msg, extra) => {
    events.push({ at: new Date().toISOString(), level, msg, ...(extra ? { extra } : {}) })
    if (json) return
    const tag = { info: '  ', warn: '! ', error: 'x ', step: '> ' }[level] ?? '  '
    process.stdout.write(`${tag}${msg}\n`)
  }
  return {
    events,
    info: (m, e) => emit('info', m, e),
    warn: (m, e) => emit('warn', m, e),
    error: (m, e) => emit('error', m, e),
    step: (m, e) => emit('step', m, e),
  }
}
