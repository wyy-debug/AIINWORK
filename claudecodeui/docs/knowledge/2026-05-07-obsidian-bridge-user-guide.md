# Argus Obsidian Bridge 使用文档

Updated: 2026-05-07

Argus Obsidian Bridge 用于把 Argus 生成的知识类结果写入本机 Obsidian vault，并在对话时按用户授权目录读回少量上下文。第一版只支持本机 Obsidian Desktop，不依赖第三方 Local REST API。

## 适用场景

- 项目总结、review notes、计划、架构决策写入项目知识库。
- 日记、阅读、人物、想法写入第二大脑。
- AI memory、偏好、决策索引写入 AI 可读记忆库。
- Obsidian 暂时不可达时，内容 fallback 到项目 `docs/knowledge/<mode>/`，不丢文档。

## 推荐安装方式: Argus 设置页

给普通用户使用时，优先走 Argus UI，不需要他们打开终端:

```text
Settings -> Runtime -> Argus Bridge for Obsidian
```

1. 点击 `Refresh vaults`，Argus 会读取 Obsidian Desktop 的本机 vault 列表。
2. 选择一个 vault；如果没识别到，也可以手动粘贴 vault 路径。
3. 点击 `Install plugin to vault`。
4. 回到 Obsidian，重启 Obsidian 或重新加载 community plugins。
5. 在 Argus 点 `Test connection`。

安装器会自动完成:

- 复制插件发布文件到 `.obsidian/plugins/argus-bridge/`
- 生成或复用 pairing token
- 把 `argus-bridge` 写入 `.obsidian/community-plugins.json`
- 自动保存 Argus 侧 endpoint 和 token

## 命令行安装插件

默认本机 smoke vault:

```powershell
C:\Users\yckui\Documents\note\self
```

命令行安装:

```powershell
npm run obsidian:install-bridge -- --vault "C:\Users\yckui\Documents\note\self"
```

脚本会把插件文件复制到:

```text
C:\Users\yckui\Documents\note\self\.obsidian\plugins\argus-bridge\
```

复制内容包括 `manifest.json`、`main.js`、`core.js`、`core.cjs`、`styles.css`，并生成或复用插件的配对 token。

安装后在 Obsidian 中打开:

```text
Settings -> Community plugins -> Argus Bridge for Obsidian
```

如果 Obsidian 已经打开，重启 Obsidian 或重新加载 community plugins。

## 给别人用怎么交付

推荐发两样东西:

1. Argus 应用本体。
2. Obsidian 插件 release zip: `dist/obsidian-bridge/argus-bridge-<version>.zip`。

如果对方使用新版 Argus，最简单:

```text
打开 Argus -> Settings -> Runtime -> Argus Bridge for Obsidian -> Refresh vaults -> Install plugin to vault
```

如果对方只拿到了插件 zip:

1. 解压 zip。
2. 把里面的 `manifest.json`、`main.js`、`core.js`、`core.cjs`、`styles.css` 放到:

```text
<vault>/.obsidian/plugins/argus-bridge/
```

3. 在 Obsidian 中启用 community plugins，并启用 `Argus Bridge for Obsidian`。
4. 复制插件 token 到 Argus Settings。
5. 点 `Test connection`。

注意: 插件只支持 Obsidian Desktop 本机运行，移动端和远程 vault 暂不支持。

## 配对 Argus

如果用 Settings 页的 `Install plugin to vault`，Argus 会自动保存 token，通常不需要手动复制。手动安装 zip 或脚本安装后，可以在 Obsidian 插件设置页中复制 token，然后到 Argus:

```text
Settings -> Runtime -> Argus Bridge for Obsidian
```

推荐配置:

| 设置 | 推荐值 |
| --- | --- |
| Enable Obsidian bridge | 开启 |
| Plugin endpoint | `http://127.0.0.1:27177` |
| Pairing token | 粘贴插件 token |
| Auto-export knowledge results | 开启 |
| Fallback to project docs | 开启 |
| Enable AI memory readback | 按需开启 |
| Max results | `5` |
| Readable vault folders | `Argus/Projects`, `Argus/AIMemory`, `Argus/SecondBrain` |

