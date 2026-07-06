import { WebSocketServer, WebSocket } from 'ws';
import { RgaDocument, RgaOp } from '../../shared/src/index.js';

interface Room {
  doc: RgaDocument;
  clients: Set<WebSocket>;
}

const rooms = new Map<string, Room>();

function getRoom(docId: string): Room {
  let room = rooms.get(docId);
  if (!room) {
    room = { doc: new RgaDocument(`server-${docId}`), clients: new Set() };
    rooms.set(docId, room);
  }
  return room;
}

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (socket, req) => {
  const docId = (req.url ?? '/default').slice(1) || 'default';
  const room = getRoom(docId);
  room.clients.add(socket);
  console.log(`[server] client joined room "${docId}" (${room.clients.size} connected)`);

  socket.send(JSON.stringify({ type: 'init', nodes: room.doc.getSnapshotNodes() }));

  socket.on('message', (raw) => {
    const op: RgaOp = JSON.parse(raw.toString());

    room.doc.applyRemote(op);

    for (const other of room.clients) {
      if (other !== socket && other.readyState === WebSocket.OPEN) {
        other.send(JSON.stringify(op));
      }
    }
  });

  socket.on('close', () => {
    room.clients.delete(socket);
    console.log(`[server] client left room "${docId}" (${room.clients.size} remaining)`);
  });
});

console.log(`[server] listening on ws://localhost:${PORT}`);
