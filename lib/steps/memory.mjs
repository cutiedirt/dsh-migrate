/**
 * 步骤：memory —— 两个 meow-memory 风格 SQLite 库的**离线并集合并**。
 *
 * 语义（与实测脚本 `merge-meow-db.mjs` 一致，抽成通用版）：
 *   - 按主键取并集：只在新库 → 整行插入；两边都有 → 比"更新标记"列，源较新则整行替换，否则保持目标；
 *   - 不执行任何 DDL（不建表、不改列）——目标缺表就跳过并告警，绝不动 schema；
 *   - **源只读打开**；目标先备份；结束时 `wal_checkpoint(TRUNCATE)` 让目标自包含；
 *   - **幂等**：重跑应为 0 插入 0 替换。
 *
 * 安全红线：目标库落在 `/mnt/*`（drvfs/9p）时**直接拒绝**——实测会 `disk I/O error`，
 * 并发写还会把库写坏（`database disk image is malformed`）。
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, copyFileSync, statSync } from 'node:fs'
import { isDangerousForSqlite } from '../util.mjs'
import { backupFile } from '../manifest.mjs'

export const step = 'memory'

/** 判定"哪边更新"时按优先级找这些列。 */
const RECENCY_COLUMNS = ['updated_at', 'last_event_time', 'run_at', 'created_at', 'last_dream_time']

const quote = (id) => `"${String(id).replace(/"/g, '""')}"`

function openReadOnly(path) {
  return new DatabaseSync(path, { readOnly: true })
}

function listTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name)
}

function tableInfo(db, table) {
  const cols = db.prepare(`PRAGMA table_info(${quote(table)})`).all()
  const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name)
  const sql = String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql ?? '')
  const columns = cols.map((c) => c.name)
  // AUTOINCREMENT 主键是"各库独立编号"，同一个 id 在两边代表不同行；
  // 这种表改用「其余列的组合」做键，否则会把两条不同的记录误并成一条。
  const autoincrement = /AUTOINCREMENT/i.test(sql) && pk.length === 1
  const keyColumns = autoincrement ? columns.filter((c) => !pk.includes(c)) : pk
  return { columns, pk, keyColumns: keyColumns.length > 0 ? keyColumns : pk, autoincrement }
}

const keyOf = (row, keyColumns) => keyColumns.map((c) => String(row[c] ?? '')).join('\u0000')

function recencyOf(row, columns) {
  for (const c of RECENCY_COLUMNS) {
    if (columns.includes(c)) {
      const v = Number(row[c])
      if (Number.isFinite(v)) return v
    }
  }
  return undefined
}

function guardPaths(section) {
  if (isDangerousForSqlite(section.target)) {
    const e = new Error(`目标库位于 /mnt/*（drvfs/9p）：${section.target} —— SQLite 在该文件系统上会 I/O 报错，拒绝执行`)
    e.code = 'EMEMORY_DANGEROUS_TARGET'
    throw e
  }
  if (isDangerousForSqlite(section.source)) {
    // 源只读还能读，但风险高：明确告警（由 log 输出），不阻断
  }
}

/** 读一个库的全部行（只读）。 */
function snapshot(path) {
  const db = openReadOnly(path)
  const out = new Map()
  for (const t of listTables(db)) {
    const info = tableInfo(db, t)
    const rows = db.prepare(`SELECT * FROM ${quote(t)}`).all()
    out.set(t, { ...info, rows })
  }
  db.close()
  return out
}

export async function plan(section, { log } = {}) {
  guardPaths(section)
  if (!existsSync(section.source)) throw new Error(`源库不存在：${section.source}`)
  const src = snapshot(section.source)
  const tgtExists = existsSync(section.target)
  const tgt = tgtExists ? snapshot(section.target) : new Map()

  const tables = []
  let inserts = 0
  let updates = 0
  for (const [name, s] of src) {
    const t = tgt.get(name)
    if (!t) { tables.push({ table: name, note: '目标缺该表：跳过（不做 DDL）', inserts: 0, updates: 0 }); continue }
    const tgtKeys = new Set(t.rows.map((r) => keyOf(r, t.keyColumns)))
    let ins = 0
    let upd = 0
    for (const row of s.rows) {
      const k = keyOf(row, s.keyColumns)
      if (!tgtKeys.has(k)) { ins++; continue }
      const other = t.rows.find((r) => keyOf(r, t.keyColumns) === k)
      const a = recencyOf(row, s.columns)
      const b = other ? recencyOf(other, t.columns) : undefined
      if (a !== undefined && b !== undefined && a > b) upd++
    }
    inserts += ins; updates += upd
    tables.push({ table: name, src: s.rows.length, tgt: t.rows.length, inserts: ins, updates: upd })
  }
  log?.info(`  targetExists=${tgtExists} tables=${tables.length} inserts=${inserts} updates=${updates}`)
  return { counts: { tables: tables.length, inserts, updates }, tables }
}

