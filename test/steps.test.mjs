import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectKey, normalizeSessionId } from '../lib/projectkey.mjs'
import * as workspace from '../lib/steps/workspace.mjs'
import * as attachments from '../lib/steps/attachments.mjs'
import * as usage from '../lib/steps/usage.mjs'
import { createManifest } from '../lib/manifest.mjs'

const tmp = () => mkdtempSync(join(tmpdir(), 'dshmig-'))

test('projectKey: 与 DSH 实证一致', () => {
  assert.equal(projectKey('D:\\dshprograming'), '--D-dshprograming--')
  assert.equal(projectKey('/mnt/d/dshprograming'), '--mnt-d-dshprograming--')
  assert.equal(
    projectKey('C:\\Users\\Administrator\\Documents\\deepseek-harness\\default-workspace'),
    '--C-Users-Administrator-Documents-deepseek-harness-default-workspace--',
  )
  // 两个不同字符串必须不相等
  assert.notEqual(projectKey('D:\\dshprograming'), projectKey('/mnt/d/dshprograming'))
  assert.equal(normalizeSessionId('abc'), 'session-abc')
  assert.equal(normalizeSessionId('session-abc'), 'session-abc')
})

test('workspace: 补登记未注册会话，且可重复执行', async () => {
  const root = tmp()
  const wsPath = 'D:\\proj-new'
  const key = projectKey(wsPath)
  const sess = join(root, 'sessions', key, 'session-0003')
  mkdirSync(sess, { recursive: true })
  writeFileSync(join(sess, 'session.v4.jsonl.zstd'), 'dummy')

  const registry = join(root, 'workspace.json')
  writeFileSync(registry, JSON.stringify({
    unit: { name: 't', version: 1 },
    global: { initialized: true, defaultWorkspaceId: 'ws-1', workspaceIds: ['ws-1'], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: { workspaces: { 'ws-1': { path: wsPath, sessionIds: [] } } },
  }, null, 2))

  const section = { registry, sessionsRoot: join(root, 'sessions') }
  const p = await workspace.plan(section, {})
  assert.equal(p.counts.unregistered, 1)

  const { manifest } = createManifest(root, 'cfg')
  const dry = await workspace.apply(section, { manifest, write: false })
  assert.equal(dry.wouldAdd, 1)
  assert.deepEqual(JSON.parse(readFileSync(registry, 'utf8')).tables.workspaces['ws-1'].sessionIds, [])

  const a1 = await workspace.apply(section, { manifest, write: true })
  assert.equal(a1.changed, 1)
  assert.deepEqual(JSON.parse(readFileSync(registry, 'utf8')).tables.workspaces['ws-1'].sessionIds, ['session-0003'])

  const a2 = await workspace.apply(section, { manifest, write: true })
  assert.equal(a2.changed, 0, '重跑必须 0 变更')

  const v = await workspace.verify(section, {})
  assert.equal(v.ok, true)
})

test('attachments: 补齐缺失对象并校验哈希', async () => {
  const root = tmp()
  const source = join(root, 'src')
  const target = join(root, 'dst')
  mkdirSync(join(source, 'v1', 'objects', 'ab'), { recursive: true })
  writeFileSync(join(source, 'v1', 'objects', 'ab', 'abc123'), 'payload-1')
  const section = { source, target }

  const p = await attachments.plan(section, {})
  assert.equal(p.counts.missing, 1)

  const { manifest } = createManifest(root, 'cfg')
  const a = await attachments.apply(section, { manifest, write: true })
  assert.equal(a.copied, 1)
  assert.equal(existsSync(join(target, 'v1', 'objects', 'ab', 'abc123')), true)

  const v = await attachments.verify(section, {})
  assert.equal(v.ok, true)

  const a2 = await attachments.apply(section, { manifest, write: true })
  assert.equal(a2.copied, 0, '重跑必须 0 复制')
})

test('usage: 按来源分桶合并，重跑幂等', async () => {
  const root = tmp()
  const src = join(root, 'hostA-usage.json')
  const tgt = join(root, 'usage.json')
  writeFileSync(src, JSON.stringify({ version: 1, days: { '2026-10-01': { inputTokens: 10, outputTokens: 2 } } }))
  writeFileSync(tgt, JSON.stringify({ version: 1, days: { '2026-10-01': { inputTokens: 5, outputTokens: 1 }, '2026-10-02': { inputTokens: 7 } } }))
  const section = { sources: [src], target: tgt }

  const { manifest } = createManifest(root, 'cfg')
  await usage.apply(section, { manifest, write: true })
  const once = readFileSync(tgt, 'utf8')
  const led1 = JSON.parse(once)
  assert.equal(led1.days['2026-10-01'].totals.inputTokens, 15)
  assert.equal(Object.keys(led1.days).length, 2)

  await usage.apply(section, { manifest, write: true })
  const twice = readFileSync(tgt, 'utf8')
  assert.equal(twice, once, '重跑必须逐字节一致（幂等）')

  const v = await usage.verify(section, {})
  assert.equal(v.ok, true)
  assert.equal(v.days, 2)
})
