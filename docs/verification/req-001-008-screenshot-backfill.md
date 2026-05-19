# REQ-001 to REQ-008 Screenshot Backfill

Backfill command:

```bash
cd claudecodeui
npm run test:e2e:screenshots
```

Generated artifact directory:

```text
claudecodeui/output/playwright/screenshots
```

Backfilled evidence:

- `REQ-001-agent-profiles.png`: Agent Profile selector showing Plan/Build/Explore/Review/Debug/Docs entry.
- `REQ-002-checkpoints.png`: Checkpoints drawer with a rollback-capable checkpoint.
- `REQ-003-recipes-workflows.png`: Capability Marketplace recipe entry used as workflow package evidence.
- `REQ-004-permission-presets.png`: Settings permission preset surface.
- `REQ-005-project-profile-init.png`: Actions Project profile panel for MTL.md generation/update.
- `REQ-006-mcp-skill-marketplace.png`: Capability Marketplace with MCP and recipe capabilities.
- `REQ-007-runtime-timeline.png`: Runtime Timeline drawer with structured events.
- `REQ-008-git-native-review-flow.png`: Git-native review flow panel with summary/risk/test output.

Residual rule:

If a future backfill run finds a missing UI entry, create a new GitHub issue first and reference it here. Do not silently fix extra scope while closing the screenshot backfill.
