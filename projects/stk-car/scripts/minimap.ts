import { crc32, deflateSync } from "node:zlib";

export function minimap(route: readonly { center: readonly number[] }[]): { image: Buffer; bounds: { minX: number; minZ: number; size: number } } {
  const x = route.map((node) => node.center[0]), z = route.map((node) => node.center[2]);
  const extent = Math.max(Math.max(...x) - Math.min(...x), Math.max(...z) - Math.min(...z));
  const size = extent * 1.15;
  const bounds = { minX: (Math.max(...x) + Math.min(...x) - size) / 2, minZ: (Math.max(...z) + Math.min(...z) - size) / 2, size };
  const pixels = Buffer.alloc(512 * 512 * 4);
  const point = (node: { center: readonly number[] }) => [(node.center[0] - bounds.minX) / size * 511, (node.center[2] - bounds.minZ) / size * 511];
  for (const [radius, value] of [[8, 24], [5, 240]]) for (let i = 0; i < route.length; i++) {
    const a = point(route[i]), b = point(route[(i + 1) % route.length]);
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
    for (let step = 0; step <= steps; step++) {
      const px = a[0] + (b[0] - a[0]) * step / Math.max(1, steps), py = a[1] + (b[1] - a[1]) * step / Math.max(1, steps);
      for (let y = Math.max(0, Math.floor(py - radius)); y <= Math.min(511, py + radius); y++) for (let x = Math.max(0, Math.floor(px - radius)); x <= Math.min(511, px + radius); x++) {
        if ((x - px) ** 2 + (y - py) ** 2 > radius ** 2) continue;
        const offset = (y * 512 + x) * 4;
        pixels[offset] = value; pixels[offset + 1] = value; pixels[offset + 2] = value; pixels[offset + 3] = 255;
      }
    }
  }
  function chunk(type: string, data: Buffer): Buffer {
    const header = Buffer.alloc(8), checksum = Buffer.alloc(4);
    header.writeUInt32BE(data.length); header.write(type, 4);
    checksum.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([header, data, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(512); header.writeUInt32BE(512, 4); header[8] = 8; header[9] = 6;
  const scanlines = Buffer.alloc(512 * (512 * 4 + 1));
  for (let y = 0; y < 512; y++) pixels.copy(scanlines, y * 2049 + 1, y * 2048, (y + 1) * 2048);
  return { bounds, image: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0))]) };
}
