#!/usr/bin/env node

import {
  cpSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  });
}

function createZip(sourceDirectory, outputPath) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const path of collectFiles(sourceDirectory).sort()) {
    const name = relative(sourceDirectory, path).split(sep).join('/');
    const nameBuffer = Buffer.from(name);
    const data = readFileSync(path);
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    const centralHeader = Buffer.alloc(46);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);

    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE((statSync(path).mode * 0x10000) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    localParts.push(localHeader, nameBuffer, data);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  const entryCount = centralParts.length / 2;

  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entryCount, 8);
  endRecord.writeUInt16LE(entryCount, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);

  writeFileSync(outputPath, Buffer.concat([...localParts, centralDirectory, endRecord]));
}

function parseOutputDirectory(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Usage: node scripts/build-plugin.js [options]

Build the ChatGPT Work/Web plugin ZIP.

Options:
  --output <directory>  Output directory (default: dist)
  -h, --help            Show this help`);
    process.exit(0);
  }

  if (argv.length === 0) {
    return resolve('dist');
  }

  if (argv[0] !== '--output') {
    throw new Error(`Unknown option: ${argv[0]}`);
  }

  const value = argv[1];
  if (!value || value.startsWith('-')) {
    throw new Error('--output requires a directory');
  }

  if (argv.length > 2) {
    throw new Error(`Unexpected argument: ${argv[2]}`);
  }

  return resolve(value);
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const sourceManifest = JSON.parse(readFileSync('.codex-plugin/plugin.json', 'utf8'));
const outputDirectory = parseOutputDirectory(process.argv.slice(2));
const workDirectory = mkdtempSync(join(tmpdir(), 'slides-grab-plugin-build-'));
const pluginDirectory = join(workDirectory, 'slides-grab');
const zipName = `slides-grab-chatgpt-plugin-v${packageJson.version}.zip`;
const zipPath = join(outputDirectory, zipName);

try {
  mkdirSync(join(pluginDirectory, '.codex-plugin'), { recursive: true });
  cpSync('skills', join(pluginDirectory, 'skills'), { recursive: true });
  cpSync('CHATGPT.md', join(pluginDirectory, 'CHATGPT.md'));

  writeFileSync(
    join(pluginDirectory, '.codex-plugin', 'plugin.json'),
    `${JSON.stringify({ ...sourceManifest, version: packageJson.version }, null, 2)}\n`,
  );

  mkdirSync(outputDirectory, { recursive: true });
  rmSync(zipPath, { force: true });
  createZip(workDirectory, zipPath);

  console.log(zipPath);
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}
