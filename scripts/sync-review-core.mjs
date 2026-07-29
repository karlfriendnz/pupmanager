/**
 * Pull the shared review-core sources into src/lib/review-core/.
 *
 * WHY A COPY AND NOT A DEPENDENCY: npm rewrites a GitHub dependency to
 * `git+ssh://` in the lockfile whatever URL you give it, and Vercel has no SSH
 * key — so `npm ci` fails and the deploy dies. Publishing to npm fixes that
 * properly; until then this keeps ONE source of truth (the review-core repo) with
 * a mechanical guarantee against drift (tests/unit/review-core-drift.test.ts).
 *
 * The copy is generated. Fix a capture rule in review-core, re-run this, commit.
 *
 *   node scripts/sync-review-core.mjs            # from ../review-core
 *   node scripts/sync-review-core.mjs --check    # exit 1 if the copy is stale
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, '..')
const SOURCE = process.env.REVIEW_CORE_SRC || join(APP, '..', 'review-core', 'src')
const DEST = join(APP, 'src', 'lib', 'review-core')
const check = process.argv.includes('--check')

const HEADER = (file, version) => `// GENERATED — do not edit here.
//
// Copied from the shared review-core package (${file}, v${version}) by
// scripts/sync-review-core.mjs. fm-events reads the same source, so a fix made
// HERE is a fix that only PupManager gets. Change it in review-core:
//   https://github.com/karlfriendnz/review-core
// then re-run \`node scripts/sync-review-core.mjs\` and commit the result.

`

/** The package writes ESM-correct './x.js' specifiers. Inside the app they resolve
 *  through the bundler, which wants the extension-less form. */
function rewrite(code) {
  return code.replace(/from '\.\/([a-z-]+)\.js'/g, "from './$1'")
}

async function main() {
  if (!existsSync(SOURCE)) {
    console.error(`review-core sources not found at ${SOURCE}.\nClone it next to this repo, or set REVIEW_CORE_SRC.`)
    process.exit(1)
  }
  const version = JSON.parse(await readFile(join(SOURCE, '..', 'package.json'), 'utf8')).version
  const files = (await readdir(SOURCE)).filter(f => f.endsWith('.ts'))
  await mkdir(DEST, { recursive: true })

  let stale = []
  for (const file of files) {
    const want = HEADER(file, version) + rewrite(await readFile(join(SOURCE, file), 'utf8'))
    const target = join(DEST, file)
    const have = existsSync(target) ? await readFile(target, 'utf8') : null
    if (have === want) continue
    if (check) { stale.push(file); continue }
    await writeFile(target, want, 'utf8')
    console.log(`${have == null ? 'added' : 'updated'}  src/lib/review-core/${file}`)
  }

  if (check && stale.length) {
    console.error(`Stale copies of review-core: ${stale.join(', ')}\nRun: node scripts/sync-review-core.mjs`)
    process.exit(1)
  }
  console.log(check ? 'review-core copy is current.' : `synced ${files.length} file(s) from review-core v${version}`)
}

main().catch(err => { console.error(err); process.exit(1) })
