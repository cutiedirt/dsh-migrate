/**
 * 步骤：attachments —— 补齐内容寻址附件对象。
 *
 * 附件按内容寻址存放：`<attachments>/v1/objects/<前2位>/<sha256>`。
 * 会话里只引用哈希，所以缺对象 = 图片/附件裂开；补对象是纯复制，风险低。
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { copyFileSync, mkdirSync } from 'node:fs'
import { sha256File, listFiles } from '../util.mjs'
import { backupFile } from '../manifest.mjs'

export const step = 'attachments'

const objectsOf = (root) => join(root, 'v1', 'objects')

function listObjects(root) {
  const dir = objectsOf(root)
  if (!existsSync(dir)) return []
  return listFiles(dir, (p) => !p.endsWith('.tmp'))
}

export async function plan(section, { log } = {}) {
  const src = listObjects(section.source)
  const missing = []
  for (const p of src) {
    const rel = p.slice(objectsOf(section.source).length + 1)
    const dst = join(objectsOf(section.target), rel)
    if (!existsSync(dst)) missing.push({ from: p, to: dst, rel })
  }
  log?.info(`  source=${src.length} 缺失=${missing.length}`)
  return { counts: { source: src.length, missing: missing.length }, missing }
}

export async function apply(section, { log, manifest, write = false } = {}) {
  const { missing } = await plan(section, {})
  if (!write) return { wouldCopy: missing.length, copied: 0, hashMismatch: 0 }
  let copied = 0
  const hashMismatch = []
  for (const m of missing) {
    mkdirSync(join(objectsOf(section.target), m.rel.split(/[\\/]/).slice(0, 1)[0]), { recursive: true })
    if (existsSync(m.to)) {
      if (sha256File(m.to) !== sha256File(m.from)) hashMismatch.push(m.to)
      continue
    }
    backupFile(manifest, m.to)
    copyFileSync(m.from, m.to)
    copied++
    if (sha256File(m.to) !== sha256File(m.from)) hashMismatch.push(m.to)
  }
  if (hashMismatch.length) log?.error(`  哈希不一致：${hashMismatch.length}`)
  return { wouldCopy: missing.length, copied, hashMismatch: hashMismatch.length }
}

export async function verify(section, { log } = {}) {
  const src = listObjects(section.source)
  let present = 0
  const missing = []
  const mismatched = []
  for (const p of src) {
    const rel = p.slice(objectsOf(section.source).length + 1)
    const dst = join(objectsOf(section.target), rel)
    if (!existsSync(dst)) { missing.push(rel); continue }
    present++
    if (sha256File(dst) !== sha256File(p)) mismatched.push(rel)
  }
  log?.info(`  present=${present} missing=${missing.length} mismatch=${mismatched.length}`)
  return { source: src.length, present, missing, mismatched, ok: missing.length === 0 && mismatched.length === 0 }
}
