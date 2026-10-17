/**
 * 步骤：usage —— 用量账本按天合并。
 *
 * 关键设计：**可幂等**。直接"同一天相加"会在重跑时重复计数；所以按
 * 来源（source 的 basename）分桶保存，`totals` 由各桶求和算出：
 *
 *   { version: 1, days: { "2026-10-01": { bySource: { hostA: {inputTokens, outputTokens} },
 *                                        totals: { inputTokens, outputTokens } } } }
 *
 * 兼容旧账本（扁平 `days[day] = {inputTokens,…}`）：读取时视为来源 "legacy"。
 */
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { readJson, writeJson } from '../util.mjs'
import { backupFile } from '../manifest.mjs'

export const step = 'usage'

const NUM_FIELDS = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens']

function emptyTotals() {
  const o = {}
  for (const f of NUM_FIELDS) o[f] = 0
  return o
}

function addInto(acc, v) {
  for (const f of NUM_FIELDS) if (typeof v?.[f] === 'number' && Number.isFinite(v[f])) acc[f] += v[f]
  return acc
}

/** 统一成 {bySource, totals} 形态。 */
export function normalizeDay(day) {
  if (!day || typeof day !== 'object') return { bySource: {}, totals: emptyTotals() }
  if (day.bySource && typeof day.bySource === 'object') {
    const bySource = {}
    const totals = emptyTotals()
    for (const [k, v] of Object.entries(day.bySource)) { bySource[k] = { ...v }; addInto(totals, v) }
    return { bySource, totals }
  }
  const totals = emptyTotals()
  addInto(totals, day)
  return { bySource: { legacy: { ...day } }, totals }
}

export function loadLedger(p) {
  const raw = readJson(p)
  const days = {}
  for (const [d, v] of Object.entries(raw?.days ?? {})) days[d] = normalizeDay(v)
  return { version: 1, days }
}

export async function plan(section, { log } = {}) {
  const target = existsSync(section.target) ? loadLedger(section.target) : { version: 1, days: {} }
  const contrib = []
  for (const src of section.sources) {
    if (!existsSync(src)) { log?.warn(`源账本不存在，跳过：${src}`); continue }
    const led = loadLedger(src)
    const label = basename(src) === basename(section.target) ? `${basename(src)}@${src.length}:${hashLite(src)}` : basename(src)
    contrib.push({ src, label, days: Object.keys(led.days).length })
    void target
  }
  log?.info(`  源 ${contrib.length} 个，目标天数 ${Object.keys(target.days).length}`)
  return { counts: { sources: contrib.length, targetDays: Object.keys(target.days).length }, contrib }
}

/** 轻量区分同名文件：用路径长度 + 路径哈希前缀，避免两次跑出不同 label。 */
function hashLite(s) {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return h.toString(16).padStart(8, '0').slice(0, 6)
}

export async function apply(section, { log, manifest, write = false } = {}) {
  const merged = existsSync(section.target) ? loadLedger(section.target) : { version: 1, days: {} }
  let addedDays = 0
  let changedDays = 0
  for (const src of section.sources) {
    if (!existsSync(src)) { log?.warn(`源账本不存在，跳过：${src}`); continue }
    const led = loadLedger(src)
    const label = basename(src) === basename(section.target) ? `${basename(src)}@${hashLite(src)}` : basename(src)
    for (const [d, v] of Object.entries(led.days)) {
      const cur = merged.days[d] ?? { bySource: {}, totals: emptyTotals() }
      if (!cur.bySource[label]) addedDays++
      else if (JSON.stringify(cur.bySource[label]) !== JSON.stringify(v.totals) && JSON.stringify(cur.bySource[label]) !== JSON.stringify(v)) changedDays++
      cur.bySource[label] = { ...v.totals }
      const totals = emptyTotals()
      for (const x of Object.values(cur.bySource)) addInto(totals, x)
      cur.totals = totals
      merged.days[d] = cur
    }
  }
  if (!write) return { wouldWrite: true, addedDays, changedDays, totalDays: Object.keys(merged.days).length }
  backupFile(manifest, section.target)
  const sorted = {}
  for (const d of Object.keys(merged.days).sort()) sorted[d] = merged.days[d]
  writeJson(section.target, { version: 1, days: sorted })
  return { wouldWrite: true, addedDays, changedDays, totalDays: Object.keys(sorted).length }
}

export async function verify(section, { log } = {}) {
  if (!existsSync(section.target)) return { error: 'target 不存在', ok: false }
  const led = loadLedger(section.target)
  const days = Object.keys(led.days).sort()
  let badTotals = 0
  for (const [d, v] of Object.entries(led.days)) {
    const totals = emptyTotals()
    for (const x of Object.values(v.bySource)) addInto(totals, x)
    if (JSON.stringify(totals) !== JSON.stringify(v.totals)) badTotals++
    void d
  }
  log?.info(`  days=${days.length} badTotals=${badTotals}`)
  return { days: days.length, first: days[0] ?? null, last: days.at(-1) ?? null, badTotals, ok: badTotals === 0 }
}
