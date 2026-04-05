"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assembleContext = assembleContext;
exports.formatContextBundle = formatContextBundle;
const kuzu_helpers_js_1 = require("./kuzu-helpers.js");
const search_js_1 = require("./search.js");
async function assembleContext(projectId, sessionSummary, conn, query) {
    // Get active task
    const activeRows = await (0, kuzu_helpers_js_1.queryAll)(conn, `MATCH (t:Task {projectId: '${(0, kuzu_helpers_js_1.escape)(projectId)}', status: 'active'})
     RETURN t ORDER BY t.createdAt DESC LIMIT 1`);
    const activeTask = activeRows.length > 0 ? activeRows[0]["t"] : null;
    // Get next pending tasks
    const pendingRows = await (0, kuzu_helpers_js_1.queryAll)(conn, `MATCH (t:Task {projectId: '${(0, kuzu_helpers_js_1.escape)(projectId)}', status: 'pending'})
     RETURN t ORDER BY t.taskOrder ASC LIMIT 3`);
    const nextTasks = pendingRows.map((r) => r["t"]);
    // Get key memories — semantic search if query provided, otherwise recency
    let keyMemories;
    if (query) {
        try {
            keyMemories = await (0, search_js_1.searchMemories)(conn, projectId, query, 5);
        }
        catch {
            // Fall back to recency if embedding fails
            keyMemories = await recencyMemories(conn, projectId);
        }
    }
    else {
        keyMemories = await recencyMemories(conn, projectId);
    }
    return {
        activeTask,
        nextTasks,
        keyMemories,
        sessionSummary,
    };
}
async function recencyMemories(conn, projectId) {
    const rows = await (0, kuzu_helpers_js_1.queryAll)(conn, `MATCH (m:Memory {projectId: '${(0, kuzu_helpers_js_1.escape)(projectId)}'})
     WHERE m.kind IN ['decision', 'question', 'fact', 'summary']
     RETURN m ORDER BY m.createdAt DESC LIMIT 5`);
    return rows.map((r) => r["m"]);
}
function formatContextBundle(bundle) {
    const isEmpty = !bundle.activeTask &&
        bundle.nextTasks.length === 0 &&
        bundle.keyMemories.length === 0 &&
        !bundle.sessionSummary;
    if (isEmpty) {
        return [
            "## Project Memory Context",
            "",
            "No memories yet. Memories are extracted automatically at the end of each AI turn.",
            "Run: project-memory config  to set your LLM and embedding models.",
        ].join("\n");
    }
    const lines = ["## Project Memory Context\n"];
    if (bundle.activeTask) {
        lines.push(`### Active Task\n${bundle.activeTask.title}`);
        if (bundle.activeTask.summary)
            lines.push(bundle.activeTask.summary);
        lines.push("");
    }
    if (bundle.nextTasks.length > 0) {
        lines.push("### Next Tasks");
        bundle.nextTasks.forEach((t) => lines.push(`- ${t.title}`));
        lines.push("");
    }
    if (bundle.keyMemories.length > 0) {
        lines.push("### Key Context");
        bundle.keyMemories.forEach((m) => {
            lines.push(`**[${m.kind}]** ${m.title}: ${m.summary}`);
        });
        lines.push("");
    }
    if (bundle.sessionSummary) {
        lines.push("### Session Summary");
        lines.push(bundle.sessionSummary);
    }
    return lines.join("\n");
}
