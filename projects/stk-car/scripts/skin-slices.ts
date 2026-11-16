import { crc32, deflateSync, inflateSync } from "node:zlib";

function chunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8), checksum = Buffer.alloc(4);
  header.writeUInt32BE(data.length); header.write(type, 4);
  checksum.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
  return Buffer.concat([header, data, checksum]);
}

/** Crop STK's non-interlaced 8-bit skin PNGs without changing their palette or alpha. */
export function skinSlices(png: Buffer, borders: readonly number[]): Buffer[] {
  const header = Buffer.from(png.subarray(16, 29));
  const width = header.readUInt32BE(), height = header.readUInt32BE(4);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[header[9]];
  if (header[8] !== 8 || header[12] !== 0 || !channels) throw new Error("Unsupported skin PNG format");
  const compressed: Buffer[] = [], metadata: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") compressed.push(png.subarray(offset + 8, offset + 8 + length));
    if (type === "PLTE" || type === "tRNS") metadata.push(png.subarray(offset, offset + length + 12));
    offset += length + 12;
  }
  const stride = width * channels, raw = inflateSync(Buffer.concat(compressed)), pixels = Buffer.alloc(stride * height);
  if (raw.length !== (stride + 1) * height) throw new Error("Invalid skin PNG scanlines");
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error("Invalid skin PNG filter");
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const corner = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : a <= b && a <= c ? left : b <= c ? up : corner;
      pixels[y * stride + x] = raw[y * (stride + 1) + 1 + x] + predictor;
    }
  }
  const [left, right, top, bottom] = borders, xs = [0, left, width - right, width], ys = [0, top, height - bottom, height];
  if (borders.length !== 4 || borders.some((value) => !Number.isInteger(value) || value < 0) || left + right >= width || top + bottom >= height) throw new Error("Invalid skin borders");
  return Array.from({ length: 9 }, (_, index) => {
    const x = index % 3, y = Math.floor(index / 3), w = xs[x + 1] - xs[x], h = ys[y + 1] - ys[y];
    if (!w || !h) return Buffer.alloc(0);
    const scanlines = Buffer.alloc((w * channels + 1) * h), cropped = Buffer.from(header);
    cropped.writeUInt32BE(w); cropped.writeUInt32BE(h, 4);
    for (let row = 0; row < h; row++) pixels.copy(scanlines, row * (w * channels + 1) + 1, (ys[y] + row) * stride + xs[x] * channels, (ys[y] + row) * stride + xs[x + 1] * channels);
    return Buffer.concat([png.subarray(0, 8), chunk("IHDR", cropped), ...metadata, chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0))]);
  });
}
