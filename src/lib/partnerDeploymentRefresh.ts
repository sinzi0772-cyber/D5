const viteEntryPath = /^\/assets\/index-[A-Za-z0-9_-]{8,64}\.js$/
const reloadMarkerPrefix = 'd5:partner-deployment-reloaded:'
const checkTimeout = 2500

let deploymentCheck: Promise<string | null> | undefined
let reloadRequested = false

function entryPath(root: ParentNode): string | null {
  const paths = Array.from(root.querySelectorAll('script[type="module"][src]'), script => script.getAttribute('src'))
    .filter((path): path is string => path !== null && viteEntryPath.test(path))
  return paths.length === 1 ? paths[0] : null
}

async function fetchPublishedEntry(): Promise<string | null> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), checkTimeout)
  try {
    const response = await fetch(new URL('/', window.location.origin), {
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
    if (!response.ok || contentType !== 'text/html') return null

    // Inspect the HTML in an inert template without loading any of its resources.
    const template = document.createElement('template')
    template.innerHTML = await response.text()
    return entryPath(template.content)
  } catch {
    return null
  } finally {
    window.clearTimeout(timeout)
  }
}

/** Recover a partner login from an outdated bundle without changing that session. */
export async function maybeReloadPartnerDeployment(isCurrentSession: () => boolean): Promise<boolean> {
  if (!import.meta.env.PROD || typeof window === 'undefined') return false
  try {
    if (!isCurrentSession()) return false
    if (reloadRequested) return true

    const current = entryPath(document)
    if (!current) return false
    const marker = reloadMarkerPrefix + current
    if (window.sessionStorage.getItem(marker) === '1') return false

    const published = await (deploymentCheck ??= fetchPublishedEntry().finally(() => {
      deploymentCheck = undefined
    }))
    if (!published || published === current || !isCurrentSession()) return false
    if (reloadRequested) return true

    window.sessionStorage.setItem(marker, '1')
    window.location.reload()
    reloadRequested = true
    return true
  } catch {
    return false
  }
}
