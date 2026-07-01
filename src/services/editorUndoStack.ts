const MAX_HISTORY = 100;

export interface UndoStackSnapshot<T> {
  history: T[];
  pointer: number;
  basePointer: number;
}

export class UndoStack<T> {
  private history: T[];
  private pointer: number;
  private basePointer: number;

  constructor(initial: T) {
    this.history = [initial];
    this.pointer = 0;
    this.basePointer = 0;
  }

  current(): T {
    return this.history[this.pointer] as T;
  }

  push(state: T): void {
    this.history = this.history.slice(0, this.pointer + 1);
    this.history.push(state);

    if (this.history.length > MAX_HISTORY + 1) {
      const dropped = this.history.length - (MAX_HISTORY + 1);
      this.history = this.history.slice(dropped);
      this.basePointer = Math.max(0, this.basePointer - dropped);
    }

    this.pointer = this.history.length - 1;
  }

  canUndo(): boolean {
    return this.pointer > 0;
  }

  canRedo(): boolean {
    return this.pointer < this.history.length - 1;
  }

  undo(): void {
    if (this.canUndo()) this.pointer--;
  }

  redo(): void {
    if (this.canRedo()) this.pointer++;
  }

  isDirty(): boolean {
    return this.pointer !== this.basePointer;
  }

  save(): void {
    this.history = [this.history[this.pointer] as T];
    this.pointer = 0;
    this.basePointer = 0;
  }

  snapshot(): UndoStackSnapshot<T> {
    return {
      history: this.history.slice(),
      pointer: this.pointer,
      basePointer: this.basePointer,
    };
  }

  static fromSnapshot<T>(snapshot: UndoStackSnapshot<T>): UndoStack<T> {
    const stack = new UndoStack<T>(snapshot.history[0] as T);
    stack.history = snapshot.history.slice();
    stack.pointer = snapshot.pointer;
    stack.basePointer = snapshot.basePointer;
    return stack;
  }
}
