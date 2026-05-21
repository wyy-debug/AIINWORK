# Workflow Studio REQ-210 到 REQ-220 提单索引

更新时间：2026-05-21

来源策划案：[workflow-studio-next-roadmap.md](workflow-studio-next-roadmap.md)

本文件记录已同步到 GitHub Issues 和本地看板的父单、子单映射。后续实现必须以这些子单为推进单位；父单只做范围汇总、依赖跟踪和完成状态汇总。

## 提单统计

- 父单：11 张
- 子单：42 张
- 总计：53 张
- GitHub issue 范围：#391 到 #444
- 看板 item 范围：#388 到 #441

## 关闭规则

- 父单不能直接承载实现。
- 子单可以独立关闭。
- 涉及 UI 的子单必须附桌面 Playwright 截图。
- 涉及执行的子单必须附真实 run id 或等价运行证据。
- 涉及权限的子单必须覆盖 allow / ask / deny 或明确说明该子单只实现其中一部分。
- 新发现问题先提新单，不顺手塞进当前子单。
- 不做移动端专项。

## 执行顺序建议

1. REQ-210 Preview/run 一致性
2. REQ-212 自定义节点测试矩阵
3. REQ-213 数据契约调试
4. REQ-214 Run snapshot/replay
5. REQ-211 节点包生命周期
6. REQ-215 权限解释和审批
7. REQ-216 Artifact 契约
8. REQ-217 MCP Runtime Bridge
9. REQ-218 Agent/Subagent Terminal Result Bridge
10. REQ-219 Package 导入导出治理
11. REQ-220 Release Quality Gate

## 父子单映射

| 需求 | GitHub | 看板 | 子单 |
| --- | --- | --- | --- |
| REQ-210 Workflow Preview to Run Consistency | #391 | #388 | REQ-210A, REQ-210B, REQ-210C |
| REQ-211 Node Package Lifecycle Management | #392 | #389 | REQ-211A, REQ-211B, REQ-211C, REQ-211D |
| REQ-212 Custom Node Test Matrix | #393 | #390 | REQ-212A, REQ-212B, REQ-212C, REQ-212D |
| REQ-213 Workflow Data Contract Debugger | #394 | #391 | REQ-213A, REQ-213B, REQ-213C, REQ-213D |
| REQ-214 Workflow Run Snapshot and Replay Hardening | #395 | #392 | REQ-214A, REQ-214B, REQ-214C, REQ-214D |
| REQ-215 Workflow Approval and Permission Explainability | #396 | #393 | REQ-215A, REQ-215B, REQ-215C, REQ-215D |
| REQ-216 Workflow Runtime Artifact Contract | #397 | #394 | REQ-216A, REQ-216B, REQ-216C, REQ-216D |
| REQ-217 Workflow MCP Tool Runtime Bridge | #398 | #395 | REQ-217A, REQ-217B, REQ-217C, REQ-217D |
| REQ-218 Agent and Subagent Terminal Result Bridge | #399 | #396 | REQ-218A, REQ-218B, REQ-218C, REQ-218D |
| REQ-219 Workflow Package Publish and Import Governance | #400 | #397 | REQ-219A, REQ-219B, REQ-219C, REQ-219D |
| REQ-220 Workflow Release Quality Gate | #401 | #398 | REQ-220A, REQ-220B, REQ-220C, REQ-220D |

## 子单明细

### REQ-210 Workflow Preview to Run Consistency

| 子单 | GitHub | 看板 | 目标 |
| --- | --- | --- | --- |
| REQ-210A Resolver Snapshot Backend | #402 | #399 | 抽出 validate-run 和 run create 共用 resolver，并持久化 preview/execution snapshots。 |
| REQ-210B Preview Diff API and Run UI | #403 | #400 | 计算 previewDiff，在 Runs UI 显示 matched/changed 和节点字段差异。 |
| REQ-210C Preview Consistency Evidence Gate | #404 | #401 | 用截图和命令证据证明 matched/changed 两种状态。 |

