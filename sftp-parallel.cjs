'use strict';
const fs = require('node:fs/promises');

// ssh2's createReadStream and createWriteStream send one READ or WRITE request at a time, so every
// chunk waits a full round trip before the next one leaves. These helpers keep several chunks in
// flight and place each one at its own offset, which lets a file move at the link's speed instead of
// at one chunk per round trip.
const defaults = { chunkSize: 64 * 1024, window: 32 };

function sftpPromise(channel, method, ...args) {
  return new Promise((resolve, reject) => {
    channel[method](...args, (error, value) => error ? reject(error) : resolve(value));
  });
}

// Runs task(offset, length) for every chunk of a size-byte file, with at most `window` tasks running at once.
// A failed or cancelled chunk stops new chunks from starting, and every chunk already started is awaited before
// this resolves or rejects, so the caller can close handles safely afterwards.
async function runChunks(size, { chunkSize = defaults.chunkSize, window = defaults.window, signal } = {}, task) {
  let next = 0;
  let failure = null;
  const worker = async () => {
    while (next < size && !failure) {
      if (signal?.aborted) throw Error('Transfer cancelled.');
      const offset = next;
      next += chunkSize;
      try {
        await task(offset, Math.min(chunkSize, size - offset));
      } catch (error) {
        failure ??= error;
        throw error;
      }
    }
  };
  const chunks = Math.ceil(size / chunkSize);
  const workers = Array.from({ length: Math.max(1, Math.min(window, chunks)) }, worker);
  const results = await Promise.allSettled(workers);
  const rejected = results.find(result => result.status === 'rejected');
  if (rejected) throw rejected.reason;
}

// Downloads `size` bytes of remote into a new local file at `localPath` (created with flags 'wx').
// progress receives { bytes, total, path } after every chunk, like the streaming version it replaces.
async function downloadParallel(channel, remote, localPath, { size, signal, progress = () => {}, mode = 0o600, ...options }) {
  const handle = await sftpPromise(channel, 'open', remote, 'r');
  let output;
  let bytes = 0;
  let finished = false;
  try {
    output = await fs.open(localPath, 'wx', mode);
    await runChunks(size, { ...options, signal }, async (offset, length) => {
      let done = 0;
      while (done < length) {
        const part = Buffer.allocUnsafe(length - done);
        const read = await readAt(channel, handle, part, offset + done);
        if (!read) throw Error(`Remote file changed during transfer: ${remote}`);
        await output.write(part, 0, read, offset + done);
        done += read;
        bytes += read;
        progress({ bytes, total: size, path: remote });
      }
    });
    finished = true;
  } finally {
    await output?.close();
    await closeRemote(channel, handle, finished);
  }
}

// Uploads the local file at `local` into an already opened remote `handle` (opened with 'wx' by the caller).
// The handle is closed here: when the upload fails the close errors are ignored and the caller removes the target.
async function uploadParallel(channel, handle, local, { size, signal, progress = () => {}, ...options }) {
  const input = await fs.open(local, 'r');
  let bytes = 0;
  let finished = false;
  try {
    await runChunks(size, { ...options, signal }, async (offset, length) => {
      const part = Buffer.allocUnsafe(length);
      const { bytesRead } = await input.read(part, 0, length, offset);
      if (bytesRead !== length) throw Error(`Local file changed during transfer: ${local}`);
      await sftpPromise(channel, 'write', handle, part, 0, length, offset);
      bytes += length;
      progress({ bytes, total: size, path: local });
    });
    finished = true;
  } finally {
    await input.close();
    await closeRemote(channel, handle, finished);
  }
}

// Reads up to part.length bytes at position. Returns the byte count, 0 at the end of the file.
async function readAt(channel, handle, part, position) {
  try {
    return await new Promise((resolve, reject) => {
      channel.read(handle, part, 0, part.length, position, (error, count) => error ? reject(error) : resolve(count));
    });
  } catch (error) {
    if (error.code === 1) return 0; // STATUS_CODE.EOF
    throw error;
  }
}

// After a failure the close result does not matter, because the caller removes the partial file anyway.
async function closeRemote(channel, handle, finished) {
  if (finished) await sftpPromise(channel, 'close', handle);
  else await sftpPromise(channel, 'close', handle).catch(() => {});
}

module.exports = { runChunks, downloadParallel, uploadParallel, defaults };
