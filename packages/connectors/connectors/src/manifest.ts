/**
 * Connector manifest parsing and validation. Shipped manifests are YAML in
 * the catalog directory; custom manifests are JSON in the user directory.
 * Both parse into the same {@link ConnectorManifest} through the same
 * validator, because a custom connector is a connector — the only difference
 * is which of the two directories owns its document.
 *
 * Every deviation is a rejection, not a skip: a manifest that parses to the
 * wrong type would read as "the connector I added has no effect".
 * @module @deepseek-ai/dsh-connectors/manifest
 */

import { parse as parseYaml } from 'yaml'
import type {
  ConnectorAuthMethod,
  ConnectorManifest,
  ConnectorServerSpec,
  ConnectorStdioServerSpec,
  ConnectorStreamableHttpServerSpec,
  ServerValue,
  TokenAuthMethod,
  OauthAuthMethod,
  DeviceAuthMethod,
} from './types.ts'

/** Connector id shape: directory-safe, lower-case, unique across the catalog. */
export const CONNECTOR_ID = /^[a-z0-9][a-z0-9-]{0,31}$/

/** Custom connector id shape: the `custom-` prefix plus a slug of at most 25 characters. */
export const CUSTOM_CONNECTOR_ID = /^custom-[a-z0-9][a-z0-9-]{0,24}$/

/** MCP serverName shape, mirroring the mcp-manager constraint. */
export const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/** Credential reference shape, mirroring the credentials seam's POSIX identifier. */
export const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Thrown when a manifest document does not parse to a valid manifest. The
 * message names the document and the first offending field, and quotes no
 * value — an env or header slot may carry a secret placeholder the caller
 * meant to store, and its reference name is the only part safe to print.
 */
export class InvalidManifestError extends Error {
  constructor(
    /** The document the validation ran against. */
    readonly source: string,
    problem: string,
  ) {
    super(`connectors: invalid manifest at ${source}: ${problem}`)
    this.name = 'InvalidManifestError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Whether one string slot is a literal or a well-formed placeholder.
 * @param value - the raw slot value.
 */
function isServerValue(value: unknown): value is ServerValue {
  if (isNonEmptyString(value)) return true
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 1) return false
  const key = keys[0]
  if (key === '$cred') return isNonEmptyString(value.$cred)
  if (key === '$override') return isNonEmptyString(value.$override)
  return false
}

/** A mutable mirror of a readonly view type, for construction sites. */
type Writable<T> = { -readonly [K in keyof T]: T[K] }

/** Validate one credential-reference slot (token methods, placeholder refs). */
function assertCredentialRef(source: string, where: string, value: unknown): string {
  if (!isNonEmptyString(value) || !CREDENTIAL_REF.test(value)) {
    throw new InvalidManifestError(source, `${where} must be a POSIX identifier (got ${JSON.stringify(value)})`)
  }
  return value
}

/** Validate one string slot of a server spec. */
function assertServerValue(source: string, where: string, value: unknown): ServerValue {
  if (!isServerValue(value)) {
    throw new InvalidManifestError(source, `${where} must be a non-empty string or a {$cred}/{override} placeholder`)
  }
  return value
}

function assertStringMap(source: string, where: string, value: unknown): Record<string, ServerValue> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new InvalidManifestError(source, `${where} must be a mapping`)
  const out: Record<string, ServerValue> = {}
  for (const [key, slot] of Object.entries(value)) {
    if (!isNonEmptyString(key)) throw new InvalidManifestError(source, `${where} keys must be non-empty strings`)
    out[key] = assertServerValue(source, `${where}.${key}`, slot)
  }
  return out
}

function assertStringArray(source: string, where: string, value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new InvalidManifestError(source, `${where} must be an array of non-empty strings`)
  }
  const entries: string[] = []
  for (const entry of value) {
    if (!isNonEmptyString(entry)) {
      throw new InvalidManifestError(source, `${where} must be an array of non-empty strings`)
    }
    entries.push(entry)
  }
  return entries
}

function assertTimeout(source: string, value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new InvalidManifestError(source, 'toolCallTimeoutMs must be a positive number')
  }
  return value
}

