export class SecureBuffer implements Disposable {
  private buffer: Uint8Array;
  private _isZeroed: boolean = false;

  private constructor(sizeOrData: number | Uint8Array) {
    if (typeof sizeOrData === 'number') {
      this.buffer = new Uint8Array(sizeOrData);
    } else {
      this.buffer = new Uint8Array(sizeOrData.length);
      this.buffer.set(sizeOrData);
    }
  }

  static alloc(size: number): SecureBuffer {
    return new SecureBuffer(size);
  }

  static from(data: Uint8Array): SecureBuffer {
    const buf = new SecureBuffer(data);
    // Zero out the source data if possible to ensure it doesn't linger
    data.fill(0);
    return buf;
  }

  expose(): Uint8Array {
    if (this._isZeroed) throw new Error('Attempting to use zeroed memory');
    return this.buffer;
  }

  zero(): void {
    if (!this._isZeroed) {
      this.buffer.fill(0);
      this._isZeroed = true;
    }
  }

  get isZeroed(): boolean {
    return this._isZeroed;
  }

  [Symbol.dispose](): void {
    this.zero();
  }
}
