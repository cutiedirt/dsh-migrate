import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import test from 'node:test'
import { scanFrames, decodeFrames, readHeader, rewriteFirstFrame } from '../lib/frames.mjs'
import * as sessions from '../lib/steps/sessions.mjs'

const root = join(process.cwd(), 'test', 'fixtures')
const files = [
  join(root, 'sessions', '--D-proj-old--', 'session-0001', 'session.v4.jsonl.zstd'),
  join(root, 'sessions', '--mnt-d-proj--', 'session-0002', 'session.v3.jsonl.zstd'),
  join(root, 'sessions', '--D-proj-new--', 'session-0003', 'session.v4.jsonl.zstd'),
]

test('三份夹具均能切成 4 帧并解出完整 JSONL', () => {
  for (const file of files) {
    const buf = readFileSync(file)
    assert.equal(scanFrames(buf).frames.length, 4)
    assert.equal(scanFrames(buf).trailing, 0)
    assert.equal(decodeFrames(buf).trim().split('\n').length, 10)
  }
})

test('重写第一帧只改变 header，尾部字节和帧数保持不变', () => {
  const buf = readFileSync(files[0])
  const beforeScan = scanFrames(buf)
  const out = rewriteFirstFrame(buf, { cwd: 'D:\\proj-new' })
  const afterScan = scanFrames(out.buffer)
  assert.equal(afterScan.frames.length, beforeScan.frames.length)
  assert.equal(readHeader(out.buffer).header.cwd, 'D:\\proj-new')
  assert.deepEqual(out.buffer.subarray(afterScan.frames[0].end), buf.subarray(beforeScan.frames[0].end))
})

test('session.v3 和 session.v4 的 header 都能读取', () => {
  assert.equal(readHeader(readFileSync(files[0])).header.version, 4)
  assert.equal(readHeader(readFileSync(files[1])).header.version, 3)
})

test('截断与非 zstd 输入给出可识别错误', () => {
  const truncated = readFileSync(files[0]).subarray(0, -5)
  assert.ok(scanFrames(truncated).trailing > 0)
  assert.throws(() => decodeFrames(truncated), (e) => e.code === 'EZSTD_TRUNCATED')
  assert.throws(() => decodeFrames(Buffer.from('plain text')), (e) => e.code === 'EZSTD_TRUNCATED')
})

test('sessions.apply 支持 dry-run、实际改写和幂等重跑', async () => {
  // 关键：这一步会**真的写入**，所以必须在临时副本上做，
  // 否则第二次跑测试时夹具已被改过、changed 会变成 0（测试不可重复）。
  const work = mkdtempSync(join(tmpdir(), 'dshmig-frames-'))
  const copyRoot = join(work, 'sessions')
  const copies = files.map((file) => {
    const rel = file.slice(join(root, 'sessions').length + 1)
    const dst = join(copyRoot, rel)
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(file, dst)
    return dst
  })
  const cfg = {
    sessions: {
      root: copyRoot,
      cwdMap: [
        { from: 'D:\\proj-old', to: 'D:\\proj-new' },
        { from: '/mnt/d/proj', to: 'D:\\proj-new' },
      ],
    },
  }

  // 夹具可能被 CLI 端到端跑法改写过，所以这里把副本的 cwd 强制归一化回期望的 "from"，
  // 让断言与共享夹具的历史状态无关 —— 测试必须可重复、可乱序。
  const FROM = ['D:\\proj-old', '/mnt/d/proj', 'D:\\proj-new']
  copies.forEach((dst, i) => {
    const cur = readFileSync(dst)
    if (readHeader(cur).header.cwd !== FROM[i]) {
      writeFileSync(dst, rewriteFirstFrame(cur, { cwd: FROM[i] }).buffer)
    }
  })

  const original = copies.map((file) => readFileSync(file))
  const dry = await sessions.apply(cfg.sessions, { write: false })
  assert.equal(dry.changed, 0)
  assert.equal(dry.wouldChange, 2)
  assert.deepEqual(copies.map((file) => readFileSync(file)), original)

  const backupDir = join(work, '.test-backup')
  mkdirSync(backupDir, { recursive: true })
  const manifest = { backupDir, entries: [] }
  const applied = await sessions.apply(cfg.sessions, { write: true, manifest })
  assert.equal(applied.changed, 2)
  assert.equal(applied.errors.length, 0)
  assert.equal(readHeader(readFileSync(copies[0])).header.cwd, 'D:\\proj-new')
  assert.equal(readHeader(readFileSync(copies[1])).header.cwd, 'D:\\proj-new')
  assert.equal(readHeader(readFileSync(copies[2])).header.cwd, 'D:\\proj-new')

  const rerun = await sessions.apply(cfg.sessions, { write: true, manifest })
  assert.equal(rerun.changed, 0)
  assert.equal(rerun.wouldChange, 0)
  assert.equal(rerun.unchanged, 3)
  const verified = await sessions.verify(cfg.sessions)
  assert.equal(verified.badFrames, 0)
  assert.equal(verified.mismatched.length, 0)
})
