import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const publicDir = path.join(appRoot, 'public');
const iconsDir = path.join(publicDir, 'icons');
const sourceSvgPath = path.join(iconsDir, 'argus-icon.svg');

const pwaIconSizes = [72, 96, 128, 144, 152, 192, 384, 512];
const logoSizes = [32, 64, 128, 256, 512];
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

function createIco(pngBuffers) {
  const headerSize = 6;
  const directorySize = 16 * pngBuffers.length;
  let imageOffset = headerSize + directorySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngBuffers.length, 4);

  const directory = Buffer.alloc(directorySize);
  pngBuffers.forEach(({ size, buffer }, index) => {
    const entryOffset = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, entryOffset);
    directory.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2);
    directory.writeUInt8(0, entryOffset + 3);
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(buffer.length, entryOffset + 8);
    directory.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += buffer.length;
  });

  return Buffer.concat([header, directory, ...pngBuffers.map(({ buffer }) => buffer)]);
}

async function renderPng(svg, size, outputPath) {
  await sharp(svg)
    .resize(size, size, { fit: 'contain' })
    .png()
    .toFile(outputPath);
}

async function main() {
  await mkdir(iconsDir, { recursive: true });
  const sourceSvg = await readFile(sourceSvgPath);

  await writeFile(path.join(publicDir, 'favicon.svg'), sourceSvg);
  await writeFile(path.join(publicDir, 'logo.svg'), sourceSvg);
  await writeFile(path.join(iconsDir, 'icon-template.svg'), sourceSvg);

  await renderPng(sourceSvg, 32, path.join(publicDir, 'favicon.png'));

  for (const size of logoSizes) {
    await renderPng(sourceSvg, size, path.join(publicDir, `logo-${size}.png`));
  }

  for (const size of pwaIconSizes) {
    await renderPng(sourceSvg, size, path.join(iconsDir, `icon-${size}x${size}.png`));
    await writeFile(path.join(iconsDir, `icon-${size}x${size}.svg`), sourceSvg);
  }

  const icoPngBuffers = [];
  for (const size of icoSizes) {
    const buffer = await sharp(sourceSvg)
      .resize(size, size, { fit: 'contain' })
      .png()
      .toBuffer();
    icoPngBuffers.push({ size, buffer });
  }

  await writeFile(path.join(publicDir, 'icon.ico'), createIco(icoPngBuffers));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
