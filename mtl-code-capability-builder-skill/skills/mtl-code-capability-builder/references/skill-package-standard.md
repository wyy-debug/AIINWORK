# Skill Package Standard

## Directory Shape

Use this structure:

```text
skill-name/
  SKILL.md
  agents/openai.yaml
  references/*.md
  scripts/*        optional
  assets/*         optional
```

`SKILL.md` is required at the package root. `agents/openai.yaml` is recommended for MTL-Code UI display.

## SKILL.md Rules

Frontmatter must contain only the essential trigger fields:

```markdown
---
name: skill-name
description: Clear trigger description with when-to-use contexts.
---
```

Write instructions for another agent to follow. Include non-obvious local rules and workflows, not generic advice. Keep `SKILL.md` concise; move detailed tables, schemas, rubrics, and examples into `references/`.

## openai.yaml Rules

Use the local simple format unless the surrounding project expects the newer nested `interface:` shape:

```yaml
display_name: Human Name
short_description: One-line UI description.
default_prompt: Use $skill-name to perform the workflow.
```

The default prompt should mention `$skill-name`.

## References

Reference files should be one level below `references/`. Link them from `SKILL.md` and say when to read them. Avoid deeply nested reference chains.

## Scripts

Prefer Node scripts for validation or deterministic generation when users may not have Python modules such as PyYAML. Scripts must avoid writing outside intended output paths and must not read secrets unless explicitly part of the user task.

## Validation Checklist

- Directory name equals frontmatter `name`.
- `SKILL.md` exists and has closed frontmatter.
- `name` is lowercase hyphen-case.
- `description` is specific and at least one full sentence.
- `agents/openai.yaml` includes display name, short description, and default prompt.
- No tokens, API keys, or local private paths are embedded.
