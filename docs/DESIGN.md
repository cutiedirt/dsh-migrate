# 设计说明

## 目标

把「一个 DSH 宿主的本地状态」搬到另一个宿主 / 另一台机器，并且**可验证、可回滚、可重复**。

不做的事：不远程访问、不联网、不读凭据内容、不自动改插件源码。

## 为什么是按"步骤"而不是"一键"

一次迁移包含若干**风险等级完全不同**的操作：

| 步骤 | 风险 | 失败后果 |
|---|---|---|
| `sessions` 改写 cwd | **高** | 写坏会话日志 = 历史丢失（不可逆） |
| `workspace` 对齐注册表 | 中 | 会话在磁盘但侧栏不可见 |
| `attachments` 补对象 | 低 | 图片/附件裂开 |
| `usage` 合并账本 | 低 | 用量统计偏差 |
| `memory` 合并 SQLite 库 | **中高** | 记忆丢失/重复 |

所以 CLI 只提供 `plan / apply --step X / verify / rollback`，让用户**一次只推进一个步骤**并逐步验收。这也是实际手工迁移时验证过的节奏。

## 数据模型

### 会话日志

`<sessionsRoot>/<projectKeyDir>/<sessionDir>/session.<v>.jsonl.zstd`，**多帧 zstd**：

```
帧0   = 一行 JSON（header：type/version/id/createdAt/cwd/agentPreset/…）
帧1..N = 每次 append 的一批 JSONL 事件
```

- 归属判定依赖 header 的 `cwd`（新宿主按 `sessionPath(id) === workspace.path` 过滤）；
- 目录名与 `cwd` 是两套编码（`projectKey(cwd)` 的规则见 docs/SAFETY.md 附录）；
- **只允许改第一帧**，其余帧必须原字节保留。

### 工作区注册表

`<DSH_HOME>/storages/workspace.json`：

```json
{
  "unit":  { "name": "…", "version": 1 },
  "global": { "initialized": true, "defaultWorkspaceId": "…",
              "workspaceIds": ["…"], "archivedSessionIds": ["…"], "pinnedSessionIds": [] },
  "tables": { "workspaces": { "<id>": { "path": "D:\\proj", "sessionIds": ["session-…"] } } }
}
```

### 记忆库

`<workspace>/.dsh-meow/memory.db`（SQLite，WAL）。合并语义：按 `id` 取并集，
两边都有时取 `updated_at` 较新者；**源库只读打开**。

## 幂等与续跑

- 每个步骤自身幂等：`apply` 重复执行应为 0 变更；
- manifest 记录"每个被改文件的原字节备份 + sha256"，因此 `rollback` 不依赖任何推断；
- 中断后重跑：已匹配的文件会被识别为 `unchanged`。

## 校验（verify）

每个步骤产出结构化报告，至少包含：

- `sessions`：文件数、可解码数、`badFrames`、cwd 分布、期望 vs 实际不匹配数；
- `workspace`：注册表 sessionIds 数、磁盘目录数、未注册数、注册但无文件数；
- `attachments`：对象数、缺失对象、哈希不匹配数；
- `usage`：天数、总条目；
- `memory`：`integrity_check`、各表行数。

报告落 `run/<stamp>-verify.json`，便于 CI 或人工 diff。
