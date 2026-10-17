# 任务书 P1：zstd 帧编解码 + sessions 步骤 + 测试

> 执行者：Codex。仓库：`D:\dshworkspace\dsh-migrate`（Windows 路径）。
> 只允许修改/新增下面「允许改动」列出的文件，**不要动** `bin/`、`lib/util.mjs`、
> `lib/config.mjs`、`lib/manifest.mjs`、`docs/`、`test/make-fixtures.mjs`、`package.json`。

## 0. 先建产物再干活

动手前先创建 `D:\dsh-ref\.codex-tasks\report-p1-frames.md`，**每完成一节就追加**：
已改文件、关键决策、跑过的命令与结果。被中断也要留下部分产出。

## 1. 背景（必须理解，否则会写错）

DSH 会话日志 `session.<v>.jsonl.zstd` 是**多帧** zstd 流：

```
帧0      = 一行 JSON（会话 header：{"type":"session","version":4,"id":…,"cwd":…,…}）
帧1..N   = 之后每次 append 的一批 JSONL 事件（每帧多行）
```

Node 的 `zstdDecompressSync(wholeFile)` **只解第一帧**就返回。曾经有人"整文件解压再重压"，
把 111 份会话写成只剩 header（473KB → 201B），用户点开会话直接 `SessionFormatError`。

因此本任务的核心是：**能精确切帧**、**只重编码第一帧**、**断言其余字节原样保留**。

## 2. 需要实现的东西

### A. `lib/frames.mjs`（把现有 stub 换成真实实现，签名与 JSDoc 保持不变）

导出：`scanFrames(buf)`、`decodeFrames(buf)`、`encodeFrame(text)`、`readHeader(buf)`、
`rewriteFirstFrame(buf, patch)`、常量 `FRAME_MAGIC`。

**切帧必须靠自己解析帧结构（不要靠 `bytesWritten` 或"能不能解压"来试探）**：

Zstd 帧格式（小端）：
1. `Magic_Number` 4 字节 = `0xFD2FB528`（字节序 `28 B5 2F FD`）。
   - 若为 `0x184D2A50..0x184D2A5F` → **skippable frame**：4 字节 magic + 4 字节 size + size 字节 payload，整帧跳过。
2. `Frame_Header_Descriptor`（FHD）1 字节：
   - bit7-6 `Frame_Content_Size_flag`（FCS_flag）
   - bit5 `Single_Segment_flag`
   - bit3 `Content_Checksum_flag`
   - bit1-0 `Dictionary_ID_flag`
3. 若 `Single_Segment_flag == 0`：`Window_Descriptor` 1 字节。
4. `Dictionary_ID`：按 flag 取 0 / 1 / 2 / 4 字节（0→0；1→1；2→2；3→4）。
5. `Frame_Content_Size`：
   - `Single_Segment_flag == 1`：FCS_flag=0 → 1 字节；1 → 2 字节；2 → 4 字节；3 → 8 字节
   - `Single_Segment_flag == 0`：FCS_flag=0 → **0 字节**；1 → 2；2 → 4；3 → 8
6. Blocks 循环：每块 3 字节 `Block_Header`：
   - bit0 `Last_Block`；bit1-2 `Block_Type`（0=Raw, 1=RLE, 2=Compressed, 3=Reserved）
   - bit3-23 `Block_Size`
   - 数据长度：Raw → Block_Size；RLE → 1；Compressed → Block_Size
   - 遇到 `Last_Block == 1` 结束本帧。
7. 校验边界不得越界；越界 → 抛带文件偏移的错误（`code = 'EZSTD_TRUNCATED'`）。

**`scanFrames(buf)`** 返回 `{ frames:[{start,end,skippable}], bytes, trailing }`；
`trailing` 必须为 0，否则视为截断（`decodeFrames` 遇到 trailing>0 抛错）。

**`decodeFrames(buf)`**：逐帧 `zstdDecompressSync(buf.subarray(start,end))` 后拼接成字符串。

**`readHeader(buf)`**：解第一帧 → 取第一行 → `JSON.parse`，返回 `{header, rawFirstLine, frameEnd}`。

