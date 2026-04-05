# Project Memory — Tasks

## Priority 1: Verify the pipeline end-to-end ✓

- [x] Confirm `UserPromptSubmit` hook fires and writes to `debug/<session>/user-prompt-memories.log`
- [x] Confirm `Stop` hook captures user + assistant text correctly
- [ ] Confirm `PreCompact` hook fires on context compaction
- [x] Check Kuzu DB has real Memory nodes after a few turns (`project-memory explore`)
- [x] Run `project-memory context` and verify memories surface correctly

## Priority 2: Fix known gaps ✓

- [x] `Stop` hook — `ingestTurn` now calls `extractFromTurn` (user + assistant) and promotes to Kuzu
- [x] `context` command — queries Kuzu for tasks/decisions/questions + session summary
- [x] `status` command — shows memory count by kind, session count, last activity

## Priority 3: Embeddings

- [ ] Add vector embeddings to Memory nodes on promote
  - Call `embed()` with composed text: `kind + title + summary + recallCue`
  - Store embedding in Kuzu vector index
- [ ] Wire semantic search into `context` and `search_memories`

## Priority 3b: Artifact detection

- [ ] Add `PostToolUse` hook for `Write` tool — detect artifact-worthy files (new `.md`/`.txt` not in `.project-memory/`)
- [ ] Copy to `.project-memory/artifacts/`, create `Artifact` node in Kuzu linked to session
- [ ] Heuristic: new file creation = artifact candidate, edits to existing files = skip

## Priority 4: MCP server

- [ ] Define MCP tool signatures: `get_context`, `search_memories`, `get_tasks`, `set_active_task`
- [ ] Implement MCP server using `@modelcontextprotocol/sdk`
- [ ] Register MCP server in Claude Code settings

## Priority 5: Polish

- [ ] `project-memory review` command — interactive approve/reject for candidates folder
- [ ] `project-memory memories` command — list all memories in DB by kind
- [ ] Handle `SessionStart` hook — inject context bundle into Claude at session open
- [ ] Add `project-memory init` prompt for LLM config (don't leave it on default)

## Known issues to watch

- Kuzu DB lock conflicts with `project-memory explore` while hook is running
- `config.llm.model === "local-model"` check skips extraction — make sure model is set
- `types.ts` still has `ProjectConfig` — now duplicated with `config.ts` version, clean up
