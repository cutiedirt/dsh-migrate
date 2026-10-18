# Changelog

本项目的所有重要变更都记录在此。版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## v0.2.0 — 2026-10-17

### 新增

- **`memory` 步骤**：两个 meow-memory 风格 SQLite 库的离线并集合并。
  - 按主键取并集；两边都有时按“更新标记”列取较新者整行替换。
  - `AUTOINCREMENT` 主键表改用「其余列的组合」做键、插入不写 `id`——两个库各自从 1 编号，按 id 并集会并掉不同记录。
  - 不做任何 DDL：目标缺表就跳过并告警，绝不动 schema。
  - 源只读打开；目标先备份进 manifest；结束时 `wal_checkpoint(TRUNCATE)` 让目标自包含。
  - 目标位于 `/mnt/*`（drvfs/9p）时**直接拒绝**——该文件系统上 SQLite 会 `disk I/O error`。

### 验收

- `node --test "test/*.test.mjs"`：11 pass / 1 skip（`/mnt` 拒绝那条在 Windows 上跳过），连跑两次一致。
- 真实记忆库副本合并：11 张表、`+2` 插入 / `~1` 替换；重跑 0 变更；`integrity_check=ok`、`missing=0`。

## v0.1.0 — 2026-10-17

### 新增

- **CLI**：`dsh-migrate doctor | plan | apply | verify | rollback`，默认 dry-run，`--write` 才落盘。
- **`sessions` 步骤**：只重编码会话日志第一帧的 `cwd`，其余帧原字节拼接并断言**尾部逐字节一致**；幂等。
- **`workspace` 步骤**：把磁盘上存在、却未登记的会话补登记进 `workspace.json`（从不删除注册项）。
- **`attachments` 步骤**：补齐内容寻址附件对象并校验哈希。
- **`usage` 步骤**：按来源分桶合并用量账本（`bySource → totals`），重跑逐字节不变。
- **manifest**：每步落盘前备份并记录 sha256，`rollback` 不依赖推断。
- **零依赖**：只用 `node:fs` / `node:zlib` / `node:path` / `node:crypto` / `node:test` / `node:sqlite`；要求 Node ≥ 22.13。

### 验收

- `node --test "test/*.test.mjs"`：9 pass / 0 fail（两次一致）。
- CLI 端到端（夹具）：`plan` → dry-run → `--write` → 重跑 0 变更 → `verify`：`badFrames=0`、`mismatched=0`。
- **真实会话日志**（只读，改写只落临时副本）：7.16 MB / 2,120 帧、7.33 MB / 2,767 帧、5.09 MB / **14,478 帧**（v0 无版本老日志）——帧数与行数不变、尾部逐字节一致、原件 SHA256 未变。
- 真实 `sessions` 根只读 `plan`：171 个 `.zstd`，`unreadable=0`。

### 已知边界

- 插件移植不在工具范围内（DSH 私有契约逐代变化），只提供方法论文档。
- 版本升级请用官方 `dsh-session-format-vX-to-vY` 迁移器；本工具只做同代搬运。
