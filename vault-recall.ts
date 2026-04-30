#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "path";

type Config = {
  vaultRoot: string;
  databasePath?: string;
  include?: string[];
  exclude?: string[];
  chunk?: { maxChars?: number; overlapChars?: number; minChars?: number };
};

type LoadedConfig = {
  root: string;
  dbPath: string;
  include: string[];
  exclude: string[];
  maxChars: number;
  overlapChars: number;
  minChars: number;
};

const TOOL_DIR = process.cwd();
const DEFAULT_CONFIG_PATH = join(TOOL_DIR, "config.json");
const DEFAULT_ENV_PATH = join(TOOL_DIR, ".env");
const DEFAULT_DB_PATH = join(TOOL_DIR, "data", "vault-recall.db");

function usage() {
  console.log(`vault-recall\n\nLocal semantic recall for Obsidian vaults.\n\nUsage:\n  bun vault-recall.ts index [--embed] [--config config.json]\n  bun vault-recall.ts search <query> [--semantic] [--limit 10] [--config config.json]\n  bun vault-recall.ts similar <text-or-file> [--limit 10] [--config config.json]\n  bun vault-recall.ts stats [--config config.json]\n\nExamples:\n  bun vault-recall.ts index\n  bun vault-recall.ts index --embed\n  bun vault-recall.ts search "I wrote something about fear of publishing" --semantic\n  bun vault-recall.ts similar draft.md\n\nNo package.json. No bun install. No node_modules required.\n`);
}

