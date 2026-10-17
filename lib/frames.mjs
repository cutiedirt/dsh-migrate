/**
 * zstd frame 级读写 —— 本工具最关键的一块。
 *
 * 背景（真实事故）：DSH 会话日志 `session.<v>.jsonl.zstd` 是**多帧** zstd 流：
 *   帧0 = JSONL 第一行（会话 header：type/version/id/createdAt/cwd/…）
 *   帧1..N = 之后每次 append 的一批事件
 * Node 的 `zstdDecompressSync(整个文件)` **只解第一帧**就返回，所以
 * 「整文件解压再重压」= 把历史写成只剩 header。实测曾把 111 份会话从 473KB 写成 201B。
 *
 * 因此：任何改写都必须**按帧**进行，并且断言「未改动的尾字节与原文件逐字节一致」。
 *
 * 规范依据：RFC 8878（Zstandard Compression Format）。
 *
 * @module lib/frames
 */
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'

/** zstd 单帧 magic（小端读作 0xFD2FB528） */
export const FRAME_MAGIC = 0xfd2fb528
/** skippable frame magic 范围：0x184D2A50 .. 0x184D2A5F */
export const SKIPPABLE_MAGIC_BASE = 0x184d2a50

function frameError(code, message, offset = 0) {
  const e = new Error(`${message}（offset=${offset}）`)
  e.code = code
  e.offset = offset
  return e
}

function need(buf, offset, size, what) {
  if (offset + size > buf.length) throw frameError('EZSTD_TRUNCATED', `${what} 超出文件边界`, offset)
}

function isSkippableMagic(magic) {
  return magic >= SKIPPABLE_MAGIC_BASE && magic <= SKIPPABLE_MAGIC_BASE + 0x0f
}

/**
 * 解析一个 zstd 帧的结构边界；**不依靠解压 API 的 bytesWritten**。
 *
 * Frame_Header_Descriptor 的位布局（RFC 8878）：
 *   bit 7-6 Frame_Content_Size_flag
 *   bit 5   Single_Segment_flag
 *   bit 4   Unused_bit
 *   bit 3   Reserved_bit
 *   bit 2   Content_Checksum_flag   ← 注意是 bit2（0x04），bit3 不是它
 *   bit 1-0 Dictionary_ID_flag
 */
function scanOne(buf, start) {
  need(buf, start, 4, '帧 magic')
  const magic = buf.readUInt32LE(start)
  if (isSkippableMagic(magic)) {
    need(buf, start + 4, 4, 'skippable frame size')
    const size = buf.readUInt32LE(start + 4)
    need(buf, start, 8 + size, 'skippable frame payload')
    return { start, end: start + 8 + size, skippable: true }
  }
  if (magic !== FRAME_MAGIC) return null

  let p = start + 4
  need(buf, p, 1, 'Frame Header Descriptor')
  const fhd = buf[p++]
  const fcsFlag = fhd >>> 6
  const singleSegment = (fhd & 0x20) !== 0
  const contentChecksum = (fhd & 0x04) !== 0
  const dictFlag = fhd & 0x03

  if (!singleSegment) { need(buf, p, 1, 'Window Descriptor'); p++ }
  const dictBytes = [0, 1, 2, 4][dictFlag]
  need(buf, p, dictBytes, 'Dictionary ID')
  p += dictBytes
  // Single_Segment=1 时 FCS 必存在（fcsFlag=0 → 1 字节）；否则 fcsFlag=0 → 无 FCS
  const fcsBytes = singleSegment ? [1, 2, 4, 8][fcsFlag] : [0, 2, 4, 8][fcsFlag]
  need(buf, p, fcsBytes, 'Frame Content Size')
  p += fcsBytes

  for (;;) {
    need(buf, p, 3, 'Block Header')
    const bh = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16)
    p += 3
    const last = (bh & 1) !== 0
    const type = (bh >>> 1) & 0x03
    const size = bh >>> 3
    if (type === 3) throw frameError('EZSTD_INVALID', '保留的 zstd block type', p - 3)
    const payload = type === 1 ? 1 : size // RLE 块只占 1 字节
    need(buf, p, payload, 'Block payload')
    p += payload
    if (last) {
      if (contentChecksum) { need(buf, p, 4, 'Content checksum'); p += 4 }
      return { start, end: p, skippable: false }
    }
  }
}

