# MTL-Code 使用文档

本文面向日常使用 MTL-Code UI 的用户，说明项目、独立对话、模型、Agent、Skill、MCP、Hub、Worktree、权限、RAG、上下文压缩和 OpenMythos Runtime 的使用方法与注意事项。

## 1. 基本概念

- 项目：绑定一个本地工作目录，适合读写代码、运行命令、查看 Git diff。
- 独立对话：不绑定项目目录，适合问答、规划、资料整理、Agent 工作流。
- Agent：一组角色、提示词、Skill、MCP 绑定和模型上下文配置。
- Skill：本地 `SKILL.md` 指令包，通常安装在 `~/.codex/skills` 或 `~/.mtl-code/skills`。
- MCP：外部工具服务器，运行时由 MTL-Code / Claude Code 发现工具。
- Hub：独立的 Agent/Skill/MCP 远端仓库服务，Code UI 只消费 catalog 和调用 Hub API。
- Worktree：从 Git 项目派发出的独立工作树，默认 detached HEAD，主项目保持干净。

## 2. 模型配置

路径：`设置 > 智能体 > MTLCode > Model`

可以配置多个模型 Profile，每个 Profile 包含：

- 名称
- Base URL
- Model
- API Key / Auth Token
- Context window tokens
- 是否使用轻量启动

注意：

1. 模型 Profile 在设置页管理。
2. 对话和项目都可以在 composer 切换模型。
3. 模型按 session 绑定，A 对话可以用 MiMo，B 对话可以用 DeepSeek。
4. 对已有上下文的会话切换模型时，可能影响后续回复连续性，UI 会提示。
5. DeepSeek 1M 上下文需要显式配置 `1000000`，不要只在 Agent GUI 中改显示值。
6. MiMo 使用 Anthropic-compatible API 时，Model 必须写服务端实际支持的模型 id。

## 3. 项目会话

项目会话用于真实代码工作。

使用方式：

1. 在左侧选择 `项目`。
2. 点击文件夹图标新建项目，选择本地目录。
3. 在项目下新建会话。
4. 输入任务，必要时绑定 Skill 或切换模型。

注意：

1. 项目普通会话默认使用 MTL-Code，不强制显示 Agent 配置。
2. 项目中可以直接添加 Skill，用于后续对话。
3. 项目和独立对话是两个空间，不应混用会话列表。
4. 需要 Agent 参与代码任务时，优先使用 Worktree 派发，或在新建项目会话时显式选择 Agent。

## 4. 独立对话

独立对话适合非项目绑定任务。

使用方式：

1. 切到左侧 `对话`。
2. 新建对话。
3. 根据提示选择是否使用 Agent。
4. 可以绑定 Skill、MCP、模型 Profile。

注意：

1. 独立对话默认没有项目路径。
2. 需要访问项目文件时，建议回到项目会话或 Worktree。
3. 选择 Agent 后必须保存到当前 session，诊断面板可确认 `agentId`、`effectiveSkills`、`mcpBindings`。

## 5. Skill

Skill 是 MTL-Code 追加给模型的本地能力说明，核心入口是 `SKILL.md`。

使用方式：

1. 在 composer 点击 `添加 Skill`。
2. 搜索真实已安装 Skill 或远端 Hub Skill。
3. 点击安装或绑定。
4. 已绑定 Skill 会显示为 chip，可点击解绑。
5. 发送消息后可在诊断面板查看本次传给后端的 Skill、`SKILL.md` 路径、是否存在、注入长度。

注意：

1. 缺失 Skill 不阻止发送，但 UI 会标记不可用，后端 prompt 会提示不要依赖它。
2. Hub Pull 后不应继续显示 Pull，已安装内容只显示更新或卸载。
3. Skill 调用仍通过 prompt + 本地 `SKILL.md` 路径约束完成，没有单独 Skill 执行引擎。

## 6. Agent

Agent 类似 ChatGPT 自定义智能体：角色、提示词、应用槽位、Skill、MCP、模型配置的组合。

使用方式：

1. 打开 Agent Builder。
2. 从模板创建或新建 Agent。
3. 配置指令、Skill、MCP 槽位、模型与上下文。
4. 独立对话或 Worktree 派发时选择 Agent。
5. 首条消息后打开诊断面板，确认 Agent/Skill/MCP/model/context window 是否实际传到后端。

注意：

1. 项目普通会话默认不显示 Agent 配置，避免项目空间和 Agent 对话空间混用。
2. Agent 中绑定 MCP 只代表想使用该 MCP；真正工具由 runtime 启动后发现。
3. 如果 Agent 依赖 MCP token/root，安装后需要执行可用性检测。

## 7. MCP

MCP Server 用于扩展工具能力，例如 Redmine、代码搜索、本地服务等。

使用方式：

1. 在 `设置 > 智能体 > MTLCode > MCP 服务器` 配置 MCP。
2. 从 Hub 安装 MCP 时按 manifest 填写 required setup fields，例如 token、root。
3. 安装后点击 `检测可用性`。
4. 在 Agent 槽位中选择真实 `MCP: <serverName>`。

注意：

1. 密钥只显示是否 configured，不在 UI、日志、诊断中明文展示。
2. `root` 通常是 MCP 默认工作目录或默认代码根；如果工具调用时显式传了 `codeRoot`，以调用参数为准。
3. 如果提示缺少 `REDMINE_API_KEY`，说明 runtime 启动 MCP 时没有拿到该环境变量或配置字段。
4. MCP 工具列表不伪造；没有 runtime tool-list API 时，只显示“配置已绑定，工具列表将在会话启动后由 MTL-Code 发现”。

## 8. Agent / Skill / MCP Hub

