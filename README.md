# pensive

**pensive** gives your AI coding assistant memory that persists across sessions.

It hooks into Claude Code's lifecycle to automatically extract decisions, tasks, facts, and open questions from each turn — storing them as typed nodes in a local graph database scoped to your repo. Every new session opens with a context bundle already injected: your active task, queued work, and a summary of the last session. No re-explaining. No lost decisions. Your assistant picks up where you left off.

---

## How it works

pensive hooks directly into Claude Code's lifecycle events. It runs silently in the background, extracting and storing memory nodes into a local [Kuzu](https://kuzudb.com/) graph database inside your repo.

```
Session starts  →  context bundle injected into Claude's system prompt
User sends message  →  LLM extracts tasks/decisions/facts on the fly
Session ends  →  full turn summarized, memories promoted to graph
Context compacts  →  candidates reviewed and consolidated before they vanish
```

Every session builds on the last. Claude walks in already knowing your active task, recent decisions, and open questions — without you saying a word.

---

## Features

- **Automatic memory extraction** — LLM reads each turn and pulls out decisions, tasks, facts, and open questions
- **Graph-backed storage** — Kuzu stores memories with relationships to projects, sessions, and artifacts
- **Semantic search** — cosine similarity over embeddings lets you query memories by meaning, not keyword
- **Session continuity** — each new session opens with a context bundle: active task, queue, and last session summary
- **Task management** — a built-in task queue with `pending → active → done` lifecycle, surfaced every session
- **Context compaction** — PreCompact hook reviews candidate memories before Claude's context window resets
- **Zero config after init** — hooks wire themselves into `.claude/settings.json` automatically

---

## Installation

```bash
npm install -g pensive
```

Then initialize in any git repo:

```bash
cd your-project
pensive init
```

This creates `.pensive/` (added to `.gitignore`) and writes Claude Code hook entries into `.claude/settings.json`.

Configure your LLM and embedding providers:

```bash
pensive config
```

---

## Usage

Once initialized, everything runs automatically through Claude Code hooks. The CLI lets you inspect and manage what's been captured.

### Task management

```bash
pensive tasks                  # view task queue (gantt view)
pensive tasks add "title"      # add a task
pensive tasks start <n>        # set task active by queue position
pensive tasks done             # complete the active task
pensive tasks block "reason"   # mark active task blocked
pensive tasks remove <n>       # delete by position or id
pensive tasks move <from> <to> # reorder the queue
```

### Memory inspection

```bash
pensive context                # show current context bundle
pensive status                 # memory stats (counts by kind, sessions, last activity)
pensive search "query"         # semantic search across all memories
pensive search "query" -k 10   # return top 10 results
```

### Maintenance

```bash
pensive backfill-embeddings    # generate embeddings for any memory nodes missing them
```

---

## Context bundle

At the start of every Claude Code session, pensive injects a bundle into Claude's system prompt:

```
## Tasks
ACTIVE: Wire up semantic search to context assembly
Queue:
  1. Add PostToolUse hook for artifact detection
  2. Write README

## Last Session
Refactored memory extraction to use candidate staging
```

Claude sees your task queue and last session summary before you type a single word.

---

## Memory kinds

| Kind | What it captures |
|------|-----------------|
| `decision` | architectural choices, approach selections |
| `task` | next steps, TODOs, follow-ups |
| `fact` | project-specific truths, constraints, config details |
| `question` | open questions, unresolved blockers |
| `reference` | pointers to external systems, docs, dashboards |
| `summary` | session-level summaries |

---

## Graph schema

```
Project
  └─HAS_SESSION→ Session
       └─HAS_MEMORY→ Memory
       └─HAS_ARTIFACT→ Artifact
Task (linked to Project)
```

Memories carry vector embeddings for semantic search. Relationships let you trace any memory back to the session that produced it and see what else was captured alongside it.

---

## Requirements

- Node.js 18+
- Claude Code CLI
- An LLM API key (Anthropic, OpenAI, or compatible) for extraction and embeddings

---

## Why not just use Claude's memory feature?

Claude's built-in memory is global and unstructured. pensive is:

- **Per-repo** — memories are scoped to your project, not your account
- **Structured** — typed nodes with relationships you can query
- **Searchable** — semantic search over embeddings, not keyword matching
- **Task-aware** — first-class task queue surfaced every session
- **Private** — stored locally in your repo, never leaves your machine

---

## License

ISC
