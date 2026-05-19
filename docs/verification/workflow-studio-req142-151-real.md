# Workflow Studio REQ-142..151 Real Verification

Scope:
- `REQ-142 Workflow Template Detail Page`
- `REQ-143 Workflow Template Dependency Check`
- `REQ-144 Workflow Template Smoke Badge`
- `REQ-145 Workflow Template Version Upgrade`
- `REQ-146 Workflow Template Migration Notes`
- `REQ-147 Workflow Template Fork`
- `REQ-148 Workflow Package Export Wizard`
- `REQ-149 Workflow Package Import Preview`
- `REQ-150 Workflow Marketplace Trust Badge`
- `REQ-151 Workflow Enterprise Template Pack`

Real implementation evidence:
- Backend exposes `GET /api/workflow-templates/:templateId/detail` with manifest, DAG, dependency report, smoke status, and trust classification.
- Backend exposes `GET /api/workflow-templates/:templateId/dependencies`.
- Backend exposes `POST /api/workflow-templates/:templateId/fork` to create a project-private workflow copy.
- Backend exposes `POST /api/workflows/package/export/preview` and `POST /api/workflows/package/import/preview`.
- Backend exposes `GET/POST /api/workflows/:id/template-upgrade` for version comparison, migration notes, changelog, and upgrade.
- Built-in enterprise templates remain seeded from CrashSight Analysis, Redmine Review, Code Impact Analysis, and Publish PR recipes.
- Frontend reads real template detail, upgrade, dependency, trust, and package preview state instead of static text.

Verification commands:
- `npm run test:unit -- workflow-studio-service.test.mjs WorkflowStudio.test.tsx`
- `npm run typecheck`
- `DESKTOP_MODE=true WORKFLOW_REAL_SMOKE=1 npm run test:e2e:workflow-real`

Screenshot evidence:
- `REQ-142-workflow-template-detail-page.png`
- `REQ-143-workflow-template-dependency-check.png`
- `REQ-144-workflow-template-smoke-badge.png`
- `REQ-145-workflow-template-version-upgrade.png`
- `REQ-146-workflow-template-migration-notes.png`
- `REQ-147-workflow-template-fork.png`
- `REQ-148-workflow-package-export-wizard.png`
- `REQ-149-workflow-package-import-preview.png`
- `REQ-150-workflow-marketplace-trust-badge.png`
- `REQ-151-workflow-enterprise-template-pack.png`