Hub 是独立服务，不内嵌在 Code UI 中。

启动建议：

```json
{
  "host": "0.0.0.0",
  "port": 4877,
  "dataDir": "D:\\mtl-agent-skill-hub-data",
  "adminToken": "test1234",
  "submitToken": "",
  "name": "Agent/Skill Hub",
  "description": "Shared Agent templates and Skills.",
  "publicBasePath": "/agent-repository",
  "adminBasePath": "/api/admin"
}
```

在 Code UI 中使用：

1. 打开 `设置 > Repository`。
2. 添加 catalog URL，例如 `http://<host>:4877/agent-repository/catalog.json`。
3. 同步 Repository。
4. 搜索并安装 Agent、Skill 或 MCP。
5. 上传时必须选择远端 Hub，并填写正确 token。

注意：

1. 本地兼容 catalog 不作为团队 Hub 上传目标，UI 中不应显示 `Local Remote Repository` 上传入口。
2. 远端返回 401 时，优先检查请求使用的 Hub、`adminToken`、`submitToken`。
3. Hub 数据保存在 `dataDir`，如果 dataDir 变了，之前上传的内容看起来就会“消失”。
4. 局域网访问需要 `host=0.0.0.0`，并确认防火墙放行端口。

## 9. Worktree 派发

Worktree 用于在 Git 项目中派发隔离任务。

默认行为：

- 根目录：`~/.mtl-code/worktrees`
- 创建方式：`git worktree add --detach <worktreePath> <baseRef>`
- 默认 detached HEAD，不自动创建分支。
- 会话上下文、Agent、Skill、模型绑定保存在 session 与 worktree 元数据中。

使用方式：

1. 在 Git 项目中点击 `派发工作树`。
2. 填写任务说明和 base ref。
3. 可选择 Agent、Skill、MCP、模型。
4. 创建后进入新 worktree 项目会话。
5. 需要保留成果时，手动创建分支。

注意：

1. 非 Git 项目不能派发 Worktree。
2. 父项目 dirty 时仍基于 HEAD 派发，不复制未提交改动。
3. 删除 managed worktree 前会检查 dirty；有改动会阻止删除。
4. v1 不自动 merge、不自动 PR、不自动 handoff。

## 10. 权限

权限设置在项目和独立对话中统一生效。

注意：

1. `skip permissions` 等价于高风险 bypass，只建议在可信项目和可信命令下使用。
2. `disallowedTools` 优先级高于 `allowedTools`。
3. 当前正在运行的请求可能不会立刻读取刚保存的权限，下一轮更稳定。
4. 如果仍然弹权限，查看诊断面板里的 permissionMode、skipPermissions、allowedTools、disallowedTools 和冲突提示。
5. MCP 或子进程工具可能需要单独规则匹配。

## 11. RAG 与上下文压缩

MTL-Code 当前有三类上下文能力：

1. 项目上下文：runtime 通过文件、Git、Shell、工具读取当前项目。
2. Agent RAG：UI 上传文档并建立轻量索引，运行时注入匹配片段。
3. 对话压缩：runtime 自动或手动 `/compact` 压缩长历史。

注意：

1. Claude Code / MTL-Code 本身没有一个 GUI 中可配置的传统 RAG 知识库。
2. Agent RAG 是 MTL-Code UI 提供的知识源层。
3. 普通代码阅读不需要配置 RAG。
4. 压缩摘要可能丢失细节，复杂任务压缩后建议先让 Agent 复述当前状态。

## 12. OpenMythos Runtime

OpenMythos Runtime 用于把任务难度、冻结目标、专家路由、阶段策略和上下文账本显式化。

能力状态：

- 动态思考深度：按任务信号计算 effort 和 loopBudget；`loopControl=enforced` 时映射到 `maxTurns`。
- 原始任务稳定注入：冻结目标、约束、验收标准会在工具续写和子代理上下文中重注入。
- 专家路由：确定性提示安全、验证、性能、架构、前端、Git 或本地执行路线。
- 按阶段适配器：`orient -> plan -> implement -> verify -> finalize`，前两阶段阻止写操作。
- 压缩型上下文缓存：显示 compact、microcompact、RAG、tool summary 账本；不是 MLA/KV cache。
- 深度 benchmark：提供离线 benchmark 脚本对比预算、路由、阶段和预估成本。

注意：

1. 这不是隐藏自动派发写文件专家。
2. 这不是完整 ACT halting 引擎，v1 使用 `maxTurns` 做硬预算。
3. 诊断面板会显示 runtime card、phase、expert routes 和 context ledger。

## 13. 常用命令

在输入框输入 `/` 可以查看内置命令。

- `/help`：查看帮助。
- `/clear`：清空当前会话上下文。
- `/model`：查看或切换模型。
- `/cost`：查看 token 和成本信息。
- `/memory`：查看记忆相关能力。
- `/compact`：手动压缩长对话。

## 14. 推荐工作流

普通代码修改：

1. 进入项目。
2. 新建项目会话。
3. 必要时绑定 Skill。
4. 描述任务。
5. 查看 diff、运行测试、继续修正。

复杂专题任务：

1. 安装或选择对应 Skill。
2. 需要专门角色时，新建独立对话并选择 Agent。
3. 需要动代码时，回到项目会话或通过 Worktree 派发。

隔离开发：

1. 在 Git 项目中派发 Worktree。
2. 选择 Agent / Skill / 模型。
3. 在 worktree 中完成修改。
4. 需要保留时创建分支。
5. 回主项目手动合并或处理。

团队共享：

1. 启动 Agent/Skill Hub。
2. 团队成员添加 catalog URL。
3. Pull Agent 模板、Skill 或 MCP。
4. 在对话或项目中绑定使用。
