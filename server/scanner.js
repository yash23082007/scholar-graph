import net from 'node:net';
import { readFile } from 'node:fs/promises';

export function scannerStatus() {
  return { configured: Boolean(process.env.CLAMAV_HOST), required: process.env.REQUIRE_CLAMAV === 'true' };
}

export async function scanFile(filePath, timeoutMs = 30000) {
  const host = process.env.CLAMAV_HOST;
  if (!host) {
    if (process.env.REQUIRE_CLAMAV === 'true') throw Object.assign(new Error('Malware scanner is required but CLAMAV_HOST is not configured.'), { code: 'SCANNER_UNAVAILABLE' });
    return { scanned: false, result: 'not_configured' };
  }
  const buffer = await readFile(filePath);
  const port = Number(process.env.CLAMAV_PORT || 3310);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let response = '';
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; socket.destroy(); fn(value); };
    const timer = setTimeout(() => finish(reject, Object.assign(new Error('Malware scanner timed out.'), { code: 'SCANNER_TIMEOUT' })), timeoutMs);
    socket.on('connect', () => {
      socket.write(Buffer.from('zINSTREAM\0'));
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const chunk = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length); socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on('data', (data) => { response += data.toString('utf8'); });
    socket.on('end', () => {
      clearTimeout(timer);
      if (response.includes('FOUND')) return finish(reject, Object.assign(new Error('File was flagged by the malware scanner.'), { code: 'MALWARE_DETECTED' }));
      if (response.includes('OK')) return finish(resolve, { scanned: true, result: 'clean' });
      finish(reject, Object.assign(new Error('Malware scanner returned an invalid response.'), { code: 'SCANNER_ERROR' }));
    });
    socket.on('error', (err) => { clearTimeout(timer); finish(reject, Object.assign(new Error(`Malware scanner is unavailable: ${err.message}`), { code: 'SCANNER_UNAVAILABLE' })); });
  });
}
