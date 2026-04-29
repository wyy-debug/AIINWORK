# SOC Redmine MCP

Local stdio MCP server for SOC Redmine issue intake and revision diff retrieval.

## Tools

- `get_issue`: fetch issue title, description, custom fields, journals, attachments, changesets, and relations.
- `get_issue_changesets`: fetch linked revisions and touched files.
- `get_revision_diff`: prefer local `git show --stat --patch`, then try Redmine revision diff fallback.

## Run

```powershell
cd E:\AIINWORK\soc-redmine-mcp
npm install
$env:REDMINE_BASE_URL="http://soc-redmine.wd.com"
$env:REDMINE_API_KEY="<your-redmine-api-key>"
npm start
```

Never commit `REDMINE_API_KEY`. Configure it in local MCP env only.

## MCP Config

```json
{
  "mcpServers": {
    "soc-redmine": {
      "type": "stdio",
      "command": "node",
      "args": ["E:\\AIINWORK\\soc-redmine-mcp\\src\\server.js"],
      "env": {
        "REDMINE_BASE_URL": "http://soc-redmine.wd.com",
        "REDMINE_API_KEY": "<your-redmine-api-key>"
      }
    }
  }
}
```