export async function apply(section, { log, manifest, write = false } = {}) {
  guardPaths(section)
  const planned = await plan(section, {})
  if (!write) return { wouldInsert: planned.counts.inserts, wouldUpdate: planned.counts.updates, inserted: 0, updated: 0, tables: planned.tables }

  // 目标不存在：先把源自包含化后整份拷过去（这是唯一"创建"动作，且不是 DDL）
  if (!existsSync(section.target)) {
    const srcDb = new DatabaseSync(section.source)
    try { srcDb.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* 只读卷或已 TRUNCATE */ }
    srcDb.close()
    copyFileSync(section.source, section.target)
    log?.info(`  目标不存在 → 以源为基座整份创建：${section.target}`)
    return { wouldInsert: 0, wouldUpdate: 0, inserted: 0, updated: 0, createdFromSource: true, tables: [] }
  }

  backupFile(manifest, section.target)
  const src = snapshot(section.source)
  const db = new DatabaseSync(section.target)
  db.exec('PRAGMA busy_timeout = 5000')
  const report = []
  let inserted = 0
  let updated = 0
  try {
    for (const [name, s] of src) {
      const known = listTables(db).includes(name)
      if (!known) { log?.warn(`  目标缺表，跳过：${name}`); continue }
      const t = tableInfo(db, name)
      const tgtRows = db.prepare(`SELECT * FROM ${quote(name)}`).all()
      const byKey = new Map(tgtRows.map((r) => [keyOf(r, t.keyColumns), r]))
      // 自增主键表：不写 id，让目标库自己编号（否则会顶掉目标里同 id 的另一条记录）
      const cols = t.columns.filter((c) => s.columns.includes(c) && !(s.autoincrement && s.pk.includes(c)))
      const insertSql = `INSERT OR REPLACE INTO ${quote(name)} (${cols.map(quote).join(',')}) VALUES (${cols.map(() => '?').join(',')})`
      const ins = db.prepare(insertSql)
      let nIns = 0
      let nUpd = 0
      db.exec('BEGIN')
      for (const row of s.rows) {
        const k = keyOf(row, s.keyColumns)
        const other = byKey.get(k)
        if (other === undefined) {
          ins.run(...cols.map((c) => (row[c] === undefined ? null : row[c])))
          nIns++
          continue
        }
        const a = recencyOf(row, s.columns)
        const b = recencyOf(other, t.columns)
        if (a !== undefined && b !== undefined && a > b) {
          ins.run(...cols.map((c) => (row[c] === undefined ? null : row[c])))
          nUpd++
        }
      }
      db.exec('COMMIT')
      inserted += nIns; updated += nUpd
      report.push({ table: name, inserts: nIns, updates: nUpd, tgtBefore: tgtRows.length })
      log?.info(`  ${name}: +${nIns} ~${nUpd}（原 ${tgtRows.length}）`)
    }
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
  return { wouldInsert: planned.counts.inserts, wouldUpdate: planned.counts.updates, inserted, updated, tables: report }
}

export async function verify(section, { log } = {}) {
  const result = { source: section.source, target: section.target, exists: existsSync(section.target), ok: false }
  if (!existsSync(section.target)) { log?.error('目标库不存在'); return result }
  const db = openReadOnly(section.target)
  result.integrity = db.prepare('PRAGMA integrity_check').get().integrity_check
  result.foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all().length
  result.tables = {}
  const missing = []
  const src = snapshot(section.source)
  const tgt = snapshot(section.target)
  for (const [name, s] of src) {
    const t = tgt.get(name)
    result.tables[name] = { source: s.rows.length, target: t ? t.rows.length : null }
    if (!t) { missing.push({ table: name, reason: '目标缺表' }); continue }
    const keys = new Set(t.rows.map((r) => keyOf(r, t.keyColumns)))
    const absent = s.rows.filter((r) => !keys.has(keyOf(r, s.keyColumns))).length
    result.tables[name].sourceMissingInTarget = absent
    if (absent > 0) missing.push({ table: name, reason: `${absent} 行未进目标` })
  }
  db.close()
  result.missing = missing
  result.ok = result.integrity === 'ok' && missing.length === 0
  log?.info(`  integrity=${result.integrity} missing=${missing.length}`)
  return result
}
