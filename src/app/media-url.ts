// Where the browser should fetch gallery media from.
//
// Most media reaches the app through the gallery manifest, which already
// carries absolute CDN URLs. But a handful of paths are hard-coded in
// templates and in the services list -- the hero video among them, at 206 MB.
// Left relative, those resolve against the app's own origin, which then has to
// redirect each one to the bucket: an extra round trip per visitor, and a hard
// dependency on the origin having a gallery route at all.
//
// The base URL is read once from assets/media-config.json before Angular
// bootstraps (see main.ts), so resolution here is synchronous and no template
// ever renders a placeholder first.

const GALLERY_PREFIX = 'assets/gallery/';

let mediaBaseUrl = '';
// Same-origin by default: Nginx proxies /api/ to the Express server on the
// VPS, and proxy.conf.json does the same for `ng serve`. API_BASE_URL only
// needs setting when the API lives on a different origin than the site.
let apiBaseUrl = '/api';

export function setMediaBaseUrl(url: string) {
  mediaBaseUrl = String(url || '').trim().replace(/\/+$/, '');
}

export function getMediaBaseUrl(): string {
  return mediaBaseUrl;
}

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

// `assets/gallery/aerial/clip.mp4` -> `https://media.example.com/assets/gallery/aerial/clip.mp4`
//
// Anything already absolute, and anything outside the gallery tree (bundled
// assets like assets/outdoor portrait.png), is returned untouched. With no
// base configured this is the identity function, so local-disk mode keeps
// working exactly as before.
export function mediaUrl(path: string): string {
  const value = String(path || '').trim();
  if (!value || !mediaBaseUrl) return value;
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) return value;

  const relative = value.replace(/^\/+/, '');
  if (!relative.startsWith(GALLERY_PREFIX)) return value;

  const encoded = relative.split('/').map(encodeURIComponent).join('/');
  return `${mediaBaseUrl}/${encoded}`;
}

// Fetches the build-time media config. Failure is not an error: the app falls
// back to origin-relative paths, which still work wherever the gallery is
// served from disk or redirected.
export async function loadMediaConfig(): Promise<void> {
  try {
    const response = await fetch('assets/media-config.json', { cache: 'no-store' });
    if (!response.ok) return;
    const config = await response.json() as { mediaBaseUrl?: string; apiBaseUrl?: string };
    setMediaBaseUrl(config?.mediaBaseUrl || '');
    apiBaseUrl = String(config?.apiBaseUrl || apiBaseUrl).trim().replace(/\/+$/, '') || apiBaseUrl;
  } catch {
    // Keep the relative-path fallback.
  }
}
