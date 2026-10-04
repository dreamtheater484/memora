# Changelog

What changed in each Memora release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). [UPGRADE.md](docs/UPGRADE.md) explains how to update.

## [Unreleased]

## [0.10.0] - 2026-10-04

### Added

- **Sync your computers through a folder in the cloud** (Memora for your computer, **Settings → Sync**): Google Drive, Infomaniak kDrive, Nextcloud or another WebDAV server, or any folder a sync app keeps up to date. No server or Docker needed. [DESKTOP.md](docs/DESKTOP.md#sync-your-computers) explains it.
  - **Memora uses one folder and nothing else.** On Google Drive, Google enforces it: Memora asks only to see the files it creates. On WebDAV, Memora keeps to the folder's address itself, and asks for an application password.
  - **Encrypted on your computer** with a passphrase only you know, before anything reaches the folder: notes, files and their names. The cloud provider can't read them.
  - Each computer keeps its own copy, so Memora still works offline; changes go through the folder within seconds.
  - Pages changed on two computers at once: Markdown is merged when the changes don't overlap; otherwise the other text is kept in the page's history. Tags, project keys and card numbers made on two computers at once are sorted out by themselves.
  - The sign-in and the key are kept by the computer's own protection (Windows credential store, macOS Keychain, Linux keyring), never with the notes or in backups.
- A sync indicator in the top bar of the desktop app, and the list of computers that sync.
- A privacy page on the download site.

## [0.9.7] - 2026-10-03

### Added

- **Edit words where they are, in every diagram:** double-click a box, arrow, group, topic, participant, message, note, block, period, event, task, slice or value on the drawing (or select it and press `F2`, or just start typing) and type. `Enter` keeps the words, `Shift+Enter` breaks a line, `Tab` keeps them and goes on (a connected box, a topic under it, the reply to a message), `Esc` leaves them as they were. Clicking the drawing selects the panel's row, and working in a row marks its item on the drawing.
- **Keys for diagrams, after MindManager's:** `Enter` and `Shift+Enter` add the next item after or before the selected one, `Tab` or `Insert` one under it, `Ctrl/Cmd+Shift+Enter` one above it (or puts a step in a loop), `Alt+Enter` a note; the arrow keys, `Home` and `End` select; `Alt+↑`/`↓` move, `Alt+Shift+←`/`→` change the level; `Delete`, `Ctrl/Cmd+D`, `C`, `X`, `V`; `Ctrl/Cmd+A`, `K` and `G` select, connect and group boxes; `Ctrl/Cmd+1…9` and `Alt+0…8` set shapes and colours; `Ctrl/Cmd++`, `−` and `0` zoom; `Ctrl/Cmd+Enter` is Done. `?` in the editor lists them all.
- **Flowcharts:** `Shift` and a drag over empty space selects the boxes in it; drag a box onto a group to put it in, or onto empty space to take it out; delete a group with its boxes; every shape in the panel.
- **Sequence diagrams:** new steps go inside a selected block; steps move into and out of blocks with `Alt+↑`/`↓`, `Alt+Shift+←`/`→` or by dragging their grip; each message's arrow and activation are set from a menu between its two participants; new messages start like the selected one.
- **Timelines, Gantt charts and pie charts:** periods, events, sections, tasks and slices move both ways (tasks and periods across sections); a Gantt task can end on a date or when another task starts, and be critical or a milestone as well as done or active; sections can be removed with or without what they hold.
- **A Fit size for diagrams in rich pages:** the diagram fills the text's width and follows it; Word, PDF and HTML exports do the same.

### Changed

- **The diagram editor changes only what you edit:** every other line of the code, its comments, blank lines and layout stay exactly as they were, which keeps Markdown pages and their history tidy. (Before, one small change rewrote the whole diagram, quoting labels and splitting chains of arrows.)
- **One undo history** for the drawing, the panel and the code: `Ctrl/Cmd+Z` in a panel field or the code undoes there too, and brings back what was selected.
- The panel's fields grow with their words and take line breaks (`Shift+Enter`); rows that are added get the cursor; `Enter` in a row adds the next one, `Alt+↑`/`↓` moves it, `↑`/`↓` go to the next field.
- While a dialog is open, such as the diagram editor, the app's shortcuts (`Ctrl/Cmd+K`, `Ctrl/Cmd+Alt+N`…) wait instead of acting on the page behind it.
- On a phone, the diagram editor's header takes two rows and the drawing is fitted to the width at a readable size; the drawing gives way to the keyboard while you type in the panel.
- Done Gantt tasks are drawn with a clear outline.

### Fixed

- **Converting a page between rich text and Markdown more than once could break it:** the Markdown editor showed the rich page's raw code, and the next keystroke saved it over the page. An editor open on a page that is converted (here or elsewhere) never writes its old text over it any more; anything typed in it that wasn't saved yet is kept as a version.
- **Clearing a label no longer breaks a diagram:** emptying a mind map topic deleted it (and moved what was under it), and an empty participant, timeline period or section, or Gantt task gave a broken or unreadable diagram. Empty labels, titles and messages are allowed in every kind of diagram, and spaces typed at the start or end of a label are kept.
- Double quotes, `#` and `;` in flowchart and mind map labels showed as `&quot;` and other codes; quotes in mind maps became typographic ones, and a literal `#35;` typed in a label was read as a code.
- Labels and settings with `:`, `;`, `|`, `%%`, brackets or a backslash broke flowcharts, timelines, Gantt and pie charts in several places (for example `axisFormat %H:%M`, an event at `10:30`, or a pie's `showData`); boxes in nested groups could end up in the wrong group.
- An empty loop or branch in a sequence diagram was drawn one letter per line, with the steps after it overlapping the participants.
- `Esc` while renaming on the drawing kept the new words instead of leaving the old ones.
- Clicking a message's words, a block or its condition on a sequence diagram now selects it.
- Removing a Gantt task or section no longer breaks the tasks that started after it.
- In Split view, the Markdown source no longer cuts off diagrams and long lines.
- Diagrams in list items, nested lists, quotes and callouts are drawn in the source view, and editing them keeps the list or quote intact.
- ` ```Mermaid ` and ` ```MERMAID ` are diagrams everywhere: source, preview, rich pages, history, exports, search and snippets.
- Converting a rich page to Markdown no longer loses a diagram inside a table cell: it moves just below the table, and the dialog says so.
- Screen readers name diagrams edited as code by their kind (a class diagram, a state diagram…), not just "Diagram".

### Development

- `PORT` also moves the dev server's API proxy, and `MEMORA_DEV_API` points it at another API. The dev preview no longer fails with "document is not defined".
- Mermaid 12.0.0 is patched (`patches/`, applied by pnpm) to decode all entities in SVG labels.

## [0.9.6] - 2026-10-01

### Added

- **A diagram editor:** flowcharts, mind maps, sequence diagrams, timelines, Gantt charts and pie charts, made by pointing and typing. `/diagram` (or **Insert → Diagram** in rich pages) opens a gallery of templates; the editor shows the real drawing with a panel for what is selected, and **Done** puts the diagram in the page. Underneath, a diagram is Mermaid code, so other Mermaid tools still draw it.
  - **Flowcharts:** click a box to select it, `Enter` to rename it, **+** (or `Tab`) for a connected box, drag one box onto another to connect them. Shapes, colours, arrow labels and lines, groups, and the direction of the whole chart are in the panel.
  - **Mind maps** are edited as an outline, and laid out around their centre with each branch in its own colour.
  - **Sequence diagrams:** participants, then messages, notes, loops and alternatives in order.
  - **Timelines, Gantt charts and pie charts** are edited as lists.
  - Undo and redo, zoom and pan, and the keys in the shortcuts sheet (`?`).
- **Diagrams in rich pages** are selected like an image: resize them, align them, give them a caption, or copy them as a picture.
- **Diagrams in the Markdown source:** each ` ```mermaid ` block is drawn in place of its code, with **Edit diagram** and **Show code**, until you put the cursor in it. **Settings → Editing → Draw diagrams in the source** turns this off. The preview has an **Edit** button on each diagram.
- Word, PDF and HTML exports draw diagrams (as a picture in Word), and the history shows them drawn.

### Changed

- **Diagrams look like Memora:** its section colours, its font, rounded boxes with a soft shadow, light and dark. Mind maps are laid out as a tidy tree either side of their centre rather than scattered.
- A diagram too wide for the page scrolls sideways once shrinking it further would make its words too small to read.

### Fixed

- With the system set to reduce motion, diagrams could come out cut off.

## [0.9.5] - 2026-10-01

### Changed

- **Rich text pages read like a notebook page:** the text starts at the top left, under the title, and fills the pane, rather than sitting in a centred column. Drag the text's right edge to make it narrower; each page keeps its own width. Double-click the edge, or choose **Fit the text to the pane** in the page's menu, to fill the pane again. A4 and Letter sheets work as before.
- **Compact spacing:** lines and paragraphs sit closer together, and headings have no line under them. **Settings → Editing → Rich text pages** switches between **Compact** (the default) and **Comfortable**, and sets the font and size of text that has none of its own.
- **More fonts:** Arial, Calibri, Cambria, Courier New, Georgia, Times New Roman and Verdana join the font list. In the desktop app and in Chrome or Edge, **This computer's fonts…** offers every font installed on the computer.
- **The toolbar takes two rows** when one is too narrow, instead of moving lists, indents, colours and fonts into **More**. Related tools stay together, and alignment and line spacing show their icons.
- `Tab` and `Shift+Tab` indent and outdent any text in a rich page, not only list items, and never move the cursor out of the page by accident: `Esc`, then `Tab`, does that. Indents are kept in Word, HTML and PDF exports.
- The keyboard shortcuts sheet (`?`) lists the rich text editor's keys.

### Added

- **To-dos from the keyboard:** `Ctrl/Cmd+1` makes a line a to-do, and ticks it when it already is one; `Ctrl/Cmd+Enter` ticks or unticks it.
- `Ctrl+Space` clears the formatting of the selected text.
- `Enter` in a page's title goes on to the page's text.
- Clicking beside or below a rich page's text puts the cursor on the nearest line.

### Fixed

- **To-do lists in rich pages:** the box sat on a line of its own, and the text went beneath it. The box is now on the line of its text and bigger to click, done items are struck through, and nested to-dos are indented.
- Typing straight after clicking a page's title could lose the first letter.

## [0.9.4] - 2026-09-30

### Fixed

- **The desktop app's icon on Ubuntu:** the launcher and the dock showed a gear instead of Memora's icon. The icon now comes in every size Ubuntu looks for, and the running window is matched to it. On Windows the icon fills its square like other apps' do; on macOS it keeps Apple's margin.
- **A section's default template** couldn't be chosen with the mouse: the choice was in a submenu that closed before the click. It's now a small dialog, **Default template…**, in the **▾** menu beside **+ Page** and in a section's right-click menu.

### Changed

- **Templates are easier to find:** an empty section offers **From a template** beside **New page**, and says which template its new pages start from. A section's right-click menu has **New page from a template…**. The Templates dialog lists where to find each of these.
- The download page no longer says the app updates itself everywhere: it tells you when there's a new version, and installs it itself on Windows.

## [0.9.3] - 2026-09-30

### Added

- **Memora for your computer:** the desktop app for Windows, macOS and Ubuntu. Download it, open it, start writing: no Docker, no server and no account. It's the same Memora, with its built-in server listening on the computer only. On Windows it updates itself; elsewhere it says when a new version is out. It backs up by itself too, catching up on the nightly backup when it was closed at night. [DESKTOP.md](docs/DESKTOP.md)
- A [download page](https://dreamtheater484.github.io/memora/) that offers the right download for the visitor's computer, and the way to Memora Server.
- Every release now has the installers too: `Memora-Setup.exe`, `Memora.dmg`, `.deb` packages for Ubuntu on amd64 and arm64, and AppImages. The release workflow builds each on its own system, installs it and tests it there.
- Signing is ready for Windows and macOS: it turns on once the certificates are set up. Until then, the app needs one extra step on its first start. A Microsoft Store package can be made too. [SIGNING.md](docs/SIGNING.md)

### Changed

- The documentation presents the two variants: Memora for your computer, and Memora Server for Docker and a NAS. [SETUP.md](docs/SETUP.md) is now the server guide.
- The open-source licences: packages without a licence file are listed with the full standard text of the licence they name. The list notes where Shiki's grammars and themes come from, and the Docker image's list names its Debian base system.

## [0.9.2] - 2026-09-30

### Added

- A **…** button on notebooks, section groups and sections opens their menu (new section, rename, colour, export, delete), in the navigation and in the phone lists. It is the same menu a right-click or long-press opens.
- **Settings → Open-source licences** lists every package Memora ships, with its licence, and Node.js's own. The list is made at build time from what each build contains and is in the container image too. A build stops on a licence nobody has reviewed yet.
- Credits in the README.

### Changed

- The setup guide has a table of requirements: DSM 7.2 or later, a 64-bit processor, and 512 MB of free memory recommended. It also says how to check a Synology NAS, and the Synology steps include a complete compose file.
- The memory figures in the guides now match what Container Manager shows: usually 100 to 150 MB, and more for a while during large imports and exports.
- Memora is described in its own terms, without comparisons to other note apps.

## [0.9.1] - 2026-09-30

### Changed

- No more `PUID` and `PGID`: Memora runs as the owner of its data folder, so creating the folder is all the setup it needs, on a Synology NAS too. `PUID`/`PGID` still work to choose another user. Existing installs keep working as they are.
- When the data folder isn't writable, the message says who owns it and what to change.
- The Synology guide: create the `data` folder before starting (Container Manager stops with _"Bind mount failed"_ otherwise), how to use another port, and to leave the Web Station portal off.

### Fixed

- Links in the release notes on GitHub lead to the documents again.

## [0.9.0] - 2026-09-30

The first release: a public beta. Everything planned for 1.0 is in; what's left is time in real use (see Phase 13 in [the plan](docs/IMPLEMENTATION_PLAN.md)).

### Notes and organisation

- Notebooks with colours and icons, section groups nested up to four levels, and sections as coloured tabs. Pages have subpages up to three levels deep.
- Drag and drop to reorder and move things; multi-select pages to move, copy or delete them together; every delete can be undone.
- An Inbox for quick notes (`Ctrl/Cmd+Alt+N`, or the pen button on phones).
- Keyboard shortcuts for every action, with a reference sheet (`?`), and a command palette (`Ctrl/Cmd+K`).

### Editors

- **Markdown pages:** a Notepad++-style source view beside a live preview (or either alone).
  - Tables line up by themselves, emoji and Chinese, Japanese and Korean text included, with a grid editor.
  - GitHub-flavoured Markdown, footnotes, alerts, maths (KaTeX), diagrams (Mermaid) and highlighted code.
  - Find and replace, an outline, and word counts.
- **Rich text pages:** a word processor with a Home / Insert / Table toolbar.
  - Tables with merged cells and colours, images with captions, file attachments, callouts, maths and code.
  - An A4 or Letter page view.
- **Pasting:** clean pastes from Word, Google Docs and web pages, and screenshots straight from the clipboard. Images from web pages are downloaded by the server, so pages never depend on other sites.
- Pages convert between Markdown and rich text, with a report of what Markdown can't keep.

### Saving, offline and sync

- Every keystroke is kept: saved on the device at once and on the server within seconds, with an honest "Saved" indicator.
- Works offline, including pages created offline. Other devices update live.
- Edits to the same Markdown page on two devices merge by themselves; real conflicts are yours to settle, side by side.

### History, recycle bin and backups

- A version history per page: compare any two versions, name versions, and restore (or restore as a copy).
- A recycle bin, emptied after 30 days.
- Scheduled backups, optionally encrypted, restored from Settings or the command line.

### Search, tags and links

- Full-text search as you type, with phrases, exclusions and filters, and a tag browser.
- Links between pages (`[[`) that survive renames, with backlinks and hover previews.
- Favourites, recent pages, and templates (five built in, your own, and a default per section).

### Import and export

- Export a page, section, notebook or everything as Markdown, Word, HTML, PDF, or a documented `.memora` archive (optionally encrypted).
- Import `.memora` archives, Markdown folders, Word, HTML and text files, or drop files onto a section.

### Kanban

- Projects with keys (`WEB-42`), boards from templates, and columns with WIP limits, colours and a Done flag.
- Swimlanes, by hand or by priority or label.
- Cards with descriptions, labels, dates, checklists, comments, attachments and an activity log.
- Cards drag with a mouse, a finger or the keyboard; boards update live.
- Any note links to any card, and card keys in notes link by themselves.

### Workspace and app

- On wide and ultra-wide screens, panes with tabs beside the main one (pages, boards, search, backlinks and history), with named layouts.
- Text keeps a readable width you choose.
- Installs as an app on phones and desktops, updates when you say so, and can keep every page on a device.
- Light and dark themes, full keyboard use, and screen-reader labels throughout.

### Security

- Argon2id passwords, server-side sessions that you can revoke per device, CSRF protection, throttled logins and an audit log.
- Two-step verification with an authenticator app, with recovery codes; administrators can require it.
- A strict Content Security Policy and security headers. A [security review](docs/SECURITY_REVIEW.md) covers the threat model and the OWASP ASVS Level 1 checklist.

### Running it

- One Docker image for amd64 and arm64 that runs as a non-root user in about 50 MB of RAM, with a health check.
- Setup guides for Synology, Linux and Windows, with three ways to get HTTPS.
- `memora-admin` inside the container for lost passwords, lost phones, backups and restores.

[Unreleased]: https://github.com/dreamtheater484/memora/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/dreamtheater484/memora/compare/v0.9.7...v0.10.0
[0.9.7]: https://github.com/dreamtheater484/memora/compare/v0.9.6...v0.9.7
[0.9.6]: https://github.com/dreamtheater484/memora/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/dreamtheater484/memora/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/dreamtheater484/memora/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/dreamtheater484/memora/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/dreamtheater484/memora/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/dreamtheater484/memora/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/dreamtheater484/memora/releases/tag/v0.9.0
