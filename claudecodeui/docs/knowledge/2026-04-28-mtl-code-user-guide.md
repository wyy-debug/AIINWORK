# MTL-Code 使用文档

Date: 2026-04-28

本文面向日常使用 MTL-Code UI 的用户，说明怎么创建项目、发起对话、配置模型、使用 Agent / Skill / MCP / Worktree / Hub，以及需要注意的边界。

## 1. 启动和基础概念

MTL-Code UI 是一个桌面端代码 Agent 工具。GUI 负责项目管理、聊天、配置、Agent/Skill 选择和诊断展示；真正执行代码读写、Shell、MCP、上下文压缩的是内置的 MTL-Code / Claude Code 兼容 runtime。

常用入口：

- 左侧 `项目`：面向某个本地代码目录的工作区会话。
- 左侧 `对话`：独立聊天空间，不默认绑定项目。
- 主界面 `Agent Builder`：创建、编辑、上传、安装 Agent / Skill。
- 设置里的 `Agents / MTLCode`：配置模型、API、权限、MCP、Repository。

核心区别：

- 项目会话：默认使用 MTL-Code，不自动启用 Agent；可以添加 Skill。
- 独立对话：新建时可以选择是否使用 Agent。
- Worktree 会话：从 Git 项目派发出来的独立工作树，可以在派发时绑定 Agent / Skill。

## 2. 第一次配置模型

打开设置中的 `Agents > MTLCode`，配置模型运行参数。

常见字段：

- API Key：Anthropic-compatible token，例如 DeepSeek / Claude 兼容接口 token。
- Base URL：Anthropic-compatible endpoint。
- Model：实际调用的模型名，例如 `deepseek-reasoner`。
- Context window tokens：模型上下文窗口长度。
- Temperature：采样温度。
- Effort：DeepSeek 等模型的推理强度。

注意事项：

1. DeepSeek 1M 上下文必须显式配置为 `1000000`。
2. 不要依赖 GUI 猜测 provider 默认长度；配置会传给后端环境变量 `MTL_CODE_MAX_CONTEXT_TOKENS` 和 `CONTEXT_WINDOW`。
3. MTL-Code UI 内部 provider key 仍兼容使用 `claude`，界面显示为 `MTLCode`，这是正常现象。
4. 如果开启 bare mode，会减少自动项目上下文、hooks、auto-memory 等 runtime 行为，适合想要更干净 prompt 的场景。

## 3. 创建和使用项目

在左侧 `项目` 模式下，点击文件夹/新增项目入口，选择本地代码目录。

项目会话适合：

- 让 MTL-Code 读取、修改项目文件。
- 运行 Shell、Git、测试、构建。
- 结合项目文件树、diff、终端结果继续开发。

使用步骤：

1. 选择或新建项目。
2. 点击 `新建会话`。
3. 直接输入开发任务，例如“修复这个编译错误”、“分析这个模块”、“新增一个按钮”。
4. 需要额外 Skill 时，在输入框下方选择 Skill。
5. 发送后 MTL-Code 会在当前项目路径下执行。

注意事项：

1. 项目会话不显示 Agent 选择，这是设计行为。
2. 项目会话默认是 MTL-Code 原生代码 Agent，避免 Agent 配置污染普通项目工作。
3. Skill 可以在项目会话里使用，并会保存到当前会话。
4. 创建项目时可以选择普通本地目录，但不要选择系统关键目录，例如 Windows 根目录、系统目录、Program Files 等。
5. 如果项目路径移动或删除，旧会话可能无法正常恢复，需要重新添加项目。

## 4. 使用独立对话

切换到左侧 `对话` 模式后，新建对话会进入独立聊天空间。

独立对话适合：

- 不绑定具体项目的问答。
- 使用 Agent 处理流程型任务。
- 讨论方案、写文档、分析需求。

新建对话时会询问是否使用 Agent：

- 选择否：使用默认 MTL-Code 对话。
- 选择是：选择一个已启用 Agent，并完成需要的槽位配置。

