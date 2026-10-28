// Child process that extracts Item 1 from 10-K HTML files. Reads one JSON
// request per stdin line ({ id, path }) and writes one JSON reply per line.
// jsdom leaks memory across documents, so the parent recycles this process.
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { JSDOM } from 'jsdom'
import { findItem1 } from '../../src/lib/extract.ts'

for await (const line of createInterface({ input: process.stdin })) {
  const { id, path } = JSON.parse(line) as { id: number; path: string }
  try {
    const dom = new JSDOM(readFileSync(path, 'utf8'))
    const section = findItem1(dom.window.document)
    dom.window.close()
    process.stdout.write(JSON.stringify({ id, section }) + '\n')
  } catch (e) {
    process.stdout.write(JSON.stringify({ id, error: (e as Error).message }) + '\n')
  }
}
