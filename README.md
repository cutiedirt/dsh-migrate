# dsh-migrate

把一个 **DSH（DeepSeek Harness）宿主**的本地状态，安全地搬到另一个宿主 / 另一台机器：
设定、凭据、工作区注册表、历史会话、附件、用量账本、以及（可选）meow-memory 记忆库。

> **非官方工具。** 只操作磁盘上的公开格式，不调用 DSH 私有 API，不联网，不碰凭据内容。
> 作者与本工具与 DeepSeek 官方无关。

## 为什么需要它

手工搬 DSH 数据有三类"静默损坏"，每一类都真实发生过：

| 坑 | 后果 |
|---|---|
| 会话日志是**多帧 zstd**，用 `zstdDecompressSync(整文件)` 只解第一帧 | "整文件解压再重压" = 历史全丢（实测把 111 份会话写成只剩 header） |
| 会话归属取决于**日志第一帧 header 里的 `cwd`** | 复制到新宿主后，工作区里一个会话都不显示 |
| 工作区注册表 / 归档列表与磁盘不同步 | 会话文件在磁盘上，侧栏里永远看不到 |

`dsh-migrate` 把这三件事做成**带校验、可回滚、幂等**的步骤。

## 快速开始

```bash
node bin/dsh-migrate.mjs doctor  -c migrate.json      # 体检两端环境，只读
node bin/dsh-migrate.mjs plan    -c migrate.json      # 只读：列出将要改什么、多少字节
node bin/dsh-migrate.mjs apply   -c migrate.json --step sessions
node bin/dsh-migrate.mjs verify  -c migrate.json      # 出机器可读报告
node bin/dsh-migrate.mjs rollback -c migrate.json     # 按 manifest 还原
```

**默认 dry-run**：不给 `--write` 时，`apply` 只打印计划，不落盘。

## 步骤

| 步骤 | 作用 | 状态 |
|---|---|---|
| `sessions` | 按帧改写会话日志第一帧的 `cwd`（尾部逐字节保留），并校验 | v0.1 |
| `workspace` | 对齐 `storages/workspace.json` 的 `sessionIds` / `archivedSessionIds` | v0.1 |
| `attachments` | 补齐内容寻址附件对象（`attachments/v1/objects/…`） | v0.1 |
| `usage` | 按天并集合并用量账本 | v0.1 |
| `memory` | meow-memory 记忆库（SQLite）按 id 并集合并 | v0.2 |
| `preset` | 校验智能体预设是否被新宿主识别（声明行形式） | v0.2 |

## 安全红线

1. **dry-run 默认**；`--write` 才落盘，每步先备份。
2. **永不删除原件**；只写副本，manifest 记录每一个字节的去向。
3. **幂等**：重跑零变更；中断可续。
4. 会话日志**只重编码第一帧**，并断言"尾部逐字节一致"；不一致立即中止。
5. **禁止把 SQLite 库放在 `/mnt/*`（drvfs/9p）**给 WSL 侧使用——实测会 `disk I/O error` 甚至损坏。
6. 任何"看起来成功"都要有**机器可读的校验报告**（`verify` 输出 JSON）。

细节见 [docs/DESIGN.md](docs/DESIGN.md) 与 [docs/SAFETY.md](docs/SAFETY.md)。

## 测试

```bash
node test/make-fixtures.mjs test/fixtures     # 生成合成会话/注册表夹具
node --test test/                              # 跑全部测试
```

夹具全部是**合成数据**，仓库内不含任何真实会话、记忆或凭据。

## License

MIT
