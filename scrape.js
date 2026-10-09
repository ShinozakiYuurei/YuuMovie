#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binName = process.platform === 'win32' ? 'scrape.exe' : 'scrape';
const binPath = path.join(__dirname, 'bin', binName);

let cmd, args;
if (fs.existsSync(binPath)) {
  cmd = binPath;
  args = process.argv.slice(2);
} else {
  cmd = 'go';
  args = ['-C', path.join(__dirname, 'goscraper'), 'run', './cmd/scrape', ...process.argv.slice(2)];
}

const res = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
process.exit(res.status ?? 0);