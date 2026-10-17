import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as memory from '../lib/steps/memory.mjs'
import { createManifest } from '../lib/manifest.mjs'

const tmp = () => mkdtempSync(join(tmpdir(), 'dshmig-mem-'))

function makeDb(path, rows) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`CREATE TABLE fact (id TEXT PRIMARY KEY, content TEXT NOT NULL, importance INTEGER NOT NULL DEFAULT 1, updated_at INTEGER)`)
  db.exec(`CREATE TABLE lesson (id TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at INTEGER)`)
  db.exec(`CREATE TABLE dream_log (id INTEGER PRIMARY KEY AUTOINCREMENT, run_at INTEGER NOT NULL, summary TEXT)`)
  db.exec(`CREATE TABLE dream_meta (key TEXT PRIMARY KEY, value INTEGER)`)
  db.exec(`CREATE TABLE windows (session_id TEXT PRIMARY KEY, last_event_time INTEGER)`)
  const f = db.prepare('INSERT INTO fact (id, content, importance, updated_at) VALUES (?,?,?,?)')
  for (const r of rows.facts ?? []) f.run(r.id, r.content, r.importance ?? 1, r.updated_at)
  const l = db.prepare('INSERT INTO lesson (id, content, updated_at) VALUES (?,?,?)')
  for (const r of rows.lessons ?? []) l.run(r.id, r.content, r.updated_at)
  const d = db.prepare('INSERT INTO dream_log (run_at, summary) VALUES (?,?)')
  for (const r of rows.dreams ?? []) d.run(r.run_at, r.summary)
  const m = db.prepare('INSERT INTO dream_meta (key, value) VALUES (?,?)')
  for (const r of rows.meta ?? []) m.run(r.key, r.value)
  const w = db.prepare('INSERT INTO windows (session_id, last_event_time) VALUES (?,?)')
  for (const r of rows.windows ?? []) w.run(r.session_id, r.last_event_time)
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.close()
}

test('memory: 按主键并集，源较新则替换，重跑幂等', async () => {
  const dir = tmp()
  const src = join(dir, 'src.db')
  const tgt = join(dir, 'tgt.db')
  makeDb(src, {
    facts: [
      { id: 'a', content: 'src-a', updated_at: 200 },   // 两边都有，源更新 → 替换
      { id: 'b', content: 'src-b', updated_at: 300 },   // 仅源 → 插入
    ],
    lessons: [{ id: 'L1', content: 'src-lesson', updated_at: 10 }],
    dreams: [{ run_at: 1000, summary: 'src-dream' }],
    meta: [{ key: 'm', value: 7 }],
    windows: [{ session_id: 's-1', last_event_time: 500 }],
  })
  makeDb(tgt, {
    facts: [
      { id: 'a', content: 'tgt-a', updated_at: 100 },   // 源更新 → 应被替换
      { id: 'c', content: 'tgt-c', updated_at: 400 },   // 仅目标 → 保留
    ],
    lessons: [{ id: 'L2', content: 'tgt-lesson', updated_at: 20 }],
    dreams: [{ run_at: 900, summary: 'tgt-dream' }],
    meta: [{ key: 'n', value: 9 }],
    windows: [{ session_id: 's-2', last_event_time: 600 }],
  })

  const section = { source: src, target: tgt }
  const p = await memory.plan(section, {})
  assert.equal(p.counts.inserts, 5) // fact b + lesson L1 + dream_log 1 + dream_meta m + windows s-1
  assert.equal(p.counts.updates, 1) // fact a

  const { manifest } = createManifest(dir, 'cfg')
  const a1 = await memory.apply(section, { manifest, write: true })
  assert.equal(a1.inserted, 5)
  assert.equal(a1.updated, 1)
  assert.equal(a1.errors, undefined)

  const db = new DatabaseSync(tgt, { readOnly: true })
  const factA = db.prepare("SELECT content FROM fact WHERE id='a'").get()
  assert.equal(factA.content, 'src-a')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM fact').get().c, 3)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM lesson').get().c, 2)
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  db.close()

  const a2 = await memory.apply(section, { manifest, write: true })
  assert.equal(a2.inserted, 0, '重跑必须 0 插入')
  assert.equal(a2.updated, 0, '重跑必须 0 替换')

  const v = await memory.verify(section, {})
  assert.equal(v.ok, true)
  assert.equal(v.integrity, 'ok')
})

test('memory: 目标不存在时以源为基座创建', async () => {
  const dir = tmp()
  const src = join(dir, 'src2.db')
  const tgt = join(dir, 'tgt2.db')
  makeDb(src, { facts: [{ id: 'x', content: 'only', updated_at: 1 }] })
  const { manifest } = createManifest(dir, 'cfg')
  const r = await memory.apply({ source: src, target: tgt }, { manifest, write: true })
  assert.equal(r.createdFromSource, true)
  assert.equal(existsSync(tgt), true)
  const v = await memory.verify({ source: src, target: tgt }, {})
  assert.equal(v.ok, true)
})

test('memory: 目标在 /mnt 上时拒绝执行', { skip: process.platform === 'win32' }, async () => {
  await assert.rejects(
    () => memory.plan({ source: '/tmp/a.db', target: '/mnt/d/x/memory.db' }, {}),
    (e) => e.code === 'EMEMORY_DANGEROUS_TARGET',
  )
})
