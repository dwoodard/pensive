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
exports.promoteToDb = promoteToDb;
exports.getExistingMemories = getExistingMemories;
const crypto = __importStar(require("crypto"));
const kuzu_helpers_js_1 = require("./kuzu-helpers.js");
async function promoteToDb(candidates, projectId, conn) {
    const promoted = [];
    for (const c of candidates) {
        // Dedupe by title
        const existing = await (0, kuzu_helpers_js_1.queryAll)(conn, `MATCH (m:Memory {projectId: '${(0, kuzu_helpers_js_1.escape)(projectId)}'})
       WHERE m.title = '${(0, kuzu_helpers_js_1.escape)(c.title)}'
       RETURN m.id`);
        if (existing.length > 0)
            continue;
        const memory = {
            id: `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
            kind: c.kind,
            title: c.title,
            summary: c.summary,
            recallCue: c.recallCue,
            projectId,
            sessionId: c.sessionId,
            createdAt: new Date().toISOString(),
            status: c.status,
        };
        await conn.query(`CREATE (m:Memory {
        id: '${(0, kuzu_helpers_js_1.escape)(memory.id)}',
        kind: '${(0, kuzu_helpers_js_1.escape)(memory.kind)}',
        title: '${(0, kuzu_helpers_js_1.escape)(memory.title)}',
        summary: '${(0, kuzu_helpers_js_1.escape)(memory.summary)}',
        recallCue: '${(0, kuzu_helpers_js_1.escape)(memory.recallCue)}',
        projectId: '${(0, kuzu_helpers_js_1.escape)(memory.projectId)}',
        sessionId: '${(0, kuzu_helpers_js_1.escape)(memory.sessionId)}',
        createdAt: '${(0, kuzu_helpers_js_1.escape)(memory.createdAt)}',
        status: '${(0, kuzu_helpers_js_1.escape)(memory.status ?? "")}',
        artifactId: ''
      })`);
        // Link to session if it exists
        const sessionRows = await (0, kuzu_helpers_js_1.queryAll)(conn, `MATCH (s:Session {id: '${(0, kuzu_helpers_js_1.escape)(c.sessionId)}'}) RETURN s`);
        if (sessionRows.length > 0) {
            await conn.query(`MATCH (s:Session {id: '${(0, kuzu_helpers_js_1.escape)(c.sessionId)}'}), (m:Memory {id: '${(0, kuzu_helpers_js_1.escape)(memory.id)}'})
         CREATE (s)-[:HAS_MEMORY]->(m)`);
        }
        promoted.push(memory);
    }
    return promoted;
}
async function getExistingMemories(projectId, conn) {
    const rows = await (0, kuzu_helpers_js_1.queryAll)(conn, `MATCH (m:Memory {projectId: '${(0, kuzu_helpers_js_1.escape)(projectId)}'})
     RETURN m ORDER BY m.createdAt DESC LIMIT 50`);
    return rows.map((r) => r["m"]);
}
