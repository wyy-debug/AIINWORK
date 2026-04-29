# Redmine REST 说明

使用：

```text
GET /issues/:id.json?include=journals,attachments,changesets,relations
```

认证头：

```text
X-Redmine-API-Key: <token>
```

SOC 评审中，changesets 是从单据映射到代码的关键证据：

- `revision`
- `branch`
- `repository.id`
- `repository.name`
- `files[].path`
- `files[].action`

单据 API 不一定提供完整 patch 文本。优先使用用户传入的本地 git 仓库，根据 revision 获取 diff。
