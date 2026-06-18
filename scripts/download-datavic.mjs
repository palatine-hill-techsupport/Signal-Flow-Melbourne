#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const DEFAULT_ZIP_URL =
  "https://opendata.transport.vic.gov.au/dataset/331b846b-1e18-415f-a3f3-ce4198d86c82/resource/b04e8ea0-8c05-4d29-a5cb-faf17446cb8f/download/traffic_signal_volume_data_june_2026.zip";

function argValue(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function safeTarget(root, entryName) {
  const target = path.resolve(root, entryName);
  if (!target.startsWith(path.resolve(root))) {
    throw new Error(`Refusing to extract unsafe ZIP entry: ${entryName}`);
  }
  return target;
}

async function main() {
  const url = argValue("--url", process.env.DATAVIC_ZIP_URL ?? DEFAULT_ZIP_URL);
  const dataDir = path.resolve(rootDir, argValue("--out", "data"));
  const zipPath = path.join(dataDir, "traffic_signal_volume_data.zip");
  await mkdir(dataDir, { recursive: true });

  console.log(`Downloading DataVic traffic signal volume data`);
  console.log(url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(zipPath, bytes);
  console.log(`Saved ${path.relative(rootDir, zipPath)} (${bytes.length.toLocaleString("en-AU")} bytes)`);

  const zip = new AdmZip(zipPath);
  let extracted = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const target = safeTarget(dataDir, path.basename(entry.entryName));
    if (!/^VSDATA_\d{8}\.csv$/i.test(path.basename(target))) continue;
    await writeFile(target, entry.getData());
    extracted += 1;
  }
  console.log(`Extracted ${extracted} daily CSV files to ${path.relative(rootDir, dataDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
