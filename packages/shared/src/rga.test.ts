import assert from 'node:assert';
import { RgaDocument } from './rga.js';

// --- Test 1: the exact "cat" / concurrent insert scenario from the theory ---
function testBasicConvergence() {
  const a = new RgaDocument('A');
  const b = new RgaDocument('B');

  // Both start from "cat"
  for (const ch of 'cat') {
    const op = a.localInsert(a.toString().length - 1, ch);
    b.applyRemote(op);
  }
  assert.strictEqual(a.toString(), 'cat');
  assert.strictEqual(b.toString(), 'cat');

  // Concurrently: A inserts 'h' at the start, B inserts 's' at the end
  const opA = a.localInsert(-1, 'h');
  const opB = b.localInsert(2, 's');

  // Apply in OPPOSITE orders on each replica -- this is the whole point
  a.applyRemote(opB);
  b.applyRemote(opA);

  assert.strictEqual(a.toString(), b.toString(), 'replicas diverged!');
  console.log('test 1 (basic convergence) OK ->', a.toString());
}

// --- Test 2: delete/insert race ---
function testDeleteConvergence() {
  const a = new RgaDocument('A');
  const b = new RgaDocument('B');

  for (const ch of 'abc') {
    const op = a.localInsert(a.toString().length - 1, ch);
    b.applyRemote(op);
  }

  // A deletes 'b' (index 1) while B concurrently inserts 'X' after 'b'
  const delOp = a.localDelete(1);
  const insOp = b.localInsert(1, 'X');

  a.applyRemote(insOp);
  b.applyRemote(delOp);

  assert.strictEqual(a.toString(), b.toString(), 'replicas diverged on delete race!');
  console.log('test 2 (delete/insert race) OK ->', a.toString());
}

// --- Test 3: demonstrate the interleaving anomaly this simple RGA has ---
function demoInterleaving() {
  const a = new RgaDocument('A');
  const b = new RgaDocument('B');

  // Both concurrently type a whole word at the SAME anchor (start of empty doc)
  const opsA = [...'cat'].map((ch, idx) => {
    const op = a.localInsert(idx - 1, ch); // each char after the previous one A typed
    return op;
  });
  const opsB = [...'dog'].map((ch, idx) => {
    const op = b.localInsert(idx - 1, ch);
    return op;
  });

  // Now exchange: each replica applies the other's ops
  for (const op of opsB) a.applyRemote(op);
  for (const op of opsA) b.applyRemote(op);

  assert.strictEqual(a.toString(), b.toString(), 'replicas diverged!');
  console.log('test 3 -> converged to:', JSON.stringify(a.toString()));
  console.log('  (clean result here -- each run chains onto its own prior char, so only');
  console.log('   the very first chars of each run actually compete. The real interleaving');
  console.log('   anomaly needs a narrower condition -- we\'ll construct it precisely at the Fugue step.)');
}

testBasicConvergence();
testDeleteConvergence();
demoInterleaving();
