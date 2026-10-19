// Renders the SVG masters in ../src into the PNG / ICO assets the apps consume.
// Output is committed so a fresh checkout can run without re-rendering.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (name) => join(root, 'src', name)
const out = (name) => join(root, 'assets', name)

const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

async function render(svgFile, size) {
  const svg = await readFile(src(svgFile))
  return sharp(svg, { density: Math.max(72, size * 2) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer()
}

await mkdir(join(root, 'assets'), { recursive: true })

const iconPngs = new Map()
for (const size of PNG_SIZES) {
  const buf = await render('icon.svg', size)
  iconPngs.set(size, buf)
  await writeFile(out(`icon-${size}.png`), buf)
}

// Windows app / installer / taskbar icon.
const ico = await pngToIco(ICO_SIZES.map((s) => iconPngs.get(s) ?? null).filter(Boolean))
await writeFile(out('theama.ico'), ico)

// Tray icon: monochrome mark at the sizes Windows asks for (100% / 150% / 200% DPI).
for (const size of [16, 24, 32]) {
  await writeFile(out(`tray-${size}.png`), await render('icon-monochrome.svg', size))
}

// Vector copies for the UI (favicon, sidebar logo, splash).
for (const name of ['icon.svg', 'logo-mark.svg', 'logo-full.svg', 'icon-monochrome.svg']) {
  await writeFile(out(name), await readFile(src(name)))
}

console.log(`brand assets written to ${join(root, 'assets')}`)