注意事项：

1. 对话空间和项目空间是两套独立列表，不应该混在一起。
2. 独立对话不默认拥有项目路径；需要代码上下文时，应使用项目会话或 Worktree。
3. Agent 绑定是按单个对话保存的，不会修改全局 Agent 模板。
4. 可以在对话中添加 Skill，后续消息会继续带上这些 Skill 上下文。

## 5. 使用 Skill

Skill 是一组本地指令和资料，通常以 `SKILL.md` 为入口，也可以带 `agents/`、`references/`、`scripts/` 等目录。

已安装 Skill 常见位置：

- 用户级：`~/.mtl-code/skills/<skill-name>/SKILL.md`
- 兼容路径：`~/.claude/skills`、`~/.codex/skills`
- 项目级：项目内 `.mtl-code/skills`、`.claude/skills`、`.codex/skills`

使用方式：

1. 在项目会话或独立对话输入框下方打开 Skill 选择。
2. 搜索真实已安装 Skill。
3. 点击绑定后会显示 Skill chip。
4. 点击已绑定 chip 可以解绑。
5. 发送消息时，后端会把 Skill 路径和说明追加到 MTL-Code prompt。

状态含义：

- 已可调用：本地已安装，后端能找到 `SKILL.md`。
- 已绑定：当前会话已经选择。
- 不可用：会话保存了该 Skill 名称，但本地没有找到对应安装。

注意事项：

1. Skill 不是单独执行引擎，本质是给 MTL-Code 的专业指令和资料。
2. 缺失 Skill 不会阻止发送，但后端会提示模型不要依赖它。
3. 上传或安装 Skill 后，如果列表没刷新，点击刷新或重开对应面板。
4. Skill 名称建议稳定，不要频繁改目录名，否则旧会话绑定会变成不可用。

## 6. 创建和使用 Agent

Agent 是可复用的智能体配置，包含名称、说明、系统提示词、Skill、MCP 绑定、知识源、guardrails、模型参数等。

创建方式：

1. 打开主界面 `Agent Builder`。
2. 点击新建 Agent。
3. 填写名称、说明和系统提示词。
4. 需要能力时添加 Skill。
5. 需要外部工具时绑定真实 MCP Server。
6. 保存并启用。

使用方式：

- 独立对话：新建对话时选择使用 Agent。
- Worktree 派发：派发任务时选择 Agent。
- 项目普通会话：不直接选择 Agent，只使用默认 MTL-Code；可添加 Skill。

注意事项：

1. Agent 配置页是模板管理，不是项目启动页。
2. Agent 的模型和上下文默认应继承 MTL-Code 设置，只有明确需要时才单独覆盖。
3. Agent 中的应用槽位必须绑定真实可用项，例如 `MCP: <serverName>`。
4. Google、Notion、Teams、Outlook 等未实现 runtime 的应用不会显示或不可用。
5. Agent 使用后，可以通过 composer 的诊断面板确认本次实际传给后端的 Agent、Skill、MCP、model、context window 和权限快照。

## 7. 配置 MCP

MCP 用于给 MTL-Code runtime 增加外部工具。

配置方式：

1. 打开 `Agent Builder > 浏览应用 > 自定义 MCP`，或设置里的 MCP 配置入口。
2. 新增 MCP Server。
3. 选择作用域：用户级或项目级。
4. 填写 stdio 命令、HTTP/SSE URL、环境变量等。
5. 点击测试。
6. 在 Agent 槽位里选择具体的 `MCP: <serverName>`。

注意事项：

1. 测试只验证配置、命令或 URL 能否检测，不伪造工具列表。
2. MCP 工具列表由 MTL-Code runtime 在会话启动后发现。
3. 项目级 MCP 需要有 workspacePath。
4. MCP Server 不在线、命令不可执行、环境变量缺失时，Agent 绑定存在但工具不可用。
5. 使用 MCP 工具时仍可能触发权限确认。

从 Hub 安装 MCP：