/** Validate one server spec entry. */
function parseServer(source: string, index: number, value: unknown): ConnectorServerSpec {
  if (!isRecord(value)) throw new InvalidManifestError(source, `servers[${index}] must be a mapping`)
  const where = `servers[${index}]`
  const serverName = value.serverName
  if (!isNonEmptyString(serverName) || !SERVER_NAME.test(serverName)) {
    throw new InvalidManifestError(source, `${where}.serverName must match ${String(SERVER_NAME)}`)
  }
  if (value.transport === 'stdio') {
    const command = value.command
    if (!isNonEmptyString(command)) throw new InvalidManifestError(source, `${where}.command is required for stdio servers`)
    const stdio: Writable<ConnectorStdioServerSpec> = {
      serverName,
      transport: 'stdio',
      command,
    }
    const args = assertStringArray(source, `${where}.args`, value.args)
    if (args !== undefined) stdio.args = args
    const env = assertStringMap(source, `${where}.env`, value.env)
    if (env !== undefined) stdio.env = env
    if (isNonEmptyString(value.cwd)) stdio.cwd = value.cwd
    const timeout = assertTimeout(source, value.toolCallTimeoutMs)
    if (timeout !== undefined) stdio.toolCallTimeoutMs = timeout
    return stdio
  }
  if (value.transport === 'streamable-http') {
    const url = value.url
    if (!isNonEmptyString(url) || !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
      throw new InvalidManifestError(source, `${where}.url is required for streamable-http servers`)
    }
    const http: Writable<ConnectorStreamableHttpServerSpec> = {
      serverName,
      transport: 'streamable-http',
      url,
    }
    const headers = assertStringMap(source, `${where}.headers`, value.headers)
    if (headers !== undefined) http.headers = headers
    const timeout = assertTimeout(source, value.toolCallTimeoutMs)
    if (timeout !== undefined) http.toolCallTimeoutMs = timeout
    return http
  }
  throw new InvalidManifestError(source, `${where}.transport must be "stdio" or "streamable-http"` + (value.transport === undefined ? '' : ` (got ${JSON.stringify(value.transport)})`))
}

/** Validate one auth method entry. */
function parseAuth(source: string, index: number, value: unknown): ConnectorAuthMethod {
  const where = `auth[${index}]`
  if (!isRecord(value)) throw new InvalidManifestError(source, `${where} must be a mapping`)
  if (value.mode === 'token') {
    const rawRefs = value.credentialRefs
    if (!Array.isArray(rawRefs) || rawRefs.length === 0 || rawRefs.some(ref => !isNonEmptyString(ref))) {
      throw new InvalidManifestError(source, `${where}.credentialRefs must be a non-empty array of strings`)
    }
    const method: Writable<TokenAuthMethod> = {
      mode: 'token',
      credentialRefs: rawRefs.map(ref => assertCredentialRef(source, `${where}.credentialRefs`, ref)),
    }
    if (isNonEmptyString(value.howTo)) method.howTo = value.howTo
    return method
  }
  if (value.mode === 'oauth') {
    const serverUrl = value.serverUrl
    if (!isNonEmptyString(serverUrl) || !/^[a-z][a-z0-9+.-]*:\/\//i.test(serverUrl)) {
      throw new InvalidManifestError(source, `${where}.serverUrl is required for oauth methods`)
    }
    const method: Writable<OauthAuthMethod> = { mode: 'oauth', serverUrl }
    if (value.byoApp !== undefined) {
      if (typeof value.byoApp !== 'boolean') throw new InvalidManifestError(source, `${where}.byoApp must be a boolean`)
      method.byoApp = value.byoApp
    }
    const setupGuide = assertStringArray(source, `${where}.setupGuide`, value.setupGuide)
    if (setupGuide !== undefined) method.setupGuide = setupGuide
    if (isNonEmptyString(value.reauthHint)) method.reauthHint = value.reauthHint
    return method
  }
  if (value.mode === 'device') {
    const method: Writable<DeviceAuthMethod> = { mode: 'device' }
    if (isNonEmptyString(value.howTo)) method.howTo = value.howTo
    if (isNonEmptyString(value.loginTool)) method.loginTool = value.loginTool
    if (isNonEmptyString(value.verifyTool)) method.verifyTool = value.verifyTool
    return method
  }
  throw new InvalidManifestError(source, `${where}.mode must be "token", "oauth", or "device"` + (value.mode === undefined ? '' : ` (got ${JSON.stringify(value.mode)})`))
}

