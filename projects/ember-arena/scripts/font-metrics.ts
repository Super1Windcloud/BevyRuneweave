// OpenType cmap format 4 and hmtx, as specified by Microsoft Typography.
// https://learn.microsoft.com/typography/opentype/spec/cmap
export function fontAdvances(font: Buffer): Record<string, number> {
  const tables = new Map<string, number>();
  for (let index = 0; index < font.readUInt16BE(4); index++) {
    const entry = 12 + index * 16;
    tables.set(font.toString("ascii", entry, entry + 4), font.readUInt32BE(entry + 8));
  }
  const table = (name: string): number => {
    const offset = tables.get(name); if (offset === undefined) throw new Error(`Missing font table ${name}`); return offset;
  };
  const units = font.readUInt16BE(table("head") + 18);
  const metrics = font.readUInt16BE(table("hhea") + 34), hmtx = table("hmtx"), cmap = table("cmap");
  let format4 = -1;
  for (let index = 0; index < font.readUInt16BE(cmap + 2); index++) {
    const offset = cmap + font.readUInt32BE(cmap + 4 + index * 8 + 4);
    if (font.readUInt16BE(offset) === 4) { format4 = offset; break; }
  }
  if (format4 < 0) throw new Error("Original pixel font has no Unicode format-4 cmap");
  const count = font.readUInt16BE(format4 + 6) / 2;
  const ends = format4 + 14, starts = ends + count * 2 + 2, deltas = starts + count * 2, ranges = deltas + count * 2;
  const result: Record<string, number> = {};
  for (let code = 32; code < 127; code++) {
    let glyph = 0;
    for (let segment = 0; segment < count; segment++) {
      const start = font.readUInt16BE(starts + segment * 2), end = font.readUInt16BE(ends + segment * 2);
      if (code < start || code > end) continue;
      const delta = font.readInt16BE(deltas + segment * 2), range = font.readUInt16BE(ranges + segment * 2);
      if (!range) glyph = (code + delta) & 0xffff;
      else {
        glyph = font.readUInt16BE(ranges + segment * 2 + range + 2 * (code - start));
        if (glyph) glyph = (glyph + delta) & 0xffff;
      }
      break;
    }
    result[String.fromCharCode(code)] = font.readUInt16BE(hmtx + Math.min(glyph, metrics - 1) * 4) / units;
  }
  return result;
}
