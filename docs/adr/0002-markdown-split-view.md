# ADR 0002: Markdown notes default to a split source/preview view

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Markdown notes need a "Notepad++-style" view: highlighted source with correctly aligned tables. They must also be easy to write, and the rendered result (images, diagrams, maths) must be visible. Ultra-wide screens offer plenty of horizontal space.

## Decision

- On desktop, Markdown notes default to **Split** view: CodeMirror 6 source with Notepad++-style highlighting on the left and a synchronised rendered preview on the right.
- **Source** and **Preview** modes are also available. Phones switch between the two.
- Tables in the source realign automatically as you type.
- An inline "Live" mode, which hides the markup the way Typora and Obsidian do, is a later (v1.x) candidate.

## Consequences

- It delivers exactly the requested view. It is the most robust option to build and makes good use of wide screens.
- Monospace source makes automatic table alignment reliable.
- Two panes use more width on small screens. Phones therefore use a toggle instead.
- The rendering pipeline (unified/remark) is shared by the preview, exports and search indexing.