/**
 * Parse and validate one manifest document.
 * @param text - the document text.
 * @param source - the document's name, quoted in errors.
 * @param format - the document syntax; shipped manifests are YAML, customs are JSON.
 * @returns the validated manifest.
 */
export function parseConnectorManifest(text: string, source: string, format: 'yaml' | 'json' = 'yaml'): ConnectorManifest {
  let raw: unknown
  if (format === 'yaml') {
    raw = parseYaml(text)
  } else {
    try {
      raw = JSON.parse(text)
    } catch (error) {
      /* v8 ignore next -- JSON.parse only throws SyntaxError, an Error; the String(error) peer answers the catch type */
      throw new InvalidManifestError(source, `not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return validateManifest(raw, source)
}

/**
 * Validate a parsed manifest value. Every field is checked at this
 * boundary: the document is durable input, and a silently half-validated
 * manifest would surface later as a server that cannot start.
 * @param raw - the parsed document value.
 * @param source - the document's name, quoted in errors.
 * @returns the validated manifest.
 */
export function validateManifest(raw: unknown, source: string): ConnectorManifest {
  if (!isRecord(raw)) throw new InvalidManifestError(source, 'the root must be a mapping')

  const id = raw.id
  if (!isNonEmptyString(id) || !CONNECTOR_ID.test(id)) {
    throw new InvalidManifestError(source, `id must match ${String(CONNECTOR_ID)} (got ${JSON.stringify(id)})`)
  }
  const name = raw.name
  if (!isNonEmptyString(name)) throw new InvalidManifestError(source, 'name is required')
  const description = raw.description
  if (!isNonEmptyString(description)) throw new InvalidManifestError(source, 'description is required')
  const presetId = raw.presetId
  if (!isNonEmptyString(presetId) || !/^[a-z0-9][a-z0-9-]*$/.test(presetId)) {
    throw new InvalidManifestError(source, `presetId must be a lower-case id (got ${JSON.stringify(presetId)})`)
  }
  const workspaceDirName = raw.workspaceDirName
  if (!isNonEmptyString(workspaceDirName) || !CONNECTOR_ID.test(workspaceDirName)) {
    throw new InvalidManifestError(source, `workspaceDirName must match ${String(CONNECTOR_ID)}`)
  }

  const rawServers = raw.servers
  if (!Array.isArray(rawServers) || rawServers.length === 0) {
    throw new InvalidManifestError(source, 'servers must be a non-empty array')
  }
  const servers = rawServers.map((entry, index) => parseServer(source, index, entry))
  const seenNames = new Set<string>()
  for (const server of servers) {
    if (seenNames.has(server.serverName)) {
      throw new InvalidManifestError(source, `duplicate serverName "${server.serverName}"`)
    }
    seenNames.add(server.serverName)
  }

  const rawAuth = raw.auth
  if (!Array.isArray(rawAuth)) {
    throw new InvalidManifestError(source, 'auth must be an array (empty for a server that needs no credential)')
  }
  const auth = rawAuth.map((entry, index) => parseAuth(source, index, entry))
  const seenModes = new Set<string>()
  for (const method of auth) {
    if (seenModes.has(method.mode)) throw new InvalidManifestError(source, `duplicate auth mode "${method.mode}"`)
    seenModes.add(method.mode)
  }

  const manifest: Writable<ConnectorManifest> = { id, name, description, presetId, workspaceDirName, servers, auth }
  const products = assertStringArray(source, 'products', raw.products)
  if (products !== undefined) manifest.products = products
  const suggestions = assertStringArray(source, 'suggestions', raw.suggestions)
  if (suggestions !== undefined) manifest.suggestions = suggestions
  return manifest
}