1. 打开设置 `Agents > Repository`。
2. 同步远端 Hub catalog。
3. 在 `MCP` 分类里点击 `Pull & Configure`。
4. 按 Hub manifest 填写必需配置，例如 `root`。
5. 保存后，MTL-Code 会下载安装到本机，并写入 MTL-Code / Claude Code MCP 配置。

以 `ainwork-code-search-mcp` 为例：

- `root` 会写入 `AINWORK_DEFAULT_CODE_ROOT`，作为默认代码搜索根目录。
- `AINWORK_CODE_ROOTS` 是可选白名单；Windows 多路径用分号分隔。
- 工具调用时仍可传入 `root` 覆盖默认值。
- 第一次安装可能会执行 `npm install --omit=dev --ignore-scripts` 来安装 MCP 依赖。

## 8. 使用 Agent / Skill Hub

Agent/Skill Hub 是独立服务，用于团队共享 Agent 模板、Skill 和 MCP Server。

启动方式：

```powershell
cd E:\AIINWORK\agent-skill-hub
$env:HOST="0.0.0.0"
$env:PORT="4877"
$env:HUB_ADMIN_TOKEN="your-token"
.\dist\agent-skill-hub.exe
```

在 MTL-Code UI 中使用：

1. 打开设置 `Agents > Repository`。
2. 添加 Hub 的 catalog URL，例如：

```text
http://<host>:4877/agent-repository/catalog.json
```

3. 同步 Repository。
4. Pull / 安装 Agent 模板或 Skill。
5. 已安装内容显示更新或卸载，不应继续显示 Pull。

上传到 Hub：

1. 在 `Repository` 页选择一个远端 Hub。
2. 输入该 Hub 的 `adminToken`。
3. 选择 Agent 或 Skill，加载 markdown 或 Skill 文件夹。
4. 点击 `Upload to remote Hub`。

注意：本地兼容库不是团队 Hub，不会再显示为 `Local Remote Repository`，上传也不会默认写入本地库。

注意事项：

1. Hub 是独立 exe，不内嵌在 Code UI 里。
2. 局域网访问需要 `HOST=0.0.0.0`，并确认 Windows 防火墙放行端口。
3. 上传、审核、发布、点赞等多人协作能力由 Hub API 负责。
4. Code UI 只是消费 catalog 和执行安装。

## 9. 使用 Worktree 派发任务

Worktree 用于在 Git 项目里把任务派发到独立工作树，主项目保持干净。

使用方式：

1. 在 Git 项目中点击 `派发工作树`。
2. 填写任务说明。
3. 选择 base ref。
4. 可选 Agent、Skill。
5. 创建后进入新的 worktree 项目会话。

默认行为：

- 创建目录：`~/.mtl-code/worktrees`
- 创建方式：`git worktree add --detach`
- 默认 detached HEAD，不自动创建分支。
- 需要保留结果时，手动点击创建分支。

注意事项：

1. 非 Git 项目不能派发 worktree。
2. 父项目 dirty 时仍基于 HEAD 派发，不会复制未提交改动。
3. 删除 managed worktree 前会检查 dirty 状态；有改动时会阻止删除。
4. Worktree 会话上下文会跟随 session 保存，重新打开可恢复。
5. v1 不自动 merge、不自动 PR。

## 10. 权限和安全

MTL-Code 执行 Bash、文件写入、MCP 工具等操作时，可能会请求权限。

注意事项：

1. 允许规则和具体工具输入有关，不是所有“看起来类似”的命令都会自动通过。
2. disallowedTools 优先级高于 allowedTools。
3. 当前运行中的请求可能不会立刻吃到刚刚修改的权限设置，下一轮会话更稳定。
4. `Allow once` 只对本次请求生效。
5. `Allow saved` 会保存规则，后续匹配时减少弹窗。
6. bypass/skip permissions 是高风险模式，只建议在可信项目和可信命令下使用。

如果你认为权限已经全开但仍然弹窗，优先检查：

