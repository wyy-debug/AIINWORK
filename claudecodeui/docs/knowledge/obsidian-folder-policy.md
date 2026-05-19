# Obsidian Folder Policy

Argus writes project Wiki material into these current folders:

- `Argus/Wiki/<project>`: curated compiled notes used for readback.
- `Argus/Raw/<project>`: imported source material before compilation.
- `Argus/_Indexes`: generated lookup and index pages.
- `Argus/Archive`: legacy generated notes and migration cleanup output.

`Argus/AIMemory` is legacy read-only migration input. It is no longer part of default readback, and new explicit Wiki writes should target `Argus/Wiki/<project>`.

Use the migration preview before changing a vault. The preview classifies generated AIMemory notes for archive/relabel, generated project notes for Wiki relocation, and skips manually curated Wiki notes.
