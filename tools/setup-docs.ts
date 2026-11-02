import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { guideMarkdown } from '../apps/ui/src/setup/content'
import { guide as en } from '../apps/ui/src/setup/guide.en'
import { guide as el } from '../apps/ui/src/setup/guide.el'

const check = process.argv.includes('--check')
for (const [name, guide] of [['13-setup-guide.md', en], ['13-setup-guide.el.md', el]] as const) {
  const path = fileURLToPath(new URL(`../docs/${name}`, import.meta.url))
  const expected = guideMarkdown(guide)
  if (check) {
    let actual = ''
    try { actual = readFileSync(path, 'utf8').replaceAll('\r\n', '\n') } catch { /* missing output fails below */ }
    if (actual !== expected) { console.error(`${name} is stale. Run yarn docs:setup.`); process.exitCode = 1 }
  } else { writeFileSync(path, expected); console.log(`Wrote docs/${name}`) }
}
