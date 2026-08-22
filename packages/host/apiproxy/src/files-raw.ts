/**
 * Raw byte channel for the files domain: the GET /api/file/<sessionId>/<path>
 * surface serves one contained file's verbatim bytes to the browser preview
 * and download handlers. It is host-only (no wire envelope, absent from
 * IApiClient) like the session-log export, and shares the working-set
 * admission of the bounded text read — the same containment proof gates both
 * channels. The 25 MiB bound is a protocol constant enforced on the stat
 * size before any byte is streamed (413 above it); the content type is a
 * curated extension map that falls back to application/octet-stream, which
 * the X-Content-Type-Options: nosniff header keeps the browser from treating
 * as a renderable document.
 */

import { extname } from 'node:path'

/** Maximum whole-file size one raw channel request serves (25 MiB). */
export const FILE_RAW_MAX_BYTES = 25 * 1024 * 1024

/**
 * Curated extension → content type for the raw channel: the inspector's
 * preview families plus the common text and archive shapes. Anything
 * unmapped serves application/octet-stream — a correct, if unrenderable,
 * answer that the nosniff header keeps inert.
 */
const RAW_MIME: Record<string, string> = {
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'application/yaml; charset=utf-8',
  '.yml': 'application/yaml; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.tsx': 'text/javascript; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
  '.rb': 'text/plain; charset=utf-8',
  '.go': 'text/plain; charset=utf-8',
  '.rs': 'text/plain; charset=utf-8',
  '.java': 'text/plain; charset=utf-8',
  '.c': 'text/plain; charset=utf-8',
  '.h': 'text/plain; charset=utf-8',
  '.cpp': 'text/plain; charset=utf-8',
  '.sh': 'text/plain; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

/**
 * Content type for one raw channel path.
 * @param path - the canonical target path.
 * @returns the curated content type, or application/octet-stream.
 */
export function mimeForPath(path: string): string {
  return RAW_MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}
