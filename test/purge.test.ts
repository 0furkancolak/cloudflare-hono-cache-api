import { describe, expect, it } from 'bun:test'
import { buildPurgeRequest } from '../src/cache/purge'

describe('buildPurgeRequest', () => {
  it('deduplicates files and tags', () => {
    const result = buildPurgeRequest({
      files: ['https://example.test/a', 'https://example.test/a'],
      tags: ['products', 'products', 'tenant:1'],
    })

    expect(result.files).toEqual(['https://example.test/a'])
    expect(result.tags).toEqual(['products', 'tenant:1'])
  })
})
