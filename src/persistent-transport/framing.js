import { PERSISTENT_TRANSPORT_DEFAULTS } from "./constants.js";
import { PERSISTENT_TRANSPORT_ERROR_CODES, persistentTransportError } from "./errors.js";

export function encodeFrame(value, { maxFrameBytes = PERSISTENT_TRANSPORT_DEFAULTS.maxResponseFrameBytes } = {}) {
  let payload;
  try {
    payload = Buffer.from(JSON.stringify(value), "utf8");
  } catch (error) {
    throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.FRAME_INVALID, `Unable to encode transport frame: ${error.message}`);
  }
  if (payload.length > maxFrameBytes) {
    throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.FRAME_TOO_LARGE, `Transport frame exceeds ${maxFrameBytes} bytes`);
  }
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export class FrameDecoder {
  #buffer = Buffer.alloc(0);
  #maxFrameBytes;

  constructor({ maxFrameBytes = PERSISTENT_TRANSPORT_DEFAULTS.maxRequestFrameBytes } = {}) {
    this.#maxFrameBytes = maxFrameBytes;
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    const frames = [];
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32BE(0);
      if (length > this.#maxFrameBytes) {
        throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.FRAME_TOO_LARGE, `Transport frame exceeds ${this.#maxFrameBytes} bytes`, { length });
      }
      if (this.#buffer.length < 4 + length) break;
      frames.push(this.#buffer.subarray(4, 4 + length));
      this.#buffer = this.#buffer.subarray(4 + length);
    }
    return frames;
  }

  end() {
    if (this.#buffer.length !== 0) {
      throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.FRAME_INVALID, "Transport stream ended with a truncated frame");
    }
  }

  get bufferedBytes() {
    return this.#buffer.length;
  }
}

export function parseFrame(frame) {
  try {
    return JSON.parse(frame.toString("utf8"));
  } catch (error) {
    throw persistentTransportError(PERSISTENT_TRANSPORT_ERROR_CODES.FRAME_INVALID, `Transport frame is not valid JSON: ${error.message}`);
  }
}
