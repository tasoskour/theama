import { open } from 'node:fs/promises'

/** OpenSubtitles moviehash: file size plus uint64-LE words in the first and last 64 KiB. */
export async function movieHash(path: string): Promise<string | null> {
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    if (size < 131072) return null
    let hash = BigInt(size)
    const chunk = Buffer.alloc(65536)
    for (const position of [0, size - chunk.length]) {
      const { bytesRead } = await file.read(chunk, 0, chunk.length, position)
      if (bytesRead !== chunk.length) return null
      for (let offset = 0; offset < chunk.length; offset += 8) hash = BigInt.asUintN(64, hash + chunk.readBigUInt64LE(offset))
    }
    return hash.toString(16).padStart(16, '0')
  } finally { await file.close() }
}
