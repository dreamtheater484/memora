# The `.memora` archive format

> **Placeholder.** The full specification is written in Phase 9, when import and export are built. The design is outlined in [section 8.4 of the implementation plan](IMPLEMENTATION_PLAN.md#84-memora-archive-format-v1).

## Principles

- **Open and readable.** A `.memora` file is a zip archive of JSON, Markdown and image files. Rich pages also include a rendered HTML copy, so the content can be read without Memora.
- **Versioned.** `manifest.json` records `formatVersion`. Memora imports every older version, and refuses files that are newer than itself with a clear message.
- **Optionally encrypted.** An encrypted archive starts with the magic bytes `MEMORAENC1`, followed by the key-derivation (scrypt) parameters, a salt, a nonce, and the zip encrypted with AES-256-GCM.