- 当前会话实际的 permissionMode。
- allowedTools / disallowedTools 是否冲突。
- 请求工具是否来自 MCP 或子进程。
- 保存规则是否匹配当前命令输入。
- 诊断面板里的权限快照。

## 11. 上下文、RAG 和压缩

MTL-Code 有三类容易混淆的上下文：

1. 项目上下文
   由 runtime 通过文件、Git、Shell、工具读取当前项目。

2. Agent RAG
   由 UI 上传文档并建立轻量索引，运行时把匹配片段追加到 Agent prompt。

3. 对话压缩
   由 MTL-Code / Claude Code runtime 自动或手动 `/compact` 处理长历史。

注意事项：

1. Claude Code / MTL-Code 没有 GUI 里可单独配置的传统 RAG 知识库；当前 Agent RAG 是 MTL-Code UI 额外提供的知识源层。
2. 普通代码阅读不需要配置 RAG。
3. RAG 适合规范、资料、产品文档、长期知识。
4. 压缩摘要可能丢失细节，复杂任务压缩后建议先让 Agent 复述当前状态。

## 12. 常用命令

在输入框中输入 `/` 可以查看内置命令。

常用命令：

- `/help`：查看帮助。
- `/clear`：清空当前会话上下文。
- `/model`：查看或切换模型。
- `/cost`：查看 token 和成本信息。
- `/memory`：查看记忆相关能力。
- `/compact`：手动压缩长对话。

注意事项：

1. 命令由 MTL-Code runtime 处理，不是所有命令都由 GUI 实现。
2. 某些命令会写入会话历史或触发 runtime 行为。
3. 如果命令效果不符合预期，查看聊天中的工具输出和诊断状态。

## 13. 推荐工作流

普通代码修改：

1. 进入项目。
2. 新建项目会话。
3. 必要时选择 Skill。
4. 描述任务。
5. 看 diff、运行测试、继续修正。

复杂专题任务：

1. 安装或选择对应 Skill。
2. 如果需要专门角色，新建独立对话并选择 Agent。
3. 如果要动代码，回到项目会话或通过 Worktree 派发。

隔离开发：

1. 在 Git 项目中派发 Worktree。
2. 选择 Agent / Skill。
3. 在 worktree 里完成修改。
4. 需要保留时创建分支。
5. 回主项目手动合并或处理。

团队共享：

1. 启动 Agent/Skill Hub。
2. 团队成员添加 catalog URL。
3. Pull Agent 模板或 Skill。
4. 在对话或项目中绑定使用。

## 14. 常见问题

### 为什么项目里看不到 Agent 选择？

项目普通会话默认保持 MTL-Code，不显示 Agent 选择。这是为了避免项目空间和 Agent 对话空间混用。项目里可以绑定 Skill；需要 Agent 时使用独立对话或 Worktree 派发。

### 为什么选择 Agent 后没有生效？

检查是否完成了槽位配置，是否点击启用/保存，以及诊断面板里是否出现 `agentId`、`appBindings`、`effectiveSkills`。

### 为什么 Skill 显示不可用？

本地没有找到对应 `SKILL.md`，或者目录名和会话保存的 Skill 名不一致。重新安装或刷新 Skill 列表。

### 为什么 MCP 绑定了但工具不能用？

绑定只说明 Agent 想使用该 MCP；真正工具由 runtime 启动后发现。检查 MCP Server 是否能启动、URL 是否可访问、环境变量是否完整。

### 为什么 DeepSeek 上下文没有 1M？

需要在 MTLCode 模型设置里显式写 `1000000`。不要只在 Agent GUI 里改一个显示值。

### 为什么会话切换时看起来不对？

确认当前在 `项目` 还是 `对话` 模式。两者是独立空间，项目会话和独立对话不应互相复用。

### 为什么权限全开了还弹窗？

权限规则可能没有匹配当前工具输入，或者 disallowedTools 冲突，或者当前运行进程尚未读取最新设置。看诊断面板里的权限快照。
