import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

// Rasterize the existing three-step vector brand with no external asset service.
const output = new URL('../public/icons/', import.meta.url);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function png(size) {
  const rows = Buffer.alloc((size * 3 + 1) * size);
  const bars = [[148, 272, 64, 96], [224, 208, 64, 160], [300, 144, 64, 224]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + .5) * 512 / size; const py = (y + .5) * 512 / size;
      const inside = bars.some(([left, top, width, height]) => px >= left && px < left + width && py >= top && py < top + height);
      const color = inside ? [213, 245, 106] : [21, 23, 24];
      const offset = y * (size * 3 + 1) + 1 + x * 3;
      rows.set(color, offset);
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
await mkdir(output, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['maskable-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await writeFile(new URL(name, output), png(size));
}
console.log('KROK app icons ready.');