**`rewriteFirstFrame(buf, patch)`**：
- 解帧0 → 取首行 → parse → `Object.assign(header, patch)` → `JSON.stringify` + `'\n'`；
- 新帧0 = `zstdCompressSync(新文本)`；
- 新 buffer = `Buffer.concat([新帧0, buf.subarray(frame0End)])`；
- **断言**：`新buffer.subarray(新帧0.length)` 与 `buf.subarray(frame0End)` 逐字节相等，不等则抛错；
- 返回 `{buffer, before, after, frameEnd}`。

### B. `lib/steps/sessions.mjs`（把 stub 换成真实实现）

配置段（`sectionOf(cfg,'sessions')`）：

```json
{ "root": "D:\\x\\sessions", "cwdMap": [ { "from": "D:\\proj-old", "to": "D:\\proj-new" } ] }
```

- 发现：`root/<projectKeyDir>/<sessionDir>/*.jsonl.zstd`（**只认以 `.zstd` 结尾的**，`session.v3/v4` 都要）。
- 匹配：按 `cwdMap` 里 `from` 与 header.cwd **完全相等**（大小写敏感，路径不做规范化）。
- `plan(section,{log})` → `{counts:{files,toRewrite,alreadyOk,skippedNonZstd,unreadable},actions:[{file,from,to,frameCount}]}`，**只读**。
- `apply(section,{log,manifest,write})`：
  - 对每个待改文件：`backupFile(manifest, file)` → `rewriteFirstFrame` → 写回（`write===false` 时不写，只统计 `wouldChange`）；
  - 逐文件 try/catch，失败收集进 `errors`，**不中断整批**；
  - 返回 `{changed, wouldChange, unchanged, errors:[{file,message}]}`；
  - 写完必须**回读**：重新 `readHeader` 确认 cwd 已是目标；不一致记 `errors`。
- `verify(section,{log})` → `{files, decodedOk, badFrames, cwdHistogram, mismatched:[{file,cwd,expect}]}`。

### C. `test/frames.test.mjs`（用 `node --test`）

必须覆盖：
1. 夹具（`test/make-fixtures.mjs` 生成的三份）能被 `scanFrames` 切成 **4 帧**、`decodeFrames` 行数正确；
2. `rewriteFirstFrame` 后：header.cwd 已变、**尾部字节完全一致**、帧数不变；
3. `readHeader` 对 `session.v3` / `session.v4` 都能读；
4. 截断文件（把最后 5 字节砍掉）→ `scanFrames` 报 `trailing>0` / `decodeFrames` 抛错；
5. 非 zstd 文件（随便一段文本）→ 抛错，错误码可识别；
6. `sessions.apply` 在夹具上：`write:false` 时零改动、`write:true` 后 `session-0001`/`session-0002` 的 cwd 被改写，
   `session-0003`（本来就匹配）计入 `unchanged`；**重跑一次 = 0 变更（幂等）**；
7. 改写后 `verify` 的 `badFrames === 0` 且 `mismatched.length === 0`。

## 3. 验收命令（你必须自己跑，并把输出贴进报告）

```powershell
cd D:\dshworkspace\dsh-migrate
node test/make-fixtures.mjs test\fixtures
node --test test\
node bin\dsh-migrate.mjs doctor -c test\fixtures\migrate.json   # 若该文件不存在，用 test 里构造的临时配置代替并说明
```

（`test/fixtures/` 被 `.gitignore` 忽略，属正常。）

## 4. 约束

- **零依赖**：只用 `node:fs`、`node:zlib`、`node:path`、`node:crypto`、`node:test`、`node:assert`。
- 不联网、不装包、不 `npm install`。
- 不改 `bin/`、`package.json`、`docs/`、`lib/util.mjs`、`lib/config.mjs`、`lib/manifest.mjs`、`test/make-fixtures.mjs`。
- 不引入 TypeScript、不引入 lint 配置。
- 代码注释用中文，简洁；关键处说明"为什么"（尤其帧格式解析与逐字节断言）。
- 若某条实现与上面规格冲突，**以规格为准**；若规格本身有误，**在报告里指出并给出你的处理**，不要静默改口径。

## 5. 报告格式（写入 `D:\dsh-ref\.codex-tasks\report-p1-frames.md`）

```
# P1 报告
## 状态：DONE / PARTIAL / BLOCKED
## 改动文件（逐条：文件 → 做了什么）
## 关键实现点（帧解析、逐字节断言、幂等）
## 跑过的命令与原始输出（贴关键行）
## 与规格的偏差（如有）
## 未完成/风险
```