/**
 * 扫描缓冲区内所有帧的边界。
 * @param {Buffer} buf
 * @returns {{frames: Array<{start:number,end:number,skippable:boolean}>, bytes:number, trailing:number}}
 *   `trailing` = 无法识别为帧的尾字节数（应恒为 0；>0 表示文件被截断或非 zstd）
 */
export function scanFrames(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf)
  const frames = []
  let offset = 0
  while (offset < buf.length) {
    const frameStart = offset
    let frame
    try {
      frame = scanOne(buf, offset)
    } catch (e) {
      // 末帧只写了一部分时，把其起点之后都算作 trailing，交给调用方判定截断
      if (e?.code === 'EZSTD_TRUNCATED') {
        return { frames, bytes: frameStart, trailing: buf.length - frameStart }
      }
      throw e
    }
    if (!frame) break
    frames.push(frame)
    offset = frame.end
  }
  return { frames, bytes: offset, trailing: buf.length - offset }
}

/**
 * 逐帧解压并拼接（等价于"读到 EOF"），返回完整文本。
 * @param {Buffer} buf
 * @returns {string}
 */
export function decodeFrames(buf) {
  const scan = scanFrames(buf)
  if (scan.trailing > 0) throw frameError('EZSTD_TRUNCATED', '帧后存在无法识别的尾字节', scan.bytes)
  const chunks = []
  for (const frame of scan.frames) {
    if (frame.skippable) continue
    try {
      chunks.push(zstdDecompressSync(buf.subarray(frame.start, frame.end)))
    } catch (cause) {
      const e = new Error(`zstd 帧解压失败（offset=${frame.start}）：${cause.message}`)
      e.code = 'EZSTD_DECODE'
      e.offset = frame.start
      e.cause = cause
      throw e
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * 压缩一段文本为单帧。
 * @param {string} text
 * @returns {Buffer}
 */
export function encodeFrame(text) {
  return zstdCompressSync(Buffer.from(text, 'utf8'))
}

/**
 * 读取第一帧并解析出会话 header 对象。
 * @param {Buffer} buf
 * @returns {{header: object, rawFirstLine: string, frameEnd: number}}
 */
export function readHeader(buf) {
  const scan = scanFrames(buf)
  if (scan.frames.length === 0) throw frameError('EZSTD_TRUNCATED', '缺少完整的第一帧', scan.bytes)
  const first = scan.frames[0]
  if (first.skippable) throw frameError('EZSTD_INVALID', '第一帧不能是 skippable frame', first.start)
  let text
  try {
    text = zstdDecompressSync(buf.subarray(first.start, first.end)).toString('utf8')
  } catch (cause) {
    const e = new Error(`第一帧解压失败（offset=${first.start}）：${cause.message}`)
    e.code = 'EZSTD_DECODE'
    e.offset = first.start
    e.cause = cause
    throw e
  }
  const nl = text.indexOf('\n')
  const rawFirstLine = nl < 0 ? text : text.slice(0, nl)
  if (!rawFirstLine) throw frameError('EZSTD_HEADER', '第一帧缺少 header 行', first.start)
  let header
  try {
    header = JSON.parse(rawFirstLine)
  } catch (cause) {
    const e = new Error(`header JSON 无效：${cause.message}`)
    e.code = 'EZSTD_HEADER'
    e.cause = cause
    throw e
  }
  return { header, rawFirstLine, frameEnd: first.end }
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
  const info = readHeader(buf)
  const before = info.header
  const after = Object.assign({}, before, patch)
  const newFrame = encodeFrame(JSON.stringify(after) + '\n')
  const tail = buf.subarray(info.frameEnd)
  const buffer = Buffer.concat([newFrame, tail])
  const newTail = buffer.subarray(newFrame.length)
  if (newTail.length !== tail.length || !newTail.equals(tail)) {
    const e = new Error('重写第一帧后尾部字节发生变化')
    e.code = 'EZSTD_TAIL_CHANGED'
    throw e
  }
  return { buffer, before, after, frameEnd: info.frameEnd }
}
