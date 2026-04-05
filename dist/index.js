"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestTurn = ingestTurn;
const path = __importStar(require("path"));
const detect_project_js_1 = require("./detect-project.js");
const db_js_1 = require("./db.js");
const kuzu_helpers_js_1 = require("./kuzu-helpers.js");
const append_turn_js_1 = require("./append-turn.js");
const update_summary_js_1 = require("./update-summary.js");
const extract_memory_js_1 = require("./extract-memory.js");
const promote_memory_js_1 = require("./promote-memory.js");
const config_js_1 = require("./config.js");
async function ingestTurn(turn) {
    const detected = (0, detect_project_js_1.detectProject)(turn.cwd);
    if (!detected) {
        console.error("No git repo found at:", turn.cwd);
        return;
    }
    const { repoRoot } = detected;
    const projectMemoryDir = path.join(repoRoot, ".project-memory");
    let config;
    try {
        config = (0, config_js_1.readProjectConfig)(projectMemoryDir);
    }
    catch {
        console.error("Project not initialized. Run: project-memory init");
        return;
    }
    const { conn } = (0, db_js_1.getDb)(projectMemoryDir);
    // 1. Resolve session
    const sessionId = (0, append_turn_js_1.resolveSession)(turn, projectMemoryDir, config);
    const userText = turn.messages.find((m) => m.role === "user")?.content ?? "";
    // Ensure session exists in DB
    const sessionRows = await (0, kuzu_helpers_js_1.queryAll)(conn, `MATCH (s:Session {id: '${sessionId}'}) RETURN s`);
    const isNewSession = sessionRows.length === 0;
    // Derive title from first user message (strip tags, truncate)
    function deriveTitle(text) {
        const clean = text
            .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, "")
            .replace(/\s+/g, " ")
            .trim();
        return clean.length > 80 ? clean.slice(0, 79) + "…" : clean;
    }
    if (isNewSession) {
        const title = deriveTitle(userText);
        await conn.query(`CREATE (s:Session {
        id: '${(0, kuzu_helpers_js_1.escape)(sessionId)}',
        projectId: '${(0, kuzu_helpers_js_1.escape)(config.projectId)}',
        startedAt: '${new Date().toISOString()}',
        title: '${(0, kuzu_helpers_js_1.escape)(title)}',
        summary: ''
      })`);
        await conn.query(`MATCH (p:Project {id: '${(0, kuzu_helpers_js_1.escape)(config.projectId)}'}), (s:Session {id: '${(0, kuzu_helpers_js_1.escape)(sessionId)}'})
       CREATE (p)-[:HAS_SESSION]->(s)`);
    }
    // 2. Append turn to session log
    (0, append_turn_js_1.appendTurn)(turn, projectMemoryDir, sessionId);
    // 3. Update rolling session summary — write to file and sync to Kuzu
    const existingSummary = (0, update_summary_js_1.readSummary)(projectMemoryDir, sessionId);
    const updatedSummary = (0, update_summary_js_1.buildUpdatedSummary)(existingSummary, turn);
    (0, update_summary_js_1.writeSummary)(projectMemoryDir, sessionId, updatedSummary);
    await conn.query(`MATCH (s:Session {id: '${(0, kuzu_helpers_js_1.escape)(sessionId)}'})
     SET s.summary = '${(0, kuzu_helpers_js_1.escape)(updatedSummary)}'`);
    // 4. Extract memories from the full turn (skip if LLM not configured)
    if (!config.llm?.model || config.llm.model === "local-model")
        return;
    const assistantText = turn.messages.find((m) => m.role === "assistant")?.content ?? "";
    if (!userText)
        return;
    try {
        const turnId = `turn_${sessionId.slice(0, 8)}_${Date.now()}`;
        const candidates = await (0, extract_memory_js_1.extractFromTurn)(userText, assistantText, sessionId, turnId);
        if (candidates.length === 0)
            return;
        (0, extract_memory_js_1.writeCandidateFile)(projectMemoryDir, candidates);
        await (0, promote_memory_js_1.promoteToDb)(candidates, config.projectId, conn);
    }
    catch {
        // Never block on extraction errors
    }
}
