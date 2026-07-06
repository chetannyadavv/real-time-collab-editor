import type { OpId } from './id.js';
import { idsEqual, compareId } from './id.js';

export interface RgaNode {
  id: OpId;
  char: string;
  originId: OpId | null;
  deleted: boolean;
}

export interface InsertOp {
  type: 'insert';
  id: OpId;
  char: string;
  originId: OpId | null;
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
    const op: InsertOp = { type: 'insert', id, char, originId };
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

  private integrateInsert(op: InsertOp) {
    const node: RgaNode = { id: op.id, char: op.char, originId: op.originId, deleted: false };
    const originIndex = this.indexOfId(op.originId);
    let i = originIndex + 1;

    while (i < this.nodes.length) {
      const other = this.nodes[i];
      const otherOriginIndex = this.indexOfId(other.originId);

      if (otherOriginIndex < originIndex) {
        break;
      }

      if (otherOriginIndex === originIndex) {
        if (compareId(other.id, op.id) > 0) {
          i++;
          continue;
        } else {
          break;
        }
      }

      i++;
    }
    this.nodes.splice(i, 0, node);
  }
}