### REQ-211 Node Package Lifecycle Management

| 子单 | GitHub | 看板 | 目标 |
| --- | --- | --- | --- |
| REQ-211A Package State Backend | #405 | #402 | 增加 package installed/enabled/disabled/broken/update 状态和启停卸载操作。 |
| REQ-211B Package Impact Report Backend | #406 | #403 | 禁用、卸载、升级前扫描受影响 workflow/template/recent run。 |
| REQ-211C Package Manager UI | #407 | #404 | 在 Workflow Studio 中提供 package 管理面板和影响报告确认。 |
| REQ-211D Compatibility and Lifecycle Evidence Gate | #408 | #405 | 阻止不兼容升级，并用截图证明禁用、影响报告、不兼容升级状态。 |

### REQ-212 Custom Node Test Matrix

| 子单 | GitHub | 看板 | 目标 |
| --- | --- | --- | --- |
| REQ-212A Test Matrix Backend | #409 | #406 | 运行 manifest 中全部 testCases，并返回 per-case stdout/stderr/output/error。 |
| REQ-212B Expected Output Assertion Engine | #410 | #407 | 支持 expectedOutput 子集断言和 expectedStatus 校验。 |
| REQ-212C Test Review UI | #411 | #408 | Review UI 展示每个 test case、断言失败、stdout/stderr，并控制安装按钮。 |
| REQ-212D Sandbox Evidence Gate | #412 | #409 | 截图覆盖通过、断言失败、runtime stderr/error。 |

### REQ-213 Workflow Data Contract Debugger

| 子单 | GitHub | 看板 | 目标 |
| --- | --- | --- | --- |
| REQ-213A Lineage Resolver Backend | #413 | #410 | resolver 输出 ResolvedFieldTrace，覆盖变量、字面量、默认值、模板段。 |
| REQ-213B Variable Debugger UI | #414 | #411 | Inspector Data tab 和 Run detail 展示变量来源、类型、示例和表达式。 |
| REQ-213C Missing Variable Diagnostics | #415 | #412 | 缺失变量定位到消费节点、字段和 source expression，并支持跳转。 |
| REQ-213D Data Contract Evidence Gate | #416 | #413 | 截图证明成功 lineage 和缺失变量诊断。 |

### REQ-214 Workflow Run Snapshot and Replay Hardening

| 子单 | GitHub | 看板 | 目标 |
| --- | --- | --- | --- |
| REQ-214A Run Snapshot Backend | #417 | #414 | run 创建时保存 definition/profile/permission/package/input/resolver snapshot。 |
| REQ-214B Event Replay Backend | #418 | #415 | 用 snapshot + events 重建 completed/failed/waiting run 状态。 |
| REQ-214C Historical Run UI | #419 | #416 | Runs UI 显示 snapshot badge、definition drift 和 snapshot details。 |
| REQ-214D Snapshot Replay Evidence Gate | #420 | #417 | 截图证明历史 run 在 definition 变化后仍可审计。 |

### REQ-215 Workflow Approval and Permission Explainability

| 子单 | GitHub | 看板 | 目标 |
| --- | --- | --- | --- |
| REQ-215A Permission Explanation Backend | #421 | #418 | PermissionDecision 增加风险等级、原因、解释、请求/有效 capability。 |
| REQ-215B Approval Card UI | #422 | #419 | Approval card 展示 profile、风险、命令/工具预览、影响范围和决策历史。 |
| REQ-215C Dangerous Command Policy | #423 | #420 | Shell 节点识别危险命令并按 profile 强制 ask/deny。 |
| REQ-215D Allow Ask Deny Evidence Gate | #424 | #421 | 截图覆盖 allow、ask、deny 三类状态。 |

### REQ-216 Workflow Runtime Artifact Contract

