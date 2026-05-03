# 2026-05-03 ContextBudget 上下文显示对齐

## 背景

Argus UI 之前有三套上下文数字：

- 实时 WebSocket 从 Argus `result.modelUsage` 里抽 `tokenBudget`。
- `/api/projects/:projectName/sessions/:sessionId/token-usage` 直接扫 JSONL。
- 历史消息加载通过 provider adapter 返回 `tokenUsage`。

这会导致两个问题：

1. “当前上下文窗口占用”和“累计会话 token 消耗”被混在一起，简单问候也可能看起来用了很多上下文。
2. DeepSeek V4 / 1M profile 在某些恢复路径会掉回 `200000` fallback，UI 看起来像只支持 200K。

## 产品口径

UI 必须两者同显：

- 当前上下文窗口占用：用于判断下一次请求还剩多少上下文容量。
- 累计会话消耗：用于观察本会话总 token 流量和成本趋势。

不要把累计消耗当作上下文窗口占用展示。

## 统一结构

后端统一返回 `ContextBudget`：

```ts
type ContextBudget = {
  current: {
    used: number;
    total: number;
    percent: number;
    breakdown: {
      input: number;
      output: number;
      cacheRead: number;
      cacheCreation: number;
    };
  };
  cumulative: {
    used: number;
    total: number;
    percent: number;
    breakdown: {
      input: number;
      output: number;
      cacheRead: number;
      cacheCreation: number;
    };
  };
  window: {
    tokens: number;
    model: string | null;
    modelProfileId: string | null;
    source: string;
  };
  updatedAt: string;
};
```

计算规则：

- `current.used = input + cacheRead + cacheCreation`
- `current.used` 不包含 `output`
- `cumulative.used = input + output + cacheRead + cacheCreation`
- `current.total` 和 `cumulative.total` 都等于当前模型上下文窗口

## 上下文窗口来源优先级

`window.tokens` 的解析顺序固定为：

1. Argus `modelUsage.contextWindow`
2. 当前 session 绑定的 model profile
3. 当前 active model profile
4. 环境变量 `MTL_CODE_MAX_CONTEXT_TOKENS` / `CONTEXT_WINDOW`
5. `200000` fallback

DeepSeek V4 profile 必须显示 `1000000`：

- `deepseek-v4-pro`
- `deepseek-v4-flash`

如果 UI 显示为 200K，先检查 `ContextBudget.window.source`。常见原因是 session 没有绑定 profile，或者恢复会话时没有读到 active profile。

## 后端落点

核心服务：

- `server/services/context-budget-service.js`

接入点：

- `server/claude-sdk.js`
  - 实时 Argus result 事件通过 `buildContextBudgetFromModelUsage()` 生成 `contextBudget`。
  - WebSocket `status/token_budget` 同时发送新字段 `contextBudget` 和旧字段 `tokenBudget`。
- `server/index.js`
  - `/api/projects/:projectName/sessions/:sessionId/token-usage` 返回同一结构。
  - 顶层 `used/total/breakdown` 保留为兼容字段，指向 `contextBudget.current`。
- `server/projects.js`
  - JSONL 历史加载时生成同一 `tokenUsage.contextBudget`。
- `server/modules/providers/list/claude/claude-sessions.provider.ts`
  - 从 session binding 读取 `modelProfileId`，传给历史加载。
- `server/routes/commands.js`
  - `/cost` 优先读取 `contextBudget.cumulative`，避免成本命令继续用当前窗口口径。

兼容规则：

- 旧 UI/命令继续读取 `tokenBudget.used/tokenBudget.total`。
- 新 UI 只应读取 `contextBudget.current` 和 `contextBudget.cumulative`。

## 前端落点

核心工具：

- `src/components/chat/utils/contextBudget.ts`

接入点：

- `src/components/chat/hooks/useChatRealtimeHandlers.ts`
  - 收到 `token_budget` 时优先保存 `contextBudget`。
- `src/stores/useSessionStore.ts`
  - session slot 保存 `contextBudget`，并保留旧 `tokenUsage`。
- `src/components/chat/view/subcomponents/TokenUsagePie.tsx`
  - 饼图显示 `contextBudget.current.percent`。
  - 文本同时显示“当前 x / window”和“累计 y”。
  - tooltip 显示 current/cumulative breakdown、模型、窗口来源。
- `src/components/chat/view/subcomponents/AgentRuntimeDiagnosticsPanel.tsx`
  - 显示上下文窗口、当前占用、累计消耗、窗口来源。

## UI 文案

面向用户的中文口径：

- “当前上下文”：下一次请求正在占用的窗口容量。
- “累计消耗”：当前会话已产生的总 token 流量。
- “窗口来源”：当前窗口数字来自 runtime、profile、env 还是 fallback。

不要再单独使用“上下文 tokens”这种容易混淆的标签。

## 验证记录

源码验证：

- `npm run typecheck`
- `npm run check:mojibake`
- `npm run build`

打包验证：

- 使用 `C:\Users\Stan\Desktop\MTLCode\workspace\vendor\runtime-node24\node.exe` 作为 build Node 和 packaged runtime Node。
- 安装包生成于 `C:\Users\Stan\Desktop\MTLCode\workspace\vendor\electron-dist\Argus-1.30.3-x64.exe`。
- native smoke：
  - `better-sqlite3 open ok`
  - `node-pty ok`

注意：系统默认 `C:\Program Files\nodejs\node.exe` 是 Node 18.16.0，不能用于当前 Electron 打包；`better-sqlite3 12.x` 要求 Node 20+。打包时需要使用 Node 22+ 或设置 `ARGUS_RUNTIME_NODE`。

## 后续检查清单

1. DeepSeek 1M 下发送简单消息，确认 UI 显示窗口为 `1M`。
2. Resume 同一 session，确认窗口不跳回 `200K`。
3. 打开诊断面板，确认 `窗口来源` 不是意外 fallback。
4. 执行 `/cost`，确认成本计算基于累计消耗而不是当前上下文占用。
