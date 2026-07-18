import { WebSocketServer, WebSocket } from 'ws';
import { RgaDocument } from '../../shared/src/index.js';
import type { RgaOp } from '../../shared/src/index.js';
import { logOp, loadDocument, saveSnapshot } from './db.js';

const SNAPSHOT_INTERVAL = 20;

interface PresenceInfo {
  userId: string;
  name: string;
  color: string;
  cursorPos: number;
}

interface Room {
  doc: RgaDocument;
  clients: Set<WebSocket>;
  lastOpId: number;
  opsSinceSnapshot: number;
  presence: Map<WebSocket, PresenceInfo>;
}

const rooms = new Map<string, Room>();

function getRoom(docId: string): Room {
  let room = rooms.get(docId);
  if (room) return room;

  const { nodes, ops, lastOpId } = loadDocument(docId);
  const doc = new RgaDocument(`server-${docId}`);
  doc.loadSnapshot(nodes);
  for (const op of ops) {
    doc.applyRemote(op);
  }
  console.log(
    `[server] hydrated room "${docId}" from disk (${nodes.length} snapshot nodes + ${ops.length} replayed ops)`
  );

  room = { doc, clients: new Set(), lastOpId, opsSinceSnapshot: 0, presence: new Map() };
  rooms.set(docId, room);
  return room;
}

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

const HEARTBEAT_INTERVAL_MS = 15000;

interface HeartbeatState {
  isAlive: boolean;
}
const heartbeats = new WeakMap<WebSocket, HeartbeatState>();

const heartbeatTimer = setInterval(() => {
  for (const client of wss.clients) {
    const state = heartbeats.get(client);
    if (!state || state.isAlive === false) {
      client.terminate();
      continue;
    }
    state.isAlive = false;
    client.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => clearInterval(heartbeatTimer));

wss.on('connection', (socket, req) => {
  heartbeats.set(socket, { isAlive: true });
  socket.on('pong', () => {
    const state = heartbeats.get(socket);
    if (state) state.isAlive = true;
  });

  const docId = (req.url ?? '/default').slice(1) || 'default';
  const room = getRoom(docId);
  room.clients.add(socket);
  console.log(`[server] client joined room "${docId}" (${room.clients.size} connected)`);

  socket.send(JSON.stringify({ type: 'init', nodes: room.doc.getSnapshotNodes() }));

  socket.send(JSON.stringify({ type: 'presence-init', users: Array.from(room.presence.values()) }));

  socket.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === 'presence') {
      const info: PresenceInfo = {
        userId: msg.userId,
        name: msg.name,
        color: msg.color,
        cursorPos: msg.cursorPos,
      };
      room.presence.set(socket, info);
      console.log(`[server] presence update: ${info.name} (${info.userId}) @ pos ${info.cursorPos}`);

      for (const other of room.clients) {
        if (other !== socket && other.readyState === WebSocket.OPEN) {
          other.send(JSON.stringify(msg));
        }
      }
      return;
    }

    const op: RgaOp = msg;

    room.doc.applyRemote(op);

    room.lastOpId = logOp(docId, op);
    room.opsSinceSnapshot++;

    if (room.opsSinceSnapshot >= SNAPSHOT_INTERVAL) {
      saveSnapshot(docId, room.doc.getSnapshotNodes(), room.lastOpId);
      room.opsSinceSnapshot = 0;
      console.log(`[server] snapshotted room "${docId}" at op ${room.lastOpId}`);
    }

    for (const other of room.clients) {
      if (other !== socket && other.readyState === WebSocket.OPEN) {
        other.send(JSON.stringify(op));
      }
    }
  });

  socket.on('close', () => {
    room.clients.delete(socket);
    const info = room.presence.get(socket);
    room.presence.delete(socket);
    console.log(`[server] client left room "${docId}" (${room.clients.size} remaining)`);

    if (info) {
      for (const other of room.clients) {
        if (other.readyState === WebSocket.OPEN) {
          other.send(JSON.stringify({ type: 'presence-leave', userId: info.userId }));
        }
      }
    }
  });
});

console.log(`[server] listening on ws://localhost:${PORT}`);
