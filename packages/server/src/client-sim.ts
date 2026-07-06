import WebSocket from 'ws';
import { RgaDocument, RgaOp, OpId } from '../../shared/src/index.js';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class SimulatedClient {
  doc: RgaDocument;
  socket: WebSocket;
  private ready: Promise<void>;
  private cursorAfterId: OpId | null = null;

  constructor(replicaId: string, docId: string) {
    this.doc = new RgaDocument(replicaId);
    this.socket = new WebSocket(`ws://localhost:8080/${docId}`);
    this.ready = new Promise((resolve) => {
      this.socket.on('open', () => resolve());
    });
    this.socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'init') {
        this.doc.loadSnapshot(msg.nodes);
        this.cursorAfterId = this.doc.getLastVisibleId();
        return;
      }
      this.doc.applyRemote(msg as RgaOp);
    });
  }

  async waitUntilOpen() {
    await this.ready;
  }

  async type(word: string) {
    for (const ch of word) {
      const op = this.doc.insertAfterId(this.cursorAfterId, ch);
      this.cursorAfterId = op.id;
      this.socket.send(JSON.stringify(op));
      await sleep(15);
    }
  }
}

async function main() {
  const docId = `demo-${Date.now()}`;
  const alice = new SimulatedClient('alice', docId);
  const bob = new SimulatedClient('bob', docId);

  await Promise.all([alice.waitUntilOpen(), bob.waitUntilOpen()]);
  console.log('[demo] alice + bob connected, typing concurrently...');
  await Promise.all([alice.type('hello '), bob.type('world ')]);
  await sleep(200);

  console.log('[demo] alice + bob converged to:', JSON.stringify(alice.doc.toString()));
  console.log('[demo] -- now charlie joins an ALREADY-POPULATED document --');

  const charlie = new SimulatedClient('charlie', docId);
  await charlie.waitUntilOpen();
  await sleep(100);

  console.log('[demo] charlie sees on join:', JSON.stringify(charlie.doc.toString()));

  await charlie.type('charlie was here');
  await sleep(200);

  console.log('[demo] alice sees:  ', JSON.stringify(alice.doc.toString()));
  console.log('[demo] bob sees:    ', JSON.stringify(bob.doc.toString()));
  console.log('[demo] charlie sees:', JSON.stringify(charlie.doc.toString()));

  const allEqual =
    alice.doc.toString() === bob.doc.toString() && bob.doc.toString() === charlie.doc.toString();
  console.log('[demo] converged:', allEqual ? 'YES' : 'NO -- BUG');
  console.log(
    "[demo] charlie's text landed at the end:",
    alice.doc.toString().endsWith('charlie was here') ? 'YES' : 'NO -- landed somewhere unexpected'
  );

  alice.socket.close();
  bob.socket.close();
  charlie.socket.close();
  process.exit(0);
}

main();
