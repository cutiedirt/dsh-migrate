# 安全红线

每一条都来自真实事故，不是假想。

## 1. 会话日志：只重编码第一帧

`zstdDecompressSync(整个文件)` **只解第一帧**。多帧日志如果"整文件解压再重压"，
会退化成只剩 header（实测：111 份会话从 473KB 变成 201B，用户点开会话直接报
`SessionFormatError`）。

**要求**：按帧扫描 → 只改帧0 → `新帧0 + 原文件.subarray(frame0End)` 拼接 →
断言尾部逐字节一致。

## 2. 改写后必须逐字节比对未改动区域

只比较"解压后的文本"不够——压缩器实现差异会引入字节漂移。必须比字节。

## 3. 绝不删除原件

只写副本、只追加备份。回滚依赖 manifest，不依赖"我记得改过什么"。

## 4. SQLite 库不要放在 `/mnt/*`（drvfs/9p）

实测（2026-10-06）：WSL 侧在 `/mnt/d/...` 上打开 WAL 模式的 SQLite 会直接
`disk I/O error`，并发写还会导致 `database disk image is malformed`（单页损坏）。
同一文件拷到 ext4 上一切正常。

**要求**：`memory` 步骤检测到目标在 `/mnt/*` 时**拒绝执行**并给出解释。

## 5. 双宿主不要共享同一个记忆库文件

两个进程同时写同一个 SQLite（尤其跨 9p/drvfs）= 迟早损坏。
一个宿主一个库；需要合并时用 `memory` 步骤做**离线并集合并**。

## 6. 装插件前完全退出应用；改源码后必须 `remove` + `add`

profile 在 `nodeLinker: hoisted` 下装的是**副本**，不是软链。只改源码不重装 = 白改。
（这条属于插件移植，不在本工具范围内，但会写进文档避免误导。）

## 7. 不猜版本契约

DSH 的内部格式随版本变化（会话 v3/v4、插件契约、预设声明形式）。
工具只做**格式层面的搬运**；版本升级请用官方迁移器（`dsh-session-format-vX-to-vY`），
本工具不代替它。

---

## 附录：`projectKey(cwd)` 编码规则

（用于校验"目录名与 cwd 是否自洽"）

- `/`、`\`、`:` 都算分隔符，**连续分隔符折成一个 `-`**；
- 其余字符只保留 `[A-Za-z0-9._-]`，其它码位写成 `~XXXX`（4 位大写十六进制）；
- 去掉开头 `-`，用 `--` 包裹，截断到 251 字符；为空则用 `root`。

例：

| cwd | 目录名 |
|---|---|
| `/mnt/d/dshprograming` | `--mnt-d-dshprograming--` |
| `D:\dshprograming` | `--D-dshprograming--` |
| `C:\Users\Administrator\Documents\deepseek-harness\default-workspace` | `--C-Users-Administrator-Documents-deepseek-harness-default-workspace--` |

注意：`/mnt/d/dshprograming` 与 `D:\dshprograming` 是**两个不同字符串**，互不相等。
