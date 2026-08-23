import { describe, expect, it } from 'vitest'
import { parseConnectorManifest, validateManifest, InvalidManifestError } from '../src/manifest.ts'

const SOURCE = '/tmp/notion.yml'

function notionYaml(): string {
  return [
    'id: notion',
    'name: Notion',
    'description: Read and write Notion.',
    'presetId: notion',
    'workspaceDirName: notion',
    'auth:',
    '  - mode: token',
    '    credentialRefs:',
    '      - NOTION_API_TOKEN',
    '    howTo: Create an internal integration.',
    'servers:',
    '  - serverName: notion',
    '    transport: stdio',
    '    command: npx',
    '    args:',
    '      - -y',
    "      - '@notionhq/notion-mcp-server'",
    '    env:',
    '      NOTION_API_KEY: { $cred: NOTION_API_TOKEN }',
    'suggestions:',
    '  - Summarize my workspace',
    '',
  ].join('\n')
}

describe('parseConnectorManifest', () => {
  it('parses a valid YAML manifest', () => {
    const manifest = parseConnectorManifest(notionYaml(), SOURCE)
    expect(manifest.id).toBe('notion')
    expect(manifest.presetId).toBe('notion')
    expect(manifest.servers).toHaveLength(1)
    expect(manifest.servers[0]).toMatchObject({
      serverName: 'notion',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: { NOTION_API_KEY: { $cred: 'NOTION_API_TOKEN' } },
    })
    expect(manifest.auth).toEqual([
      { mode: 'token', credentialRefs: ['NOTION_API_TOKEN'], howTo: 'Create an internal integration.' },
    ])
    expect(manifest.suggestions).toEqual(['Summarize my workspace'])
  })

  it('parses a streamable-http manifest with placeholder headers', () => {
    const yaml = [
      'id: google',
      'name: Google Workspace',
      'description: Gmail and Drive.',
      'presetId: google',
      'workspaceDirName: google',
      'products:',
      '  - gmail',
      '  - drive',
      'auth:',
      '  - mode: oauth',
      '    serverUrl: https://gmailmcp.googleapis.com/mcp/v1',
      '    byoApp: true',
      '    reauthHint: Personal accounts re-authenticate every 7 days.',
      'servers:',
      '  - serverName: google-gmail',
      '    transport: streamable-http',
      '    url: https://gmailmcp.googleapis.com/mcp/v1',
      '',
    ].join('\n')
    const manifest = parseConnectorManifest(yaml, SOURCE)
    expect(manifest.servers[0]).toMatchObject({
      serverName: 'google-gmail',
      transport: 'streamable-http',
      url: 'https://gmailmcp.googleapis.com/mcp/v1',
    })
    expect(manifest.auth).toEqual([
      {
        mode: 'oauth',
        serverUrl: 'https://gmailmcp.googleapis.com/mcp/v1',
        byoApp: true,
        reauthHint: 'Personal accounts re-authenticate every 7 days.',
      },
    ])
    expect(manifest.products).toEqual(['gmail', 'drive'])
  })

  it('parses a device manifest', () => {
    const yaml = [
      'id: m365',
      'name: Microsoft 365',
      'description: Outlook, OneDrive, and Teams.',
      'presetId: m365',
      'workspaceDirName: m365',
      'auth:',
      '  - mode: device',
      '    howTo: Sign in with your work account.',
      '    loginTool: login',
      '    verifyTool: verify-login',
      'servers:',
      '  - serverName: m365',
      '    transport: stdio',
      '    command: npx',
    ].join('\n')
    const manifest = parseConnectorManifest(yaml, SOURCE)
    expect(manifest.auth).toEqual([
      { mode: 'device', howTo: 'Sign in with your work account.', loginTool: 'login', verifyTool: 'verify-login' },
    ])
  })

  it('parses a JSON custom manifest', () => {
    const json = JSON.stringify({
      id: 'custom-local',
      name: 'Local',
      description: 'A local server.',
      presetId: 'custom-local',
      workspaceDirName: 'local',
      servers: [{ serverName: 'custom-local', transport: 'streamable-http', url: 'http://127.0.0.1:9999/mcp' }],
      auth: [],
    })
    const manifest = parseConnectorManifest(json, '/tmp/custom-local.json', 'json')
    expect(manifest.id).toBe('custom-local')
    expect(manifest.auth).toEqual([])
  })

  it('accepts any catalog-shaped id: the custom prefix is a loader-level filter, not a validator rule', () => {
    expect(() => validateManifest({
      id: 'not-custom',
      name: 'X',
      description: 'X',
      presetId: 'not-custom',
      workspaceDirName: 'x',
      servers: [{ serverName: 'x', transport: 'streamable-http', url: 'http://127.0.0.1/mcp' }],
      auth: [],
    }, SOURCE)).not.toThrow()
  })
})

