# vault-recall release checklist

## Before publishing to GitHub

- [x] Tool name changed to `vault-recall`
- [x] Personal vault paths removed from source
- [x] API key not present in tracked example files
- [x] `.env` ignored
- [x] `config.json` ignored
- [x] SQLite DB ignored
- [x] `node_modules/` ignored
- [x] README written
- [x] MIT LICENSE added
- [x] `config.example.json` added
- [x] `.env.example` added
- [x] Local FTS indexing tested
- [x] Local semantic indexing tested with SiliconFlow `BAAI/bge-m3`

## Local test evidence

```text
Indexed 567 markdown files, 1725 chunks.
Embeddings: enabled
embedded_chunks: 1725
```

Semantic query tested:

```text
工具搭太重是在逃避发布
```

Top results correctly retrieved notes about:

- hiding in tooling
- fear of being seen
- workflow too heavy
- stop building, start publishing

## Before first push

Run from `vault-recall/`:

```bash
git init
git status --ignored
```

Make sure these are ignored:

```text
.env
config.json
data/vault-recall.db
data/vault-recall.db-shm
data/vault-recall.db-wal
```

Then:

```bash
git add README.md LICENSE .gitignore .env.example config.example.json vault-recall.ts data/.gitkeep docs/x-launch-thread-zh.md docs/release-checklist.md
git commit -m "Initial commit"
```

## X launch

1. Publish `docs/x-launch-thread-zh.md` as the main X long post.
2. Put the GitHub repo link in the first comment, not the main post.
3. After 24h, record:
   - impressions
   - likes
   - replies
   - profile visits
   - GitHub stars
   - useful comments
