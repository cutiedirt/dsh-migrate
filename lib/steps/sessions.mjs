/**
 * 步骤：sessions —— 按帧改写会话日志第一帧的 cwd，使会话在新宿主的工作区下可见。
 *
 * 为什么必须做：会话归属由日志第一帧 header 的 `cwd` 决定，新宿主按
 * `sessionPath(id) === workspace.path` 过滤；只复制文件不改 cwd，工作区里一个会话都不显示。
 *
 * 契约（P1 实现）：
 *   plan(section, { log })            -> { actions[], counts }        只读
 *   apply(section, { log, manifest, write }) -> { changed, unchanged, skipped, errors }
 *   verify(section, { log })          -> { files, decodedOk, badFrames, cwdHistogram, mismatched }
 *
 * 约束：
 *   - 只重编码第一帧；其余帧原字节拼接，并断言逐字节一致；
 *   - 幂等：已匹配的文件计为 unchanged；
 *   - 任何解码失败**不**中止整批，逐文件记录进 errors，交给 verify 汇总。
 */
import { NOT_IMPLEMENTED } from '../frames.mjs'

export const step = 'sessions'

export async function plan(_section, { log } = {}) {
  log?.warn('sessions: 尚未实现（P1）')
  throw new Error(`${NOT_IMPLEMENTED}: sessions.plan 由 P1 实现`)
}

export async function apply(_section, _ctx = {}) {
  throw new Error(`${NOT_IMPLEMENTED}: sessions.apply 由 P1 实现`)
}

export async function verify(_section, _ctx = {}) {
  throw new Error(`${NOT_IMPLEMENTED}: sessions.verify 由 P1 实现`)
}