// Raw manifest input is deliberately loose: the validator owns its shape, so
// drafts stay index-typed; the suites mutate these fields through the index.
type ServerDraft = Record<string, unknown>
type MutableRaw = {
  id: string
  name: string
  description: string
  presetId: string
  workspaceDirName: string
  servers: ServerDraft[]
  auth: ServerDraft[]
}

function raw(): MutableRaw {
  return {
    id: 'srv',
    name: 'S',
    description: 'S',
    presetId: 'srv',
    workspaceDirName: 'srv',
    servers: [{ serverName: 'srv', transport: 'stdio', command: 'npx' }],
    auth: [],
  }
}

describe('validateManifest rejections', () => {
  function validRaw(): MutableRaw {
    return {
      id: 'notion',
      name: 'Notion',
      description: 'Read and write Notion.',
      presetId: 'notion',
      workspaceDirName: 'notion',
      servers: [{ serverName: 'notion', transport: 'stdio', command: 'npx', env: { KEY: { $cred: 'NOTION_API_TOKEN' } } }],
      auth: [{ mode: 'token', credentialRefs: ['NOTION_API_TOKEN'] }],
    }
  }

  it('rejects a non-object root', () => {
    expect(() => validateManifest(['notion'], SOURCE)).toThrow(InvalidManifestError)
  })

  it('rejects an id outside the id shape', () => {
    expect(() => validateManifest({ ...validRaw(), id: 'Bad Id' }, SOURCE)).toThrow(/id must match/)
  })

  it('rejects a missing name', () => {
    const raw = validRaw()
    delete (raw as Record<string, unknown>).name
    expect(() => validateManifest(raw, SOURCE)).toThrow(/name is required/)
  })

  it('rejects an empty description', () => {
    expect(() => validateManifest({ ...validRaw(), description: '' }, SOURCE)).toThrow(/description is required/)
  })

  it('rejects a presetId that is not a lower-case id', () => {
    expect(() => validateManifest({ ...validRaw(), presetId: 'Notion!' }, SOURCE)).toThrow(/presetId/)
  })

  it('rejects an empty servers list', () => {
    expect(() => validateManifest({ ...validRaw(), servers: [] }, SOURCE)).toThrow(/servers must be a non-empty array/)
  })

  it('rejects a serverName outside the server shape', () => {
    const raw = validRaw()
    raw.servers[0]!.serverName = 'too-many-chars-that-will-exceed-the-thirty-two-character-limit-for-sure'
    expect(() => validateManifest(raw, SOURCE)).toThrow(/serverName/)
  })

  it('rejects a stdio server without a command', () => {
    const raw = validRaw()
    delete raw.servers[0]!.command
    expect(() => validateManifest(raw, SOURCE)).toThrow(/command is required/)
  })

  it('rejects a streamable-http server without a url', () => {
    expect(() => validateManifest({
      ...validRaw(),
      servers: [{ serverName: 'http', transport: 'streamable-http' }],
    }, SOURCE)).toThrow(/url is required/)
  })

  it('rejects an unknown transport', () => {
    const raw = validRaw()
    raw.servers[0]!.transport = 'sse'
    expect(() => validateManifest(raw, SOURCE)).toThrow(/transport must be/)
  })

  it('rejects a duplicate serverName', () => {
    const raw = validRaw()
    raw.servers.push({ ...raw.servers[0]! })
    expect(() => validateManifest(raw, SOURCE)).toThrow(/duplicate serverName/)
  })

  it('rejects an env value that is neither string nor placeholder', () => {
    const raw = validRaw()
    const env = raw.servers[0]!.env as Record<string, unknown>
    env.KEY = 42
    expect(() => validateManifest(raw, SOURCE)).toThrow(/must be a non-empty string or a/)
  })

  it('rejects a placeholder with an unknown key', () => {
    const raw = validRaw()
    const env = raw.servers[0]!.env as Record<string, unknown>
    env.KEY = { $secret: 'NOPE' }
    expect(() => validateManifest(raw, SOURCE)).toThrow(/must be a non-empty string or a/)
  })

  it('rejects a $cred placeholder with an empty reference', () => {
    const raw = validRaw()
    const env = raw.servers[0]!.env as Record<string, unknown>
    env.KEY = { $cred: '' }
    expect(() => validateManifest(raw, SOURCE)).toThrow(/must be a non-empty string or a/)
  })

  it('rejects a negative toolCallTimeoutMs', () => {
    const raw = validRaw()
    raw.servers[0]!.toolCallTimeoutMs = -5
    expect(() => validateManifest(raw, SOURCE)).toThrow(/positive number/)
  })

  it('rejects a missing auth list', () => {
    const raw = validRaw()
    delete (raw as Record<string, unknown>).auth
    expect(() => validateManifest(raw, SOURCE)).toThrow(/auth must be an array/)
  })

  it('rejects an unknown auth mode', () => {
    const raw = validRaw()
    raw.auth = [{ mode: 'magic' }]
    expect(() => validateManifest(raw, SOURCE)).toThrow(/mode must be/)
  })

  it('rejects a token method without credentialRefs', () => {
    const raw = validRaw()
    raw.auth = [{ mode: 'token' }]
    expect(() => validateManifest(raw, SOURCE)).toThrow(/credentialRefs/)
  })

  it('rejects a credentialRef that is not a POSIX identifier', () => {
    const raw = validRaw()
    raw.auth = [{ mode: 'token', credentialRefs: ['not an id'] }]
    expect(() => validateManifest(raw, SOURCE)).toThrow(/POSIX identifier/)
  })

  it('rejects a duplicate auth mode', () => {
    const raw = validRaw()
    raw.auth = [{ mode: 'token', credentialRefs: ['A'] }, { mode: 'token', credentialRefs: ['B'] }]
    expect(() => validateManifest(raw, SOURCE)).toThrow(/duplicate auth mode/)
  })

  it('rejects an oauth method without a serverUrl', () => {
    const raw = validRaw()
    raw.auth = [{ mode: 'oauth' }]
    expect(() => validateManifest(raw, SOURCE)).toThrow(/serverUrl is required/)
  })

  it('rejects a non-boolean byoApp', () => {
    const raw = validRaw()
    raw.auth = [{ mode: 'oauth', serverUrl: 'https://example.com/mcp', byoApp: 'yes' }]
    expect(() => validateManifest(raw, SOURCE)).toThrow(/byoApp must be a boolean/)
  })

  it('rejects a suggestions entry that is not a string', () => {
    expect(() => validateManifest({ ...validRaw(), suggestions: ['ok', 42] }, SOURCE)).toThrow(/suggestions/)
  })

  it('rejects a suggestions field that is not an array', () => {
    expect(() => validateManifest({ ...validRaw(), suggestions: 'not-a-list' }, SOURCE)).toThrow(
      /suggestions must be an array of non-empty strings/,
    )
  })

  it('rejects a malformed JSON document with the parse error', () => {
    expect(() => parseConnectorManifest('{oops', SOURCE, 'json')).toThrow(/not valid JSON/)
  })

  it('names the source in every error', () => {
    const broken = validRaw()
    delete (broken as Record<string, unknown>).name
    try {
      validateManifest(broken, '/tmp/custom/thing.yml')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidManifestError)
      expect((error as Error).message).toContain('/tmp/custom/thing.yml')
    }
  })
})