点 `Save bridge` 后，点 `Test connection`。成功时会显示 vault 名称和插件版本，例如:

```text
Vault: self
Plugin version: 0.1.1
Connected to self.
```

## 三种写入模式

| Mode | Obsidian 目录 | 用途 |
| --- | --- | --- |
| `project-knowledge` | `Argus/Projects/<project>/` | 项目总结、review notes、计划、决策、会话记录 |
| `second-brain` | `Argus/SecondBrain/<YYYY>/` | 日记、阅读、人物、想法、长期主题 |
| `ai-memory` | `Argus/AIMemory/<project-or-General>/` | 给 AI 读回的事实、偏好、决策索引 |

项目知识库会自动维护:

```text
Argus/Projects/<project>/Index.md
```

这个文件作为轻量 MOC，链接项目总结、计划、决策和会话记录。

## 自动导出

开启 `Auto-export knowledge results` 后，Argus 只自动导出知识类 artifacts:

- `review-notes`
- `automation-run`
- `action-log`
- `project-summary`
- `session-summary`
- `architecture-decision`
- `decision`
- `plan`
- `ai-memory`
- `knowledge`

下面这些默认不会自动塞进 vault，但仍可手动发送:

- browser screenshot
- visual preview
- raw log
- image/video
- 普通运行噪音

## 聊天自动捕获

当 `Auto-export knowledge results` 开启时，Argus 会在新的 assistant 回复完成后自动交给后端判断。后端只捕获明显像知识沉淀的回复，例如总结、复盘、决策、计划、review notes、架构方案和 AI memory；普通问答、短回复、状态说明不会写入 Obsidian。

自动捕获会先创建 `chat-auto-capture` 来源的 knowledge artifact，再走同一套 Obsidian 导出和 fallback 链路。

自动捕获的写入 mode 会按内容评分判断:

- 普通项目总结、review、计划、决策默认进入 `project-knowledge`。
- 阅读笔记、书摘、人物、想法、灵感、反思、长期主题、开放问题这类内容进入 `second-brain`。
- 用户偏好、稳定事实、未来回答规则、需要后续对话记住的内容进入 `ai-memory`。

用户不需要显式说目标库；显式指定只作为覆盖信号。

现在自动捕获已经在后端 assistant 回复完成事件触发，不依赖前端页面是否正打开。Argus 启动后也会用幂等表补扫历史 assistant 回复；重复运行不会重复创建 artifact 或 Obsidian note。每条自动捕获会记录:

- `routingMode`
- `routingScores`
- `routingSignals`
- `routingReason`
- `routingConfidence`
- `contentHash`
- `sourceId`

聊天消息旁边会显示轻量状态，例如 `Saved to Obsidian`、`Memory candidate`、`Skipped`、`Fallback to docs/knowledge` 或 `Obsidian save failed`。展开/悬停可看到 Obsidian path、artifact id、路由原因或错误。

AI Memory 会分层处理:

- 高置信稳定事实、偏好、长期决策直接写入 `Argus/AIMemory/...`。
- 中等置信内容进入 `AI Memory review queue`，用户确认后再写长期记忆。
- 低置信内容跳过，只记录 skipped reason。

可以在 Settings 里用 `Test routing` 输入一段文本，预览它会写到 Projects、SecondBrain 还是 AIMemory，以及命中信号和置信度。这个动作不会创建 artifact，也不会写 Obsidian。

## 手动发送 Results

在项目中打开 Results 面板:

```text
Ctrl+K -> /results
```

选择一个 result 后:

1. 在右上角选择 Obsidian write mode。默认 `Auto`，也可以手动覆盖为 `Project`、`Brain` 或 `Memory`。
2. 点击书本图标 `Send to Obsidian`。
3. 状态会从 `Not sent` 变为:
   - `Synced to Obsidian`
   - `Fallback to docs/knowledge`
   - `Failed to sync`

