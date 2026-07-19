import { RgaDocument } from './rga.js';

function setup(): [RgaDocument, RgaDocument] {
  const a = new RgaDocument('A');
  const b = new RgaDocument('B');
  for (const ch of 'list') {
    const op = a.localInsert(a.toString().length - 1, ch);
    b.applyRemote(op);
  }
  return [a, b];
}

function prependProperly(doc: RgaDocument, word: string, beforeCharId: any) {
  const ops = [];
  const first = doc.insertBeforeId(beforeCharId, word[0]);
  ops.push(first);
  let prevId = first.id;
  for (const ch of word.slice(1)) {
    const op = doc.insertAfterId(prevId, ch);
    ops.push(op);
    prevId = op.id;
  }
  return ops;
}

function testFuguePrepend() {
  const [a, b] = setup();

  const frontIdA = a.getSnapshotNodes().find((n) => n.char === 'l')!.id;
  const frontIdB = b.getSnapshotNodes().find((n) => n.char === 'l')!.id;

  const opsA = prependProperly(a, 'bread', frontIdA);
  const opsB = prependProperly(b, 'fruit', frontIdB);

  for (const op of opsB) a.applyRemote(op);
  for (const op of opsA) b.applyRemote(op);

  console.log('a converged?', a.toString() === b.toString());
  console.log('a result:', JSON.stringify(a.toString()));
  console.log('b result:', JSON.stringify(b.toString()));

  const [c] = setup();
  const interleaved: typeof opsA = [];
  const maxLen = Math.max(opsA.length, opsB.length);
  for (let i = 0; i < maxLen; i++) {
    if (opsB[i]) interleaved.push(opsB[i]);
    if (opsA[i]) interleaved.push(opsA[i]);
  }
  for (const op of interleaved) c.applyRemote(op);
  console.log('c (interleaved order) result:', JSON.stringify(c.toString()));
  console.log('c matches a/b?', c.toString() === a.toString());
}

testFuguePrepend();