describe('validateManifest accepted variants', () => {
  it('accepts a literal string server value', () => {
    const r = raw()
    r.servers[0]!.env = { KEY: 'plain' }
    const m = validateManifest(r, SOURCE)
    expect(m.servers[0]).toMatchObject({ env: { KEY: 'plain' } })
  })

  it('accepts a stdio server with cwd and a valid timeout', () => {
    const r = raw()
    r.servers[0]!.cwd = '/tmp/work'
    r.servers[0]!.toolCallTimeoutMs = 1200
    const m = validateManifest(r, SOURCE)
    const stdio = m.servers[0]
    if (stdio === undefined || stdio.transport !== 'stdio') throw new Error('expected stdio')
    expect(stdio.cwd).toBe('/tmp/work')
    expect(stdio.toolCallTimeoutMs).toBe(1200)
  })

  it('accepts a streamable-http server with headers and a valid timeout', () => {
    const r = raw()
    r.servers = [{ serverName: 'srv', transport: 'streamable-http', url: 'http://x/mcp', headers: { A: 'b' }, toolCallTimeoutMs: 300 }]
    const m = validateManifest(r, SOURCE)
    const http = m.servers[0]
    if (http === undefined || http.transport !== 'streamable-http') throw new Error('expected http')
    expect(http.headers).toEqual({ A: 'b' })
    expect(http.toolCallTimeoutMs).toBe(300)
  })

  it('accepts a bare stdio server with no args or env', () => {
    const m = validateManifest(raw(), SOURCE)
    const stdio = m.servers[0]
    if (stdio === undefined || stdio.transport !== 'stdio') throw new Error('expected stdio')
    expect(stdio.args).toBeUndefined()
    expect(stdio.env).toBeUndefined()
  })

  it('accepts an oauth method without byoApp and with a setup guide', () => {
    const r = raw()
    r.auth = [{ mode: 'oauth', serverUrl: 'https://x/mcp', setupGuide: ['step one'] }]
    const m = validateManifest(r, SOURCE)
    expect(m.auth).toEqual([{ mode: 'oauth', serverUrl: 'https://x/mcp', setupGuide: ['step one'] }])
  })

  it('accepts a bare device method without hints or tools', () => {
    const r = raw()
    r.auth = [{ mode: 'device' }]
    const m = validateManifest(r, SOURCE)
    expect(m.auth).toEqual([{ mode: 'device' }])
  })
})

