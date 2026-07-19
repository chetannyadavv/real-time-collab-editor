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

function prependBackward(doc: RgaDocument, word: string) {
  const ops = [];
  for (const ch of word) {
    ops.push(doc.insertAfterId(null, ch));
  }
  return ops;
}

function testBackwardPrepend() {
  const [a, b] = setup();

  const opsA = prependBackward(a, 'bread');
  const opsB = prependBackward(b, 'fruit');

  for (const op of opsB) a.applyRemote(op);
  for (const op of opsA) b.applyRemote(op);

  console.log('a and b converged:', a.toString() === b.toString());
  console.log('result:', JSON.stringify(a.toString()));
  const readable = a.toString() === 'breadfruitlist' || a.toString() === 'fruitbreadlist';
  console.log('readable (clean word boundaries)?', readable);
}

testBackwardPrepend();
