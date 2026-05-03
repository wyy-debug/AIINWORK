# 上下文压缩使用文档

Date: 2026-04-28

本文说明 Argus 中“上下文压缩”的使用方式、界面含义和注意事项。

## 它是什么

上下文压缩用于解决长对话接近模型上下文窗口上限的问题。真正执行压缩的是底层 Argus / Claude Code runtime，GUI 负责把压缩发生的位置、类型和摘要清楚展示出来。

This is separate from the removed knowledge/RAG feature:

- 上下文压缩：把很长的历史对话压成摘要，让当前会话继续。
- Knowledge/RAG: removed from the current product runtime; uploaded documents are no longer indexed or injected into Agent prompts.

Normal code projects do not need a knowledge base for context compaction.

## 什么时候会触发

有两种方式：

1. 自动触发
   当对话历史、工具结果、项目上下文接近当前模型的上下文窗口上限时，Argus 会自动压缩。

2. 手动触发
   在输入框中输入 `/compact`，可以主动压缩当前会话。

自动压缩不是等到 100% 才触发。runtime 会预留输出空间和安全 buffer，所以一般会在接近上限前提前处理。

## 怎么看 GUI

当压缩发生后，聊天时间线中会出现一张居中的压缩卡片。

常见标题：

- `对话已压缩`：完整历史对话被摘要压缩。
- `工具输出已压缩`：只压缩了旧的工具结果，通常用于释放工具输出占用的上下文。
- `压缩摘要已载入`：读取历史会话时发现 runtime 写入的压缩摘要。

卡片上可能显示：

- 触发方式：自动、手动、超限恢复等。
- 压缩前 tokens：压缩发生前大致使用了多少上下文。
- 节省 tokens：本次微压缩释放了多少空间。
- 工具结果数量：有多少个旧工具结果被压缩。
- 时间：压缩事件写入时间。

如果 runtime 写入了摘要，卡片会出现“查看压缩摘要”。展开后可以看到压缩后的历史摘要。

## 推荐用法

### 长任务继续推进

当你看到“对话已压缩”后，可以继续正常聊天。Agent 会基于压缩摘要继续理解之前的任务。

适合这样问：

```text
继续刚才的任务，基于压缩摘要列出当前剩余步骤。
```

或：

```text
根据压缩摘要，先确认当前实现状态，再继续修改。
```

### 重要任务手动压缩

如果一个任务已经完成了大半、但后面还要继续做很多步骤，可以主动输入：

```text
/compact
```

然后继续后续工作。这样比等到上下文快满时自动触发更可控。

### 需要回查旧细节

压缩摘要是摘要，不保证包含所有旧细节。如果需要非常具体的旧信息，可以要求 Argus 回看完整 transcript 或相关文件。

示例：

```text
如果摘要里信息不够，请回看本会话 transcript，找出之前提到的具体错误日志。
```

## 配置上下文窗口

上下文窗口由设置中的模型运行参数决定。Argus 会把该值传给后端：

- `MTL_CODE_MAX_CONTEXT_TOKENS`
- `CONTEXT_WINDOW`

如果你使用 DeepSeek 1M 上下文，需要显式配置为：

```text
1000000
```

不要依赖 GUI 猜测 provider 默认长度。配置值会影响自动压缩阈值。

## 注意事项

1. GUI 不自己压缩对话
   GUI 只是展示 runtime 写入的压缩边界和摘要。真正的摘要生成、边界写入和继续会话由 Argus / Claude Code 完成。

2. 压缩摘要可能丢失细节
   摘要会保留主要目标、代码路径、决策、错误和下一步，但不等于完整历史。关键命令、完整日志、长代码片段可能被省略。

3. 工具输出微压缩不是失败
   `工具输出已压缩` 通常表示旧工具结果被清理或摘要化，以释放上下文。它不代表工具执行失败。

4. Knowledge/RAG cannot replace context compaction
   Knowledge/RAG has been removed from the product runtime; context compaction still handles current conversation history.

5. 上下文越大不代表永远不用压缩
   1M context 能显著推迟压缩，但大型项目、长工具输出、多轮 Agent/Skill 调用仍可能触发。

6. 历史会话重新打开时也会显示
   如果旧 JSONL 中已有 `compact_boundary` 或 `microcompact_boundary`，重新打开会话时 GUI 也会显示对应压缩卡片。

7. 压缩后建议先确认状态
   对复杂任务，压缩后最好让 Agent 先复述当前状态和剩余步骤，再继续执行。

## 排查

### 看不到压缩卡片

可能原因：

- 当前会话还没有触发压缩。
- 历史记录中没有 `compact_boundary` / `microcompact_boundary`。
- 会话来自非 Argus/Claude provider，尚未写入该类事件。

### 压缩摘要为空

可能原因：

- runtime 只写了压缩边界，没有写摘要正文。
- 实时流先到达边界，摘要稍后才落盘；重新打开会话后通常可以看到完整摘要。

### 自动压缩太早

检查模型上下文配置是否正确，尤其是 DeepSeek 1M 是否显式设置为 `1000000`。

### 自动压缩没有触发

检查是否设置了禁用项：

- `DISABLE_COMPACT`
- `DISABLE_AUTO_COMPACT`

这些是 runtime 级环境变量，设置后会影响自动压缩行为。
