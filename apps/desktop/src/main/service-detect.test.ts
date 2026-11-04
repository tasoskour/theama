import { describe, expect, it } from 'vitest'
import { detectServices, parseProwlarrConfig, parseQBittorrentIni } from './service-detect'

describe('service detection', () => {
  it('reads the Prowlarr key and port', () => {
    const xml = '<Config><Port>9797</Port><UrlBase>/p/</UrlBase><ApiKey>abcdef0123456789</ApiKey></Config>'
    expect(parseProwlarrConfig(xml)).toEqual({ url: 'http://localhost:9797/p', apiKey: 'abcdef0123456789' })
    expect(parseProwlarrConfig('<Config></Config>')).toEqual({ url: 'http://localhost:9696', apiKey: null })
  })
  it('reads the qBittorrent Web UI settings', () => {
    const ini = '[Preferences]\r\nWebUI\\Enabled=true\r\nWebUI\\Port=8081\r\nWebUI\\Username=me\r\n'
    expect(parseQBittorrentIni(ini)).toEqual({ url: 'http://localhost:8081', username: 'me', webUiEnabled: true })
    expect(parseQBittorrentIni('[Preferences]\r\n')).toEqual({ url: 'http://localhost:8080', username: null, webUiEnabled: false })
  })
  it('reports nothing for missing files', () => {
    const found = detectServices({}, { exists: () => false, read: () => null })
    expect(found.prowlarr).toEqual({ installed: false, url: null, apiKey: null })
    expect(found.qbittorrent).toEqual({ installed: false, url: null, username: null, webUiEnabled: null })
  })
  it('combines files from the environment', () => {
    const dir = ['C:', 'ProgramData'].join(String.fromCharCode(92))
    const files: Record<string, string> = { [[dir, 'Prowlarr', 'config.xml'].join(String.fromCharCode(92))]: '<Config><ApiKey>0123456789abcdef</ApiKey></Config>' }
    const found = detectServices({ ProgramData: dir }, { exists: () => false, read: (p) => files[p] ?? null })
    expect(found.prowlarr).toEqual({ installed: true, url: 'http://localhost:9696', apiKey: '0123456789abcdef' })
  })
})
