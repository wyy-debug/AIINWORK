# Argus Bridge for Obsidian

Argus Bridge is a local Obsidian Desktop plugin for writing Argus knowledge documents into a vault, reading authorized notes back as AI context, and sending the current Obsidian note or selection back to Argus.

## Install

Recommended for Argus users:

1. Open `Settings -> Runtime -> Argus Bridge for Obsidian`.
2. Click `Refresh vaults`.
3. Select the vault.
4. Click `Install plugin to vault`.
5. Reload Obsidian community plugins and click `Test connection` in Argus.

CLI fallback:

```powershell
npm run obsidian:install-bridge -- --vault "C:\Users\yckui\Documents\note\self"
```

The installer copies `manifest.json`, `main.js`, `core.js`, `core.cjs`, and `styles.css` into `.obsidian/plugins/argus-bridge/`, writes or keeps a pairing token in `data.json`, and adds `argus-bridge` to `community-plugins.json`.

Restart Obsidian or reload community plugins, then paste the pairing token into Argus Runtime settings.

## Smoke

```powershell
npm run obsidian:smoke-bridge -- --vault "C:\Users\yckui\Documents\note\self"
```

The smoke checks `/argus/v1/status`, writes one note for each mode, verifies `/argus/v1/search` and `/argus/v1/context`, and reports whether extended routes are loaded.

After reloading Obsidian community plugins, run strict extended smoke:

```powershell
npm run obsidian:smoke-bridge -- --vault "C:\Users\yckui\Documents\note\self" --require-extended
```

## Modes

- `project-knowledge`: `Argus/Projects/<project>/`
- `second-brain`: `Argus/SecondBrain/<YYYY>/`
- `ai-memory`: `Argus/AIMemory/<project-or-General>/`

Project notes update `Argus/Projects/<project>/Index.md` as a lightweight MOC.

## Extended Capabilities

- Active note: `GET /argus/v1/active` returns the current note, selection, Properties, headings, links, and cursor.
- Local patching: `POST /argus/v1/patch` can append/replace a heading or upsert frontmatter without replacing the whole note.
- Structured query: `POST /argus/v1/query` filters by Properties, tags, path, content, headings, and source type.
- Daily note append: `POST /argus/v1/periodic/append` appends to `Daily/YYYY-MM-DD.md` under the configured heading.
- Graph/MOC: `POST /argus/v1/graph` returns links, related Properties, backlinks, and managed index entries.
- Reverse send: command palette commands can send the current note or selection to Argus, create AI Memory candidates, ask Argus about the note, or append the selection to Daily.
- Canvas and Excalidraw indexing is read-only and based on file text/link extraction.
- Duplicate cleanup: `POST /argus/v1/duplicates/scan` and `POST /argus/v1/duplicates/archive` group notes by `argusId`, `sourceArtifactId`, or `contentHash`, keep the latest, and move older notes into `Argus/_duplicates/<YYYY-MM-DD>/`.

## Templates

Configure templates in the plugin settings. Variables include `{{title}}`, `{{content}}`, `{{projectName}}`, `{{sessionId}}`, `{{mode}}`, and `{{kind}}`.

## Command Palette

- `Argus: Start bridge`
- `Argus: Stop bridge`
- `Argus: Restart bridge`
- `Argus: Copy token`
- `Argus: Send current note to Argus`
- `Argus: Send selected text to Argus`
- `Argus: Create Argus memory from selection`
- `Argus: Ask Argus about this note`
- `Argus: Append selection to Daily note`
- `Argus: Archive duplicate Argus notes`

## Security

The plugin binds only to `127.0.0.1`, requires the bearer pairing token, writes only Markdown inside the vault, and limits search/context to configured readable folders.
