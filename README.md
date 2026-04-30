# vault-recall

Local semantic recall for Obsidian vaults.

I built this because my Obsidian vault had become too big to search by memory.

Keyword search was not enough. I did not always remember the exact words I used. Sometimes I only remembered the shape of a thought.

So this tool turns Markdown notes into a local SQLite index with:

- full-text search
- optional embeddings
- semantic search
- similar-note lookup
- no background server
- no Obsidian plugin
- no `node_modules` required
- no cloud upload of your notes

It is not a second brain app.

It is a recall layer for the one you already have.

## Why

A large Obsidian vault can quietly become a warehouse.

The notes are there. The thoughts are there. But when you sit down to write or decide something, you still have to remember the old file name, the exact keyword, or the folder where that thought landed six months ago.

That breaks the loop.

`vault-recall` is a small local CLI that helps you ask fuzzy questions like:

```text
I wrote something about fear of publishing
```

and find notes that might have used different words:

```text
hiding in tooling
workflow too heavy
afraid to be seen
cold start feedback
```

## What it does

`vault-recall`:

1. scans Markdown files in an Obsidian vault
2. parses simple YAML frontmatter
3. extracts titles and headings
4. chunks note text
5. stores everything in SQLite
6. creates a SQLite FTS index
7. optionally stores embeddings from an OpenAI-compatible API
8. searches by keyword or semantic similarity

## What it does not do

- It does not run a background service.
- It does not install dependencies.
- It does not modify your vault.
- It does not require an Obsidian plugin.
- It does not upload your notes unless you explicitly use a remote embedding API.
- It does not manage your knowledge system for you.

## Requirements

- [Bun](https://bun.sh/)
- An Obsidian vault, or any folder of Markdown files
- Optional: an OpenAI-compatible embedding API key

This is a no-deps single-file tool. You do not need to run `bun install`.

## Quick start

Clone this repo, then copy the config examples:

```bash
cp config.example.json config.json
cp .env.example .env
```

Edit `config.json`:

```json
{
  "vaultRoot": "C:/Users/you/ObsidianVault",
  "databasePath": "./data/vault-recall.db",
  "include": ["**/*.md"],
  "exclude": [
    ".obsidian/**",
    ".git/**",
    "node_modules/**",
    ".venv/**",
    "**/*.response.json"
  ],
  "chunk": {
    "maxChars": 900,
    "overlapChars": 120,
    "minChars": 80
  }
}
```

Build a local keyword index:

```bash
bun vault-recall.ts index
```

Search:

```bash
bun vault-recall.ts search "fear of publishing"
```

See stats:

```bash
bun vault-recall.ts stats
```

## Semantic search

Set an embedding provider in `.env`.

### SiliconFlow bge-m3

```bash
SILICONFLOW_API_KEY=your_key_here
EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1
EMBEDDING_MODEL=BAAI/bge-m3
```

Then build with embeddings:

```bash
bun vault-recall.ts index --embed
```

Run semantic search:

```bash
bun vault-recall.ts search "I wrote something about hiding in tooling instead of shipping" --semantic
```

Find notes similar to a draft:

```bash
bun vault-recall.ts similar draft.md
```

## Commands

```bash
bun vault-recall.ts index [--embed] [--config config.json]
bun vault-recall.ts search <query> [--semantic] [--limit 10] [--config config.json]
bun vault-recall.ts similar <text-or-file> [--limit 10] [--config config.json]
bun vault-recall.ts stats [--config config.json]
```

## Data and privacy

The SQLite database lives wherever `databasePath` points. By default:

```text
./data/vault-recall.db
```

The database can contain chunks of your note text and embeddings. It is ignored by git in this repo.

If you use a remote embedding API, note chunks are sent to that API during indexing. If you do not want that, run without `--embed` and use FTS-only mode.

## Why not an Obsidian plugin?

Because the first version should be boring.

A CLI is easier to audit, easier to run, and harder to turn into a whole new productivity system. The goal is not to build another app. The goal is to make your existing vault easier to recall from.

## License

MIT
