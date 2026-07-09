// WebDAV 备份客户端 - 用于上传/下载/浏览备份文件

import type { BackupDavConfig } from './backup/config'

function getBasicAuth(str: string): string {
  try {
    return (globalThis as any).btoa(str)
  } catch {
    return ''
  }
}

function getAuthHeader(config: BackupDavConfig): Record<string, string> {
  if (config.username && config.password) {
    try {
      const basic = getBasicAuth(`${config.username}:${config.password}`)
      return { 'Authorization': `Basic ${basic}` }
    } catch {
      return {}
    }
  }
  return {}
}

export interface DavItem {
  filename: string
  basename: string
  lastmod: string
  size: number
  type: 'directory' | 'file'
}

function extractTag(xml: string, tag: string): string {
  let searchStr = xml.toLowerCase()
  let lowerTag = tag.toLowerCase()
  let openIdx = searchStr.indexOf(`<${lowerTag}`)
  if (openIdx === -1) {
    openIdx = searchStr.indexOf(`:${lowerTag}`)
    if (openIdx !== -1) {
      const pre = searchStr.lastIndexOf('<', openIdx)
      if (pre !== -1) {
        openIdx = pre
      } else {
        openIdx = -1
      }
    }
  }
  if (openIdx === -1) return ''
  const closeBracketIdx = searchStr.indexOf(`>`, openIdx)
  if (closeBracketIdx === -1) return ''
  const tagContent = searchStr.substring(openIdx + 1, closeBracketIdx)
  const prefix = tagContent.split(' ')[0]
  const closingTag = `</${prefix}>`
  const closeIdx = searchStr.indexOf(closingTag, closeBracketIdx + 1)
  if (closeIdx !== -1) {
    return xml.substring(closeBracketIdx + 1, closeIdx)
  }
  return ''
}

function extractAllTags(xml: string, tag: string): string[] {
  const results: string[] = []
  let searchStr = xml.toLowerCase()
  let lowerTag = tag.toLowerCase()
  let currentIndex = 0
  while (true) {
    const openIdx = searchStr.indexOf(`<`, currentIndex)
    if (openIdx === -1) break
    const closeBracketIdx = searchStr.indexOf(`>`, openIdx)
    if (closeBracketIdx === -1) break
    const tagContent = searchStr.substring(openIdx + 1, closeBracketIdx)
    if (tagContent === lowerTag || tagContent.endsWith(`:${lowerTag}`) || tagContent.startsWith(`${lowerTag} `) || tagContent.includes(`:${lowerTag} `)) {
      const prefix = tagContent.split(' ')[0]
      const closingTag = `</${prefix}>`
      const closeIdx = searchStr.indexOf(closingTag, closeBracketIdx + 1)
      if (closeIdx !== -1) {
        results.push(xml.substring(closeBracketIdx + 1, closeIdx))
        currentIndex = closeIdx + closingTag.length
      } else {
        currentIndex = closeBracketIdx + 1
      }
    } else {
      currentIndex = closeBracketIdx + 1
    }
  }
  return results
}

function decodeXmlEntities(str: string): string {
  return str.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g,
    (match: string, dec: string, hex: string, name: string) => {
      if (dec) return String.fromCharCode(parseInt(dec, 10))
      if (hex) return String.fromCharCode(parseInt(hex, 16))
      switch (name) {
        case 'amp': return '&'
        case 'lt': return '<'
        case 'gt': return '>'
        case 'quot': return '"'
        case 'apos': return "'"
        default: return match
      }
    }
  )
}

/** 测试 WebDAV 连接 */
export async function testConnection(config: BackupDavConfig): Promise<boolean> {
  const baseUrl = config.url.replace(/\/$/, '')
  const reqUrl = baseUrl + '/'
  const headers = getAuthHeader(config)

  const response = await fetch(reqUrl, {
    method: 'PROPFIND',
    headers: { ...headers, 'Depth': '0' }
  })
  return response.ok
}

/** 列出目录内容 */
export async function listDirectory(config: BackupDavConfig, path: string): Promise<DavItem[]> {
  const baseUrl = config.url.replace(/\/$/, '')
  const normalizedPath = path === '/' ? '' : path.replace(/\/$/, '')
  const fullPath = normalizedPath ? baseUrl + '/' + normalizedPath : baseUrl
  const headers = getAuthHeader(config)

  const response = await fetch(fullPath, {
    method: 'PROPFIND',
    headers: { ...headers, 'Depth': '1' }
  })

  if (!response.ok) {
    throw new Error(`PROPFIND failed: ${response.status} ${response.statusText}`)
  }

  const xmlText = await response.text()
  const responses = extractAllTags(xmlText, 'response')

  return responses.map((r: string) => {
    const href = decodeXmlEntities(extractTag(r, 'href'))
    const decodedHref = decodeURIComponent(href)
    let basename = decodedHref.split('/').filter(Boolean).pop() || ''

    const propstat = extractTag(r, 'propstat')
    const prop = extractTag(propstat, 'prop')
    const resourcetype = extractTag(prop, 'resourcetype')
    const isCollection = /<([^:>]+:)?collection/i.test(resourcetype)

    const lastmod = decodeXmlEntities(extractTag(prop, 'getlastmodified'))
    const contentLength = extractTag(prop, 'getcontentlength')

    return {
      filename: decodedHref,
      basename,
      lastmod: lastmod || '',
      size: parseInt(contentLength || '0', 10),
      type: isCollection ? 'directory' : 'file'
    }
  })
}

/** 上传备份文件到 WebDAV */
export async function uploadBackup(config: BackupDavConfig, filePath: string, content: string): Promise<void> {
  const baseUrl = config.url.replace(/\/$/, '')
  const normalizedPath = filePath.startsWith('/') ? filePath.substring(1) : filePath
  const fullPath = baseUrl + '/' + normalizedPath
  const headers = getAuthHeader(config)

  const response = await fetch(fullPath, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: content
  })

  if (!response.ok) {
    throw new Error(`PUT failed: ${response.status} ${response.statusText}`)
  }
}

/** 从 WebDAV 下载备份文件 */
export async function downloadBackup(config: BackupDavConfig, filePath: string): Promise<string> {
  const baseUrl = config.url.replace(/\/$/, '')
  const normalizedPath = filePath.startsWith('/') ? filePath.substring(1) : filePath
  const fullPath = baseUrl + '/' + normalizedPath
  const headers = getAuthHeader(config)

  const response = await fetch(fullPath, {
    method: 'GET',
    headers: headers
  })

  if (!response.ok) {
    throw new Error(`GET failed: ${response.status} ${response.statusText}`)
  }

  return await response.text()
}