| 子单 | GitHub | 看板 | 目标 |
| --- | --- | --- | --- |
| REQ-216A ArtifactRef Backend | #425 | #422 | 定义 WorkflowArtifactRef 并标准化 Python/tool/Git/Agent artifact。 |
| REQ-216B Artifact Gallery UI | #426 | #423 | Runs 中按节点、类型、时间展示 artifact，并提供 copy/open/evidence 操作。 |
| REQ-216C Run Summary Artifact | #427 | #424 | completed/failed/cancelled run 自动生成标准 summary artifact。 |
| REQ-216D Artifact Contract Evidence Gate | #428 | #425 | 用真实 run 证明节点 artifact 和 summary artifact 出现在 gallery。 |

### REQ-217 Workflow MCP Tool Runtime Bridge

| 子单 | GitHub | 看板 | 目标 |
| --- | --- | --- | --- |
| REQ-217A MCP Registry and Schema Backend | #429 | #426 | 标准化已启用 MCP server/tool metadata、schema 和可用性。 |
| REQ-217B MCP Runtime Bridge Backend | #430 | #427 | 校验参数、调用 MCP tool、标准化成功和错误，并遵守 permission。 |
| REQ-217C MCP Node Config UI | #431 | #428 | MCP 节点 Inspector 提供 server/tool 选择和 schema 参数表单。 |
| REQ-217D MCP Permission and Error Evidence Gate | #432 | #429 | 截图/运行证据覆盖 MCP success、schema invalid、missing tool、allowlist deny。 |

### REQ-218 Agent and Subagent Terminal Result Bridge

| 子单 | GitHub | 看板 | 目标 |
| --- | --- | --- | --- |
| REQ-218A Agent Result Contract Backend | #433 | #430 | 定义 AgentWorkflowResult，持久化 primary agent terminal result。 |
| REQ-218B Subagent Streaming and Cancel Bridge | #434 | #431 | subagent logs 流入 workflow node logs，terminal result 回填，cancel 传播。 |
| REQ-218C Agent Node Run UI | #435 | #432 | Runs detail 展示 agent/subagent summary、session link、artifact、diff、checkpoint、error。 |
| REQ-218D Agent Handoff Evidence Gate | #436 | #433 | 用 Explore -> Reviewer -> Approval -> Build 或 fixture 证明 agent 输出传递。 |

### REQ-219 Workflow Package Publish and Import Governance

| 子单 | GitHub | 看板 | 目标 |
| --- | --- | --- | --- |
| REQ-219A Package Manifest Backend | #437 | #434 | 定义并校验 WorkflowPackageManifest、dependency lock、trust/smoke metadata。 |
| REQ-219B Import Preview Sandbox | #438 | #435 | 导入前 sandbox preview 新增、覆盖、冲突、缺依赖、信任警告。 |
| REQ-219C Export Wizard UI | #439 | #436 | 导出向导选择 workflow/deps/example inputs/screenshots/metadata 并预览。 |
| REQ-219D Trust and Smoke Governance | #440 | #437 | Package trust badge 和 smoke pass/fail/not-run 状态。 |

### REQ-220 Workflow Release Quality Gate

| 子单 | GitHub | 看板 | 目标 |
| --- | --- | --- | --- |
| REQ-220A Quality Gate Runner | #441 | #438 | 建立 smoke matrix runner 并输出 machine-readable summary。 |
| REQ-220B Evidence Manifest | #442 | #439 | 证据 manifest 记录 issue、截图、run id、commit sha、命令和时间。 |
| REQ-220C Readiness Dashboard UI | #443 | #440 | Readiness panel 展示 gate 场景、状态、耗时、失败原因和证据链接。 |
| REQ-220D Release Packaging Gate | #444 | #441 | 打包前读取 quality summary/evidence manifest，缺证据时失败。 |

## 下一步建议

先从 `REQ-210A` 开始。它是后续所有 run 可信度的基础：如果 resolver 和 snapshot 没有统一，`REQ-212` 到 `REQ-220` 都会建立在不稳定的执行输入上。
