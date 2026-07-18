import { DatabaseSync } from 'node:sqlite';
import type { RgaNode, RgaOp } from '../../shared/src/index.js';

const db = new DatabaseSync('collab-editor.db');
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS ops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT NOT NULL,
    op_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_ops_doc_id ON ops(doc_id);

  CREATE TABLE IF NOT EXISTS snapshots (
    doc_id TEXT PRIMARY KEY,
    nodes_json TEXT NOT NULL,
    last_op_id INTEGER NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const insertOpStmt = db.prepare(
  'INSERT INTO ops (doc_id, op_json) VALUES (?, ?)'
);
const getOpsAfterStmt = db.prepare(
  'SELECT id, op_json FROM ops WHERE doc_id = ? AND id > ? ORDER BY id ASC'
);
const getAllOpsStmt = db.prepare(
  'SELECT id, op_json FROM ops WHERE doc_id = ? ORDER BY id ASC'
);
const getSnapshotStmt = db.prepare(
  'SELECT nodes_json, last_op_id FROM snapshots WHERE doc_id = ?'
);
const upsertSnapshotStmt = db.prepare(`
  INSERT INTO snapshots (doc_id, nodes_json, last_op_id, updated_at)
  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(doc_id) DO UPDATE SET
    nodes_json = excluded.nodes_json,
    last_op_id = excluded.last_op_id,
    updated_at = CURRENT_TIMESTAMP
`);

export function logOp(docId: string, op: RgaOp): number {
  const result = insertOpStmt.run(docId, JSON.stringify(op));
  return Number(result.lastInsertRowid);
}

export function loadDocument(docId: string): { nodes: RgaNode[]; ops: RgaOp[]; lastOpId: number } {
  const snapshot = getSnapshotStmt.get(docId) as { nodes_json: string; last_op_id: number } | undefined;

  if (snapshot) {
    const rows = getOpsAfterStmt.all(docId, snapshot.last_op_id) as { id: number; op_json: string }[];
    return {
      nodes: JSON.parse(snapshot.nodes_json),
      ops: rows.map((r) => JSON.parse(r.op_json)),
      lastOpId: rows.length > 0 ? rows[rows.length - 1].id : snapshot.last_op_id,
    };
  }

  const rows = getAllOpsStmt.all(docId) as { id: number; op_json: string }[];
  return {
    nodes: [],
    ops: rows.map((r) => JSON.parse(r.op_json)),
    lastOpId: rows.length > 0 ? rows[rows.length - 1].id : 0,
  };
}

export function saveSnapshot(docId: string, nodes: RgaNode[], lastOpId: number) {
  upsertSnapshotStmt.run(docId, JSON.stringify(nodes), lastOpId);
}
