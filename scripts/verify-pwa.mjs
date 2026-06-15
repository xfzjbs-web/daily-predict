import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const distDir = join(projectRoot, 'dist')

const requiredFiles = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
]

const checks = []

function pass(message) {
  checks.push({ ok: true, message })
}

function fail(message) {
  checks.push({ ok: false, message })
}

async function exists(relativePath) {
  try {
    await access(join(distDir, relativePath))
    pass(`found ${relativePath}`)
    return true
  } catch {
    fail(`missing ${relativePath}`)
    return false
  }
}

function hasStandaloneDisplay(manifest) {
  return (
    manifest.display === 'standalone' ||
    (Array.isArray(manifest.display_override) && manifest.display_override.includes('standalone'))
  )
}

function hasIcon(manifest, size, purpose) {
  return manifest.icons?.some((icon) => {
    const purposes = String(icon.purpose ?? 'any').split(/\s+/)
    return icon.sizes === size && purposes.includes(purpose)
  })
}

for (const file of requiredFiles) {
  await exists(file)
}

try {
  const html = await readFile(join(distDir, 'index.html'), 'utf8')
  html.includes('manifest.webmanifest')
    ? pass('index.html links manifest')
    : fail('index.html does not link manifest.webmanifest')
} catch (error) {
  fail(`unable to read index.html: ${error.message}`)
}

try {
  const manifest = JSON.parse(await readFile(join(distDir, 'manifest.webmanifest'), 'utf8'))

  manifest.name === '每日预测' ? pass('manifest name is 每日预测') : fail('manifest name is not 每日预测')
  manifest.short_name ? pass('manifest short_name exists') : fail('manifest short_name is missing')
  manifest.start_url ? pass('manifest start_url exists') : fail('manifest start_url is missing')
  manifest.scope ? pass('manifest scope exists') : fail('manifest scope is missing')
  hasStandaloneDisplay(manifest) ? pass('manifest supports standalone display') : fail('manifest lacks standalone display')
  manifest.theme_color ? pass('manifest theme_color exists') : fail('manifest theme_color is missing')
  hasIcon(manifest, '192x192', 'any') ? pass('manifest has 192x192 icon') : fail('manifest lacks 192x192 icon')
  hasIcon(manifest, '512x512', 'any') ? pass('manifest has 512x512 icon') : fail('manifest lacks 512x512 icon')
  hasIcon(manifest, '512x512', 'maskable')
    ? pass('manifest has maskable 512x512 icon')
    : fail('manifest lacks maskable 512x512 icon')
} catch (error) {
  fail(`unable to validate manifest.webmanifest: ${error.message}`)
}

try {
  const serviceWorker = await readFile(join(distDir, 'sw.js'), 'utf8')
  serviceWorker.includes('self.addEventListener') && serviceWorker.includes('fetch')
    ? pass('service worker handles fetch')
    : fail('service worker fetch handler is missing')
  serviceWorker.includes('daily-predict-')
    ? pass('service worker has app cache namespace')
    : fail('service worker cache namespace is missing')
} catch (error) {
  fail(`unable to read sw.js: ${error.message}`)
}

const failed = checks.filter((check) => !check.ok)

for (const check of checks) {
  console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.message}`)
}

if (failed.length > 0) {
  console.error(`\nPWA verification failed: ${failed.length} issue(s).`)
  process.exit(1)
}

console.log('\nPWA verification passed.')
