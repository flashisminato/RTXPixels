/**
 * Pre-bootstrap shim.
 *
 * `src/contracts.ts` is owned by AI 3 and arrives with the bootstrap commit.
 * Until then the renderer cannot compile, so this script materialises the
 * contract v1 type declarations at that path ONLY when the file is absent.
 *
 * It never overwrites an existing file: once AI 3's real contract lands, that
 * one is authoritative and this script becomes a no-op. The generated file is
 * git-ignored on this branch and must never be committed by AI 1.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const target = resolve(repoRoot, 'src/contracts.ts');
const source = resolve(here, 'contract-v1.types.ts');

if (existsSync(target)) {
  console.log('[prepare-contracts] src/contracts.ts exists; leaving AI 3\'s file untouched.');
  process.exit(0);
}

const banner = `// GENERATED PLACEHOLDER - DO NOT COMMIT, DO NOT EDIT.
// AI 3 owns src/contracts.ts. This copy exists only so the renderer branch can
// typecheck and run its GPU tests before the bootstrap commit lands. It is
// reproduced verbatim from the contract v1 block in the AI 1 brief.
// Delete it and re-run the renderer tests once the real file is available.

`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, banner + readFileSync(source, 'utf8'), 'utf8');
console.log('[prepare-contracts] wrote placeholder src/contracts.ts (pre-bootstrap only).');
