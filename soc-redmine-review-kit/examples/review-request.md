# Example Request

Use `soc-redmine-review-agent` with:

```text
issueId: 116320
codeRoot: D:\socgraphics
```

Expected report:

- The Agent prints the complete Chinese Markdown report directly in the current chat.
- The Agent does not ask for `outputPath`.
- The Agent does not write `redmine-116320-review.md` or any other report file.

The Agent should:

1. Fetch the issue through `MCP: soc-redmine`.
2. Fetch changesets and revision diffs.
3. Use `MCP: ainwork-code-search` for semantic impact, passing `codeRoot` as the tool `root`.
4. Fall back to text search if semantic impact is unavailable.
5. Output the full Markdown report in chat only.
