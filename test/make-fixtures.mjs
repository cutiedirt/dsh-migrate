/**
 * 生成**合成**夹具（绝不含真实数据）：
 *   fixtures/sessions/--D-proj-old--/session-0001/session.v4.jsonl.zstd
 *   fixtures/sessions/--mnt-d-proj--/session-0002/session.v3.jsonl.zstd
 *   fixtures/workspace.json
 *   fixtures/attachments/v1/objects/<2>/<hash>
 *
 * 用法：node test/make-fixtures.mjs <outDir>
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const out = process.argv[2]
if (!out) { console.error('usage: node test/make-fixtures.mjs <outDir>'); process.exit(2) }
rmSync(out, { recursive: true, force: true })

const frame = (text) => zstdCompressSync(Buffer.from(text, 'utf8'))
const sha = (buf) => createHash('sha256').update(buf).digest('hex')

/** 造一份多帧会话日志：header + N 个事件帧 */
function makeSession({ version, id, cwd, eventsPerFrame = 3, frames = 3 }) {
  const header = {
    type: 'session',
    version,
    id,
    createdAt: 1760000000000,
    cwd,
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: 'standard',
  }
  const parts = [frame(JSON.stringify(header) + '\n')]
  for (let f = 0; f < frames; f++) {
    const lines = []
    for (let e = 0; e < eventsPerFrame; e++) {
      lines.push(JSON.stringify({
        type: 'step/start', seq: f * eventsPerFrame + e,
        time: 1760000000000 + f * 1000 + e,
        data: { note: `synthetic frame ${f} event ${e}` },
      }))
    }
    parts.push(frame(lines.join('\n') + '\n'))
  }
  return { buffer: Buffer.concat(parts), header, frames: parts.length }
}

function put(p, buf) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, buf)
  return p
}

const sessionsRoot = join(out, 'sessions')
const s1 = makeSession({ version: 4, id: 'session-0001', cwd: 'D:\\proj-old' })
put(join(sessionsRoot, '--D-proj-old--', 'session-0001', 'session.v4.jsonl.zstd'), s1.buffer)

const s2 = makeSession({ version: 3, id: 'session-0002', cwd: '/mnt/d/proj' })
put(join(sessionsRoot, '--mnt-d-proj--', 'session-0002', 'session.v3.jsonl.zstd'), s2.buffer)

// 一个"已经是目标 cwd"的会话，用来验证幂等
const s3 = makeSession({ version: 4, id: 'session-0003', cwd: 'D:\\proj-new' })
put(join(sessionsRoot, '--D-proj-new--', 'session-0003', 'session.v4.jsonl.zstd'), s3.buffer)

const workspace = {
  unit: { name: 'dsh-fixture', version: 1 },
  global: {
    initialized: true,
    defaultWorkspaceId: 'ws-1',
    workspaceIds: ['ws-1'],
    archivedSessionIds: ['session-0099'],
    pinnedSessionIds: [],
  },
  tables: {
    workspaces: {
      'ws-1': { path: 'D:\\proj-new', sessionIds: ['session-0003'] },
    },
  },
}
writeFileSync(join(out, 'workspace.json'), JSON.stringify(workspace, null, 2))

// 两个内容寻址附件对象
const obj1 = Buffer.from('synthetic attachment one')
const obj2 = Buffer.from('synthetic attachment two')
for (const buf of [obj1, obj2]) {
  const h = sha(buf)
  put(join(out, 'attachments', 'v1', 'objects', h.slice(0, 2), h), buf)
}

// 用量账本
writeFileSync(join(out, 'usage.json'), JSON.stringify({
  version: 1,
  days: { '2026-10-01': { inputTokens: 1, outputTokens: 2 }, '2026-10-02': { inputTokens: 3, outputTokens: 4 } },
}, null, 2))

// 顺手生成一份可直接给 CLI 用的配置（路径为本机绝对路径）
import { resolve as resolvePath } from 'node:path'
writeFileSync(join(out, 'migrate.json'), JSON.stringify({
  version: 1,
  sessions: {
    root: resolvePath(sessionsRoot),
    cwdMap: [
      { from: 'D:\\proj-old', to: 'D:\\proj-new' },
      { from: '/mnt/d/proj', to: 'D:\\proj-new' },
    ],
  },
  workspace: {
    registry: resolvePath(join(out, 'workspace.json')),
    sessionsRoot: resolvePath(sessionsRoot),
  },
  attachments: {
    source: resolvePath(join(out, 'attachments')),
    target: resolvePath(join(out, 'attachments')),
  },
  usage: {
    sources: [resolvePath(join(out, 'usage.json'))],
    target: resolvePath(join(out, 'usage.json')),
  },
}, null, 2) + '\n')

console.log(JSON.stringify({
  out,
  sessions: [
    { file: 'sessions/--D-proj-old--/session-0001/session.v4.jsonl.zstd', cwd: s1.header.cwd, frames: s1.frames, bytes: s1.buffer.length, sha256: sha(s1.buffer) },
    { file: 'sessions/--mnt-d-proj--/session-0002/session.v3.jsonl.zstd', cwd: s2.header.cwd, frames: s2.frames, bytes: s2.buffer.length, sha256: sha(s2.buffer) },
    { file: 'sessions/--D-proj-new--/session-0003/session.v4.jsonl.zstd', cwd: s3.header.cwd, frames: s3.frames, bytes: s3.buffer.length, sha256: sha(s3.buffer) },
  ],
  workspace: 'workspace.json',
  attachments: 2,
}, null, 2))
