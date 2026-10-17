/**
 * zstd frame 级读写 —— 本工具最关键的一块。
 *
 * 背景（真实事故）：DSH 会话日志 `session.<v>.jsonl.zstd` 是**多帧** zstd 流：
 *   帧0 = JSONL 第一行（会话 header：type/version/id/createdAt/cwd/…）
 *   帧1..N = 之后每次 append 的一批事件
 * Node 的 `zstdDecompressSync(整个文件)` **只解第一帧**就返回，所以
 * 「整文件解压再重压」= 把历史写成只剩 header。实测曾把 111 份会话从 473KB 写成 201B。
 *
 * 因此：任何改写都必须**按帧**进行，并且断言"未改动的尾字节与原文件逐字节一致"。
 *
 * @module lib/frames
 */

/** zstd 单帧 magic（小端读作 0xFD2FB528） */
export const FRAME_MAGIC = 0xfd2fb528
/** skippable frame magic 范围：0x184D2A50 .. 0x184D2A5F */
export const SKIPPABLE_MAGIC_BASE = 0x184d2a50

/** 本模块尚未实现时抛出的错误码（P1 任务书要求替换为真实实现） */
export const NOT_IMPLEMENTED = 'ENOTIMPLEMENTED_FRAMES'

/**
 * 扫描缓冲区内所有帧的边界。
 * @param {Buffer} buf
 * @returns {{frames: Array<{start:number,end:number,skippable:boolean}>, bytes:number, trailing:number}}
 *   `trailing` = 无法识别为帧的尾字节数（应恒为 0；>0 表示文件被截断或非 zstd）
 */
export function scanFrames(buf) {
  throw new Error(`${NOT_IMPLEMENTED}: scanFrames 由 P1 实现`)
}

/**
 * 逐帧解压并拼接（等价于"读到 EOF"），返回完整文本。
 * @param {Buffer} buf
 * @returns {string}
 */
export function decodeFrames(buf) {
  throw new Error(`${NOT_IMPLEMENTED}: decodeFrames 由 P1 实现`)
}

/**
 * 压缩一段文本为单帧。
 * @param {string} text
 * @returns {Buffer}
 */
export function encodeFrame(text) {
  throw new Error(`${NOT_IMPLEMENTED}: encodeFrame 由 P1 实现`)
}

/**
 * 读取第一帧并解析出会话 header 对象。
 * @param {Buffer} buf
 * @returns {{header: object, rawFirstLine: string, frameEnd: number}}
 */
export function readHeader(buf) {
  throw new Error(`${NOT_IMPLEMENTED}: readHeader 由 P1 实现`)
}

/**
 * 只重写第一帧：`patch` 合并进 header 对象后重新序列化、重新压缩，
 * 其余帧**原字节拼接**（必须逐字节一致）。
 *
 * @param {Buffer} buf 原文件
 * @param {object} patch 例如 `{ cwd: 'D:\\new' }`
 * @returns {{buffer: Buffer, before: object, after: object, frameEnd: number}}
 */
export function rewriteFirstFrame(buf, patch) {
  throw new Error(`${NOT_IMPLEMENTED}: rewriteFirstFrame 由 P1 实现`)
}
