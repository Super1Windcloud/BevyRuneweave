// Optional artwork tooling: make sharp available through NODE_PATH.
// Committed platform assets keep normal builds independent of this tool.
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sharp = createRequire(import.meta.url)("sharp");
const root = resolve(import.meta.dirname, "..");
const file = (path: string) => resolve(root, path);
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
const source = await readFile(file("assets/branding/runeweave-icon.png"));
const artwork = await sharp(source).trim({ background: transparent }).png().toBuffer();

async function square(edge: number, artworkEdge: number): Promise<Buffer> {
  const inset = (edge - artworkEdge) / 2;
  return sharp(artwork)
    .resize(artworkEdge, artworkEdge, { fit: "contain", background: transparent })
    .extend({ top: inset, bottom: inset, left: inset, right: inset, background: transparent })
    .png().toBuffer();
}

const master = await square(1024, 924);
await sharp(master).resize(256, 256).png().toFile(file("assets/branding/bevy_icon.png"));
await writeFile(file("assets/branding/bevy_launcher_icon_macos.png"), await square(1024, 824));

for (const [density, edge] of [
  ["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192],
] as const) {
  await sharp(master).resize(edge, edge).png().toFile(file(
    `examples/android-demo-host/app/src/main/res/mipmap-${density}/ic_launcher.png`,
  ));
}

const catalog = file("examples/ios-demo-host/Assets.xcassets/AppIcon.appiconset");
const contents = JSON.parse(await readFile(resolve(catalog, "Contents.json"), "utf8")) as {
  images: Array<{ filename: string; size: string; scale: string }>;
};
const sizes = new Map<string, number>();
for (const image of contents.images) {
  const edge = Number.parseFloat(image.size) * Number.parseFloat(image.scale);
  if (!Number.isInteger(edge) || edge <= 0 || image.filename.includes("/")) {
    throw new Error(`Invalid AppIcon slot: ${image.filename}`);
  }
  const previous = sizes.get(image.filename);
  if (previous !== undefined && previous !== edge) throw new Error("Conflicting AppIcon sizes");
  sizes.set(image.filename, edge);
}
// iOS applies its own mask and requires fully opaque App Store artwork.
const ios = await square(1024, 1024);
for (const [filename, edge] of sizes) {
  const destination = resolve(catalog, filename);
  await sharp(ios).resize(edge, edge).flatten({ background: "#100c1c" }).png().toFile(destination);
  const metadata = await sharp(destination).metadata();
  if (metadata.width !== edge || metadata.height !== edge || metadata.hasAlpha) {
    throw new Error(`Invalid generated AppIcon: ${filename}`);
  }
}
console.log(`Generated desktop, macOS, Android, and ${sizes.size} opaque iOS icons.`);
