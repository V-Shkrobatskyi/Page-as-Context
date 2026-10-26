// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { endianness } from 'node:os';
import { TextDecoder } from 'node:util';

export const MAX_FRAME = 256 * 1024;
export const MAX_RESULT = 4 * 1024 * 1024;
const little = endianness() === 'LE';
const decode = new TextDecoder('utf-8', { fatal: true });

/** Native Messaging and internal IPC use bounded, native-endian length framing. */
export function encode(value, limit = MAX_FRAME) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  if (!payload.length || payload.length > limit) throw new Error('frame-limit');
  const header = Buffer.alloc(4);
  little ? header.writeUInt32LE(payload.length) : header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

export function readFrames(stream, receive, fail, { limit = MAX_FRAME, timeout = 10_000 } = {}) {
  let buffer = Buffer.alloc(0), expected, timer, stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer); buffer = Buffer.alloc(0);
    stream.off('data', data); stream.off('end', end); stream.off('error', error);
  };
  const error = () => { if (stopped) return; stop(); fail(new Error('invalid-frame')); };
  const end = () => { if (buffer.length || expected !== undefined) error(); else stop(); };
  function data(chunk) {
    if (stopped) return;
    try {
      // A stream chunk may contain several valid frames. Never buffer an unbounded body.
      let offset = 0;
      while (offset < chunk.length) {
        const needed = expected === undefined ? 4 - buffer.length : expected - buffer.length;
        const count = Math.min(needed, chunk.length - offset);
        buffer = Buffer.concat([buffer, chunk.subarray(offset, offset + count)]); offset += count;
        if (!timer) timer = setTimeout(error, timeout);
        if (expected === undefined && buffer.length === 4) {
          expected = little ? buffer.readUInt32LE() : buffer.readUInt32BE();
          buffer = Buffer.alloc(0);
          if (!expected || expected > limit) throw new Error('frame-limit');
        } else if (expected !== undefined && buffer.length === expected) {
          const value = JSON.parse(decode.decode(buffer));
          buffer = Buffer.alloc(0); expected = undefined; clearTimeout(timer); timer = undefined;
          receive(value);
          if (stopped) break;
        }
      }
    } catch { error(); }
  }
  stream.on('data', data); stream.on('end', end); stream.on('error', error);
  return stop;
}

export function writeFrame(stream, value) {
  if (stream.destroyed || stream.writableLength > MAX_RESULT) throw new Error('backpressure-limit');
  stream.write(encode(value));
}

/** Ordered chunks bound both total memory and the number of in-flight assemblies. */
export function resultChunks(id, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > MAX_RESULT) throw new Error('response-limit');
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 64 * 1024) chunks.push(bytes.subarray(offset, offset + 64 * 1024).toString('base64'));
  return chunks.map((data, index) => ({ type: 'result-chunk', id, index, total: chunks.length, data }));
}

export function createAssembly() {
  let next = 0, total, bytes = 0, chunks = [];
  return message => {
    if (!Number.isInteger(message.index) || message.index !== next || !Number.isInteger(message.total) || message.total < 1 || message.total > 64 ||
      total !== undefined && message.total !== total || typeof message.data !== 'string' || message.data.length > 90_000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(message.data)) throw new Error('invalid-chunk');
    total = message.total; next++;
    const chunk = Buffer.from(message.data, 'base64'); bytes += chunk.length;
    if (bytes > MAX_RESULT || next > total) throw new Error('response-limit');
    chunks.push(chunk);
    if (next !== total) return undefined;
    const value = JSON.parse(decode.decode(Buffer.concat(chunks))); chunks = [];
    return value;
  };
}