function argValue(args: string[], name: string, fallback = "") {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

function parseLimit(args: string[], fallback = 10) {
  const raw = argValue(args, "--limit", String(fallback));
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadLocalEnv(path = DEFAULT_ENV_PATH) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    val = val.replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

function loadConfig(args: string[]): LoadedConfig {
  loadLocalEnv();
  const configPath = argValue(args, "--config", DEFAULT_CONFIG_PATH);
  if (!existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}\nCopy config.example.json to config.json and set vaultRoot.`);
  }
  const cfg = JSON.parse(readFileSync(configPath, "utf8")) as Config;
  if (!cfg.vaultRoot) throw new Error("config.vaultRoot is required");
  const root = resolvePath(cfg.vaultRoot, dirnameOf(configPath));
  const dbPath = resolvePath(cfg.databasePath || DEFAULT_DB_PATH, dirnameOf(configPath));
  return {
    root,
    dbPath,
    include: cfg.include?.length ? cfg.include : ["**/*.md"],
    exclude: cfg.exclude?.length ? cfg.exclude : [".obsidian/**", ".git/**", "node_modules/**", ".venv/**", "**/*.response.json"],
    maxChars: cfg.chunk?.maxChars || 900,
    overlapChars: cfg.chunk?.overlapChars || 120,
    minChars: cfg.chunk?.minChars || 80,
  };
}

function dirnameOf(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(0, idx) : ".";
}

function resolvePath(path: string, base: string) {
  if (/^[A-Za-z]:[\\/]/.test(path)) return path;
  return isAbsolute(path) ? path : resolve(base, path);
}

function normalizeRel(path: string) { return path.replace(/\\/g, "/"); }
function relPath(root: string, path: string) { return normalizeRel(relative(root, path)); }

function globToRegExp(glob: string): RegExp {
  const g = normalizeRel(glob);
  let out = "";
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === "*") {
      if (g[i + 1] === "*") {
        if (g[i + 2] === "/") { out += "(?:.*/)?"; i += 2; }
        else { out += ".*"; i += 1; }
      } else {
        out += "[^/]*";
      }
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

function matchesAny(rel: string, patterns: string[]) {
  return patterns.some(pattern => globToRegExp(pattern).test(rel));
}

function shouldIndex(rel: string, config: LoadedConfig) {
  if (extname(rel).toLowerCase() !== ".md") return false;
  if (!matchesAny(rel, config.include)) return false;
  if (matchesAny(rel, config.exclude)) return false;
  return true;
}

function walkMarkdown(dir: string, config: LoadedConfig, out: string[] = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    const fp = join(dir, ent.name);
    const rel = relPath(config.root, fp);
    if (ent.isDirectory()) {
      if (!matchesAny(rel + "/", config.exclude) && !matchesAny(rel, config.exclude)) walkMarkdown(fp, config, out);
    } else if (ent.isFile() && shouldIndex(rel, config)) {
      out.push(fp);
    }
  }
  return out;
}

function parseFrontmatter(text: string): { fm: Record<string, string>, body: string } {
  if (!text.startsWith("---")) return { fm: {}, body: text };
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, body: text };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      value = value.replace(/^['"]|['"]$/g, "");
      if (key && value && !value.startsWith("[") && !value.startsWith("{")) fm[key] = value;
    }
  }
  return { fm, body: text.slice(m[0].length) };
}

function extractTitle(body: string, file: string) {
  const h1 = body.split(/\r?\n/).find(line => /^#\s+/.test(line.trim()));
  return h1 ? h1.replace(/^#\s+/, "").trim() : basename(file, ".md");
}

function extractHeadings(body: string) {
  return body.split(/\r?\n/)
    .filter(line => /^#{1,4}\s+/.test(line.trim()))
    .slice(0, 30)
    .map(line => line.trim())
    .join(" | ");
}

function stripMarkdown(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/[#>*_`~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkText(text: string, config: LoadedConfig) {
  const clean = stripMarkdown(text);
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(clean.length, i + config.maxChars);
    const zhCut = clean.lastIndexOf("。", end);
    const enCut = clean.lastIndexOf(".", end);
    const cut = Math.max(zhCut, enCut);
    if (cut > i + Math.floor(config.maxChars * 0.35)) end = cut + 1;
    const chunk = clean.slice(i, end).trim();
    if (chunk.length >= config.minChars) chunks.push(chunk);
    if (end >= clean.length) break;
    i = Math.max(0, end - config.overlapChars);
  }
  return chunks;
}

function inferKind(rel: string, fm: Record<string, string>) {
  const s = rel.toLowerCase();
  const type = (fm.type || "").toLowerCase();
  if (type) return type;
  if (s.includes("readme")) return "readme";
  if (s.includes("index")) return "index";
  if (s.includes("draft")) return "draft";
  if (s.includes("final")) return "final";
  if (s.includes("review") || s.includes("retro") || s.includes("复盘")) return "review";
  if (s.includes("strategy") || s.includes("策略")) return "strategy";
  return "note";
}

function inferArea(rel: string) {
  const parts = rel.split("/");
  return parts.length > 1 ? parts[0] : "root";
}

function ensureDirForFile(path: string) { mkdirSync(dirnameOf(path), { recursive: true }); }

function openDb(config: LoadedConfig) {
  ensureDirForFile(config.dbPath);
  const db = new Database(config.dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS docs (
      id INTEGER PRIMARY KEY,
      path TEXT UNIQUE,
      title TEXT,
      headings TEXT,
      kind TEXT,
      area TEXT,
      status TEXT,
      updated TEXT,
      mtime REAL,
      size INTEGER
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      doc_id INTEGER,
      chunk_index INTEGER,
      text TEXT,
      embedding TEXT,
      FOREIGN KEY(doc_id) REFERENCES docs(id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, title, path, kind, area, content='');
  `);
  return db;
}

function resetDb(db: Database) { db.exec("DELETE FROM chunks_fts; DELETE FROM chunks; DELETE FROM docs;"); }

async function embedTexts(texts: string[]): Promise<number[][]> {
  const siliconFlowKey = process.env.SILICONFLOW_API_KEY || "";
  const openaiKey = process.env.OPENAI_API_KEY || "";
  const apiKey = siliconFlowKey || openaiKey;
  const baseURL = process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || (siliconFlowKey ? "https://api.siliconflow.cn/v1" : "https://api.openai.com/v1");
  const model = process.env.EMBEDDING_MODEL || (siliconFlowKey ? "BAAI/bge-m3" : "text-embedding-3-small");
  if (!apiKey) throw new Error("Missing embedding API key. Set SILICONFLOW_API_KEY or OPENAI_API_KEY, or run index without --embed.");
  const res = await fetch(`${baseURL.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts })
  });
  if (!res.ok) throw new Error(`Embedding API error ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  return data.data.map((d: any) => d.embedding as number[]);
}

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function indexCommand(args: string[]) {
  const config = loadConfig(args);
  const embed = args.includes("--embed");
  const db = openDb(config);
  resetDb(db);
  const files = walkMarkdown(config.root, config);
  const insertDoc = db.query(`INSERT INTO docs (path,title,headings,kind,area,status,updated,mtime,size) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`);
  const insertChunk = db.query(`INSERT INTO chunks (doc_id,chunk_index,text,embedding) VALUES (?,?,?,?) RETURNING id`);
  const insertFts = db.query(`INSERT INTO chunks_fts (rowid,text,title,path,kind,area) VALUES (?,?,?,?,?,?)`);
  let chunkCount = 0;
  for (const file of files) {
    const rel = relPath(config.root, file);
    const st = statSync(file);
    const raw = readFileSync(file, "utf8");
    const { fm, body } = parseFrontmatter(raw);
    const title = extractTitle(body, file);
    const headings = extractHeadings(body);
    const kind = inferKind(rel, fm);
    const area = inferArea(rel);
    const status = fm.status || "";
    const updated = fm.updated || fm.date || fm.created || "";
    const row: any = insertDoc.get(rel, title, headings, kind, area, status, updated, st.mtimeMs, st.size);
    const chunks = chunkText(`${title}\n${headings}\n${body}`, config);
    let embeddings: number[][] = [];
    if (embed && chunks.length) {
      for (let i = 0; i < chunks.length; i += 64) {
        embeddings.push(...await embedTexts(chunks.slice(i, i + 64)));
      }
    }
    for (let i = 0; i < chunks.length; i++) {
      const emb = embeddings[i] ? JSON.stringify(embeddings[i]) : null;
      const chunkRow: any = insertChunk.get(row.id, i, chunks[i], emb);
      insertFts.run(chunkRow.id, chunks[i], title, rel, kind, area);
      chunkCount++;
    }
  }
  console.log(`Indexed ${files.length} markdown files, ${chunkCount} chunks.`);
  console.log(`DB: ${config.dbPath}`);
  console.log(embed ? "Embeddings: enabled" : "Embeddings: disabled, FTS-only");
}

function printResults(rows: any[]) {
  if (!rows.length) {
    console.log("No results.");
    return;
  }
  for (const [idx, row] of rows.entries()) {
    const score = row.score !== undefined ? ` score=${Number(row.score).toFixed(4)}` : "";
    const text = String(row.text || "").slice(0, 420);
    console.log(`\n## ${idx + 1}. ${row.title}${score}`);
    console.log(`- path: ${row.path}`);
    console.log(`- kind/area: ${row.kind} / ${row.area}`);
    console.log(`- chunk: ${text}${String(row.text || "").length > 420 ? "…" : ""}`);
  }
}

async function semanticRerank(db: Database, query: string, seedRows: any[], limit: number) {
  const qEmb = (await embedTexts([query]))[0];
  let candidates = seedRows;
  if (candidates.length < limit * 3) {
    candidates = db.query(`SELECT c.id, c.text, c.embedding, d.title, d.path, d.kind, d.area FROM chunks c JOIN docs d ON d.id=c.doc_id WHERE c.embedding IS NOT NULL LIMIT 3000`).all() as any[];
  }
  return candidates
    .filter(row => row.embedding)
    .map(row => ({ ...row, score: cosine(qEmb, JSON.parse(row.embedding)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function searchCommand(args: string[]) {
  const config = loadConfig(args);
  const limit = parseLimit(args);
  const semantic = args.includes("--semantic");
  const query = args.slice(1).filter((x, i, a) => !["--semantic", "--config", "--limit"].includes(x) && a[i - 1] !== "--config" && a[i - 1] !== "--limit").join(" ").trim();
  if (!query) return usage();
  const db = openDb(config);
  let rows: any[] = [];
  try {
    rows = db.query(`SELECT c.id, c.text, d.title, d.path, d.kind, d.area, bm25(chunks_fts) AS score
      FROM chunks_fts f JOIN chunks c ON c.id=f.rowid JOIN docs d ON d.id=c.doc_id
      WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?`).all(query.replace(/["']/g, " "), limit) as any[];
  } catch {
    const like = `%${query}%`;
    rows = db.query(`SELECT c.id, c.text, d.title, d.path, d.kind, d.area, 0 AS score
      FROM chunks c JOIN docs d ON d.id=c.doc_id WHERE c.text LIKE ? OR d.title LIKE ? OR d.path LIKE ? LIMIT ?`).all(like, like, like, limit) as any[];
  }
  if (rows.length === 0) {
    const terms = query.split(/\s+/).map(s => s.trim()).filter(Boolean).slice(0, 8);
    const all = db.query(`SELECT c.id, c.text, d.title, d.path, d.kind, d.area, 0 AS score FROM chunks c JOIN docs d ON d.id=c.doc_id LIMIT 5000`).all() as any[];
    rows = all.map(row => {
      const hay = `${row.title} ${row.path} ${row.text}`.toLowerCase();
      let score = 0;
      for (const term of terms) if (hay.includes(term.toLowerCase())) score += Math.max(1, term.length);
      return { ...row, score };
    }).filter(row => row.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  }
  if (semantic) rows = await semanticRerank(db, query, rows, limit);
  printResults(rows);
}

async function similarCommand(args: string[]) {
  const config = loadConfig(args);
  const limit = parseLimit(args);
  let input = args.slice(1).filter((x, i, a) => !["--config", "--limit"].includes(x) && a[i - 1] !== "--config" && a[i - 1] !== "--limit").join(" ").trim();
  if (!input) return usage();
  if (existsSync(input) || existsSync(join(process.cwd(), input))) {
    const path = existsSync(input) ? input : join(process.cwd(), input);
    input = readFileSync(path, "utf8").slice(0, 4000);
  }
  const db = openDb(config);
  const hasEmb: any = db.query("SELECT COUNT(*) AS n FROM chunks WHERE embedding IS NOT NULL").get();
  if (hasEmb.n > 0 && (process.env.SILICONFLOW_API_KEY || process.env.OPENAI_API_KEY)) {
    printResults(await semanticRerank(db, input, [], limit));
  } else {
    await searchCommand(["search", ...input.split(/\s+/).slice(0, 10), "--limit", String(limit), "--config", argValue(args, "--config", DEFAULT_CONFIG_PATH)]);
  }
}

function statsCommand(args: string[]) {
  const config = loadConfig(args);
  const db = openDb(config);
  const docs: any = db.query("SELECT COUNT(*) AS n FROM docs").get();
  const chunks: any = db.query("SELECT COUNT(*) AS n, SUM(embedding IS NOT NULL) AS e FROM chunks").get();
  console.log({ vaultRoot: config.root, db: config.dbPath, docs: docs.n, chunks: chunks.n, embedded_chunks: chunks.e || 0 });
  console.log("By kind:", db.query("SELECT kind, COUNT(*) n FROM docs GROUP BY kind ORDER BY n DESC").all());
  console.log("By area:", db.query("SELECT area, COUNT(*) n FROM docs GROUP BY area ORDER BY n DESC").all());
}

const args = process.argv.slice(2);
const cmd = args[0];
try {
  if (!cmd || cmd === "help" || cmd === "--help") usage();
  else if (cmd === "index") await indexCommand(args);
  else if (cmd === "search") await searchCommand(args);
  else if (cmd === "similar") await similarCommand(args);
  else if (cmd === "stats") statsCommand(args);
  else usage();
} catch (err: any) {
  console.error(`ERROR: ${err.message || err}`);
  process.exit(1);
}