describe('validateManifest slot rejections', () => {
  it('rejects a placeholder with two keys', () => {
    const r = raw()
    r.servers[0]!.env = { KEY: { $cred: 'A', $override: 'url' } }
    expect(() => validateManifest(r, SOURCE)).toThrow(/must be a non-empty string or a/)
  })

  it('rejects an env that is not a mapping', () => {
    const r = raw()
    r.servers[0]!.env = 'nope'
    expect(() => validateManifest(r, SOURCE)).toThrow(/must be a mapping/)
  })

  it('rejects an env with an empty key', () => {
    const r = raw()
    r.servers[0]!.env = { '': 'v' }
    expect(() => validateManifest(r, SOURCE)).toThrow(/keys must be non-empty strings/)
  })

  it('rejects a server entry that is not a mapping', () => {
    const r = raw()
    r.servers = [42 as unknown as ServerDraft]
    expect(() => validateManifest(r, SOURCE)).toThrow(/servers\[0\] must be a mapping/)
  })

  it('names the unknown transport without a value when it is absent', () => {
    const r = raw()
    delete r.servers[0]!.transport
    expect(() => validateManifest(r, SOURCE)).toThrow(new RegExp('transport must be "stdio" or "streamable-http"$'))
  })

  it('rejects an auth entry that is not a mapping', () => {
    const r = raw()
    r.auth = [42 as unknown as ServerDraft]
    expect(() => validateManifest(r, SOURCE)).toThrow(/auth\[0\] must be a mapping/)
  })

  it('names the unknown auth mode without a value when it is absent', () => {
    const r = raw()
    r.auth = [{}]
    expect(() => validateManifest(r, SOURCE)).toThrow(new RegExp('mode must be "token", "oauth", or "device"$'))
  })

  it('rejects a workspaceDirName outside the id shape', () => {
    const r = raw()
    r.workspaceDirName = 'Bad Name'
    expect(() => validateManifest(r, SOURCE)).toThrow(/workspaceDirName must match/)
  })
})
