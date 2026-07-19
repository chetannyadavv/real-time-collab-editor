import type { OpId } from './id.js';
import { idsEqual, compareId } from './id.js';

type Side = 'L' | 'R';

export interface RgaNode {
  id: OpId;
  char: string;
  originId: OpId | null;
  side?: Side;
  deleted: boolean;
}

export interface InsertOp {
  type: 'insert';
  id: OpId;
  char: string;
  originId: OpId | null;
  side?: Side;
}

export interface DeleteOp {
  type: 'delete';
  id: OpId;
}

export type RgaOp = InsertOp | DeleteOp;

export class RgaDocument {
  private nodes: RgaNode[] = [];
  private counter = 0;
  private replicaId: string;

  constructor(replicaId: string) {
    this.replicaId = replicaId;
  }

  private nextId(): OpId {
    this.counter += 1;
    return { counter: this.counter, replicaId: this.replicaId };
  }

  toString(): string {
    return this.nodes.filter((n) => !n.deleted).map((n) => n.char).join('');
  }

  private indexOfId(id: OpId | null): number {
    if (id === null) return -1;
    return this.nodes.findIndex((n) => idsEqual(n.id, id));
  }

  private visibleIndexToId(visibleIndex: number): OpId | null {
    if (visibleIndex < 0) return null;
    let seen = -1;
    for (const n of this.nodes) {
      if (!n.deleted) {
        seen++;
        if (seen === visibleIndex) return n.id;
      }
    }
    return null;
  }

  localInsert(afterVisibleIndex: number, char: string): InsertOp {
    const originId = this.visibleIndexToId(afterVisibleIndex);
    return this.insertAfterId(originId, char);
  }

  insertAfterId(originId: OpId | null, char: string): InsertOp {
    const id = this.nextId();
    const op: InsertOp = { type: 'insert', id, char, originId, side: 'R' };
    this.integrateInsert(op);
    return op;
  }

  insertBeforeId(originId: OpId, char: string): InsertOp {
    const id = this.nextId();
    const op: InsertOp = { type: 'insert', id, char, originId, side: 'L' };
    this.integrateInsert(op);
    return op;
  }

  localDelete(visibleIndex: number): DeleteOp {
    const id = this.visibleIndexToId(visibleIndex);
    if (id === null) throw new Error('nothing to delete at that index');
    const op: DeleteOp = { type: 'delete', id };
    this.applyDelete(op);
    return op;
  }

  applyRemote(op: RgaOp) {
    if (op.type === 'insert') this.integrateInsert(op);
    else this.applyDelete(op);
  }

  getSnapshotNodes(): RgaNode[] {
    return this.nodes.map((n) => ({ ...n }));
  }

  loadSnapshot(nodes: RgaNode[]) {
    this.nodes = nodes.map((n) => ({ ...n }));
  }

  getLastVisibleId(): OpId | null {
    const visible = this.nodes.filter((n) => !n.deleted);
    return visible.length > 0 ? visible[visible.length - 1].id : null;
  }

  private applyDelete(op: DeleteOp) {
    const idx = this.indexOfId(op.id);
    if (idx === -1) return;
    this.nodes[idx].deleted = true;
  }

  private isDescendantOf(nodeId: OpId, ancestorId: OpId): boolean {
    const idx = this.indexOfId(nodeId);
    if (idx === -1) return false;
    let current = this.nodes[idx].originId;
    while (current !== null) {
      if (idsEqual(current, ancestorId)) return true;
      const pIdx = this.indexOfId(current);
      if (pIdx === -1) return false;
      current = this.nodes[pIdx].originId;
    }
    return false;
  }

  private integrateInsert(op: InsertOp) {
    const side: Side = op.side ?? 'R';
    const node: RgaNode = { id: op.id, char: op.char, originId: op.originId, side, deleted: false };

    if (op.originId === null) {
      let i = 0;
      while (i < this.nodes.length) {
        const other = this.nodes[i];
        if (other.originId === null) {
          if (compareId(other.id, op.id) > 0) {
            i++;
            continue;
          }
          break;
        }
        i++;
      }
      this.nodes.splice(i, 0, node);
      return;
    }

    const originIndex = this.indexOfId(op.originId);

    if (side === 'R') {
      let i = originIndex + 1;
      while (i < this.nodes.length) {
        const other = this.nodes[i];
        const isDirectSibling = idsEqual(other.originId, op.originId) && (other.side ?? 'R') === 'R';
        if (isDirectSibling) {
          if (compareId(other.id, op.id) > 0) {
            i++;
            continue;
          }
          break;
        }
        if (this.isDescendantOf(other.id, op.originId)) {
          i++;
          continue;
        }
        break;
      }
      this.nodes.splice(i, 0, node);
      return;
    }

    let i = originIndex;
    let scan = originIndex;
    while (scan > 0) {
      const candidateIdx = scan - 1;
      const candidate = this.nodes[candidateIdx];
      const isDirectSibling = idsEqual(candidate.originId, op.originId) && candidate.side === 'L';

      if (isDirectSibling) {
        if (compareId(candidate.id, op.id) > 0) {
          i = candidateIdx;
          scan = candidateIdx;
          continue;
        }
        break;
      }

      if (this.isDescendantOf(candidate.id, op.originId)) {
        scan = candidateIdx;
        continue;
      }

      break;
    }
    this.nodes.splice(i, 0, node);
  }
}
