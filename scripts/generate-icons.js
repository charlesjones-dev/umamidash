import sharp from 'sharp'
import { mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '../public')

// SVG with embedded text as paths for reliable rendering
// "UD" in bold on dark background
const createSvg = (size) => {
  const r = Math.round(size * 0.1875) // rounded corner ratio
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${96}" fill="#111111"/>
  <text x="256" y="340" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="260" fill="white" text-anchor="middle" letter-spacing="-8">UD</text>
</svg>`
}

// Maskable icon needs extra padding (safe zone is inner 80%)
const createMaskableSvg = () => {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#111111"/>
  <text x="256" y="330" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="200" fill="white" text-anchor="middle" letter-spacing="-6">UD</text>
</svg>`
}

const icons = [
  { name: 'pwa-64x64.png', size: 64 },
  { name: 'pwa-192x192.png', size: 192 },
  { name: 'pwa-512x512.png', size: 512 },
  { name: 'apple-touch-icon-180x180.png', size: 180 },
  { name: 'maskable-icon-512x512.png', size: 512, maskable: true },
]

async function generate() {
  for (const icon of icons) {
    const svg = icon.maskable ? createMaskableSvg() : createSvg(icon.size)
    const outputPath = resolve(publicDir, icon.name)

    await sharp(Buffer.from(svg))
      .resize(icon.size, icon.size)
      .png()
      .toFile(outputPath)

    console.log(`Generated ${icon.name}`)
  }

  // Generate favicon.ico (32x32)
  const icoSvg = createSvg(32)
  await sharp(Buffer.from(icoSvg))
    .resize(32, 32)
    .png()
    .toFile(resolve(publicDir, 'favicon-32x32.png'))
  console.log('Generated favicon-32x32.png')

  console.log('All icons generated successfully!')
}

generate().catch(console.error)
