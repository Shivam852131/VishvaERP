#!/usr/bin/env node
/**
 * Vishva ERP — Secret Generator
 *
 * Produces cryptographically strong secrets using the operating system's
 * CSPRNG (Node's `crypto.randomBytes`). Nothing is sent anywhere.
 *
 * Usage:
 *   node scripts/generate-secrets.js           # print the secrets
 *   node scripts/generate-secrets.js --write   # also write/refresh them in .env
 *   node scripts/generate-secrets.js --env .env.local
 *
 * Why not a website?
 *   A third-party generator runs its own JavaScript in your browser. If that
 *   site (or the CDN it loads from) is ever compromised, the secret it
 *   "generates" can silently be copied elsewhere. Generating locally means
 *   the secret never leaves this machine.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SECRETS = [
  { key: 'JWT_SECRET', bytes: 48 },
  { key: 'JWT_REFRESH_SECRET', bytes: 48 },
];

const args = process.argv.slice(2);
const shouldWrite = args.includes('--write');
const envIndex = args.indexOf('--env');
const envFile = envIndex > -1 && args[envIndex + 1]
  ? path.resolve(ROOT, args[envIndex + 1])
  : path.resolve(ROOT, '.env');

const generate = (bytes) => crypto.randomBytes(bytes).toString('hex');

const generated = {};
SECRETS.forEach(({ key, bytes }) => {
  generated[key] = generate(bytes);
});

// ── Print ───────────────────────────────────────────────────────────────────
console.log('\n===============================================================');
console.log(' Vishva ERP - Generated Secrets');
console.log('===============================================================\n');

SECRETS.forEach(({ key, bytes }) => {
  const bits = bytes * 8;
  console.log(`${key}`);
  console.log(`  value : ${generated[key]}`);
  console.log(`  length: ${generated[key].length} chars (${bits} bits of entropy)`);
  console.log('');
});

console.log('Store these in your deployment environment (Render / Vercel / .env).');
console.log('They are shown once - do not commit them to git.\n');

// ── Optionally write into an env file ───────────────────────────────────────
if (shouldWrite) {
  let contents = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';

  SECRETS.forEach(({ key }) => {
    const line = `${key}=${generated[key]}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (pattern.test(contents)) {
      contents = contents.replace(pattern, line);
    } else {
      if (contents && !contents.endsWith('\n')) contents += '\n';
      contents += `${line}\n`;
    }
  });

  fs.writeFileSync(envFile, contents, 'utf8');
  console.log(`Written to ${path.relative(ROOT, envFile)}\n`);
} else {
  console.log('Tip: run with --write to store them straight into .env\n');
}