如果之前 fallback 或失败，恢复 Obsidian 后再次点 `Send to Obsidian` 会用稳定 `argusId` 更新同一篇笔记，不制造重复笔记。

Results 面板会显示 `Routing reason`，例如因为命中 `reading notes / idea / person` 写入 SecondBrain，或因为命中 `stable fact / preference` 写入 AIMemory。

## 重复笔记清理

如果之前因为旧前端自动捕获或手动重复发送产生了 `总结 2/3/4/5`，不要直接删除。推荐在 Settings 里使用:

```text
Duplicate cleanup -> Scan duplicates -> Archive duplicates
```

规则:

- 按 `argusId`、`sourceArtifactId`、`contentHash` 分组。
- 默认保留最新一份。
- 旧副本移动到 `Argus/_duplicates/<YYYY-MM-DD>/`。
- 不删除用户文件。

如果 Obsidian 已打开但刚更新过插件，先执行 `Reload community plugins` 或重启 Obsidian；否则新增 duplicate endpoint 可能还没加载。

## AI 读回

开启 `Enable AI memory readback` 后，用户发送 chat message 时，Argus 会在本次请求前读取少量 Obsidian context。读回内容只进入当前模型请求，不写入历史 transcript。

默认项目范围:

```text
Argus/AIMemory/<project-or-General>
Argus/Projects/<project-or-General>
```

最终仍受插件 `Readable folders` 限制。也就是说，Argus 只能读插件设置中允许的 vault 目录。

可以在 Settings 里输入 `Test query`，点击 `Test search/context` 验证读回。成功示例:

```text
Search returned 5 note(s); context returned 5 note(s).
```

新增可选读回:

- `Include active Obsidian note selection in chat readback`: 会读取 Obsidian 当前打开笔记/选中文本，注入本次请求。
- `Test active note`: 在 Settings 里验证当前笔记是否可读。
- 读回来源会保存在本次请求 metadata 中，UI 后续可以展开查看来源。

## Obsidian -> Argus 反向发送

插件命令面板新增:

| Command | 行为 |
| --- | --- |
| `Argus: Send current note to Argus` | 创建 `source: obsidian` artifact，并广播到 Argus Inbox/Chat |
| `Argus: Send selected text to Argus` | 只发送当前选中文本 |
| `Argus: Create Argus memory from selection` | 生成 AI Memory 候选，不自动写长期记忆 |
| `Argus: Ask Argus about this note` | 把当前笔记附加到 Argus 当前聊天输入，不自动提交 |
| `Argus: Append selection to Daily note` | 追加到 `Daily/YYYY-MM-DD.md` 的 `## Argus` |

Argus UI 打开时会收到 `obsidian_inbox_item` WebSocket 消息，并把内容附到当前聊天输入，但不会自动发送。

## 局部写入

新增 patch 能力:

```ts
operation: 'append-heading' | 'replace-heading' | 'upsert-frontmatter'
```

用途:

- append 到 `## 会议记录`
- replace `## 总结`
- 更新 Properties，例如 `status: active`、`confidence: 0.9`

插件侧使用 `Vault.process()`，避免读写间用户改动被覆盖。

## 结构化查询

新增 `/query` 支持:

- `field: type`, `project`, `status`, `confidence`, `tags`, `path`, `content`, `headings`
- `op: eq`, `neq`, `contains`, `in`, `gt`, `gte`, `lt`, `lte`, `exists`
- `sourceTypes: markdown`, `canvas`, `excalidraw`

示例:

```json
{
  "query": "bridge",
  "filters": [
    { "field": "type", "op": "eq", "value": "decision" },
    { "field": "confidence", "op": "gt", "value": 0.7 },
    { "field": "tags", "op": "contains", "value": "argus" }
  ]
}
```

## AI Memory 候选队列

Argus 现在不会直接把长期记忆写死到 vault。流程是:

1. 从 Obsidian 选中文本、反向导入 artifact、知识类结果中提取候选。
2. 候选进入 Settings 的 `AI Memory review queue`。
3. 用户确认 `Commit` 后，才写入 `Argus/AIMemory/<project-or-General>/`。
4. 同一 `stableKey` 会去重；同 key 不同内容会标记为 `conflict`，等待用户判断。

## Multi Vault

Settings 里会保留多个 vault 配置:

- `vaultId`
- vault name
- endpoint/token
- readable folders
- write base folder
- project mappings

安装器从 `27177` 起分配端口，已有 vault 占用后顺延到 `27178`、`27179`。

## MCP

生成 MCP server:

```powershell
npm run obsidian:mcp
```

Settings 里 `Install MCP` 会展示命令和环境变量。MCP 暴露:

- `obsidian_active`
- `obsidian_query`
- `obsidian_context`
- `obsidian_patch`
- `obsidian_memory_candidates`
- `obsidian_memory_commit`

## Fallback 机制

当 Obsidian 插件未打开、token 错误、端口不可达，且 `Fallback to project docs` 已开启时，Argus 会写入当前项目:

```text
docs/knowledge/<mode>/<title>.md
```

fallback frontmatter 会包含:

- `obsidianFallback: true`
- `obsidianFallbackReason`
- `argusId`
- `targetMode`

后续在 Results 面板重新发送即可同步回 Obsidian。

## 发布包

生成 Obsidian 插件 release zip:

```powershell
npm run obsidian:package-bridge
```

输出:

```text
dist/obsidian-bridge/argus-bridge-0.1.1.zip
```

注意: `npm run build:client` 会清理 `dist/`，所以正式发包时先 build，再重新运行 `npm run obsidian:package-bridge`。

## Smoke 验收

后端到真实 Obsidian smoke:

```powershell
npm run obsidian:smoke-bridge -- --vault "C:\Users\yckui\Documents\note\self"
```

它会验证:

- `/argus/v1/status`
- 三种 mode 写入
- search
- context

重载 Obsidian 插件后，可跑严格扩展 smoke:

```powershell
npm run obsidian:smoke-bridge -- --vault "C:\Users\yckui\Documents\note\self" --require-extended
```

扩展 smoke 会额外验证:

- `/argus/v1/query`
- `/argus/v1/patch`
- `/argus/v1/periodic/append`
- `/argus/v1/graph`
- `/argus/v1/active`

如果看到 `extendedError: "Not found."`，说明 vault 文件已经安装，但 Obsidian 当前内存里仍是旧插件，需要重启 Obsidian 或 reload community plugins。

UI smoke 验证路径:

1. Argus Settings 点 `Save bridge`。
2. 点 `Test connection`。
3. 点 `Test search/context`。
4. 打开 Results，点一次 `Send to Obsidian`。
5. 在 Obsidian vault 中确认笔记、Properties 和项目 `Index.md`。

2026-05-07 已完成的本机 UI smoke:

```text
Vault: self
Plugin version: 0.1.1
Search/context: 5 notes / 5 notes
Manual Results export: Synced to Obsidian
Path: Argus/Projects/E--AIINWORK/Argus UI Smoke Manual Export 20260507-165801.md
```

## 排错

### Test connection 显示未连接

检查 Obsidian 是否打开，并确认插件在监听:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 27177
```

### Access denied 或 401

重新复制 Obsidian 插件 token 到 Argus Settings，保存后再测。

### Search/context 返回 0

先换一个明确存在的关键词，例如 `Argus`。如果仍为 0，检查插件 `Readable folders` 是否包含目标目录。

### Results 看不到 Send to Obsidian

确认项目已有 result。可以通过 review notes、automation/action summary、browser preview capture 或 artifact API 生成 result，再用 `Ctrl+K -> /results` 打开。

### Obsidian 里出现重复文件

正常更新依赖稳定 `argusId`。如果手工改掉 frontmatter 的 `argusId`，插件会认为是新笔记并按冲突策略改名保留。
