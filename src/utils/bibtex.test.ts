import { describe, it, expect } from 'vitest'
import { escapeLatex, parseAuthorString, generateBibEntry, buildNoteHtml } from './bibtex'

describe('escapeLatex', () => {
  it('escapes LaTeX-special characters', () => {
    expect(escapeLatex('R&D_100 at 50% #1 $5')).toBe('R\\&D\\_100 at 50\\% \\#1 \\$5')
  })
})

describe('parseAuthorString', () => {
  it('parses "Last, First; Last, First"', () => {
    expect(parseAuthorString('Doe, Jane; Smith, John')).toEqual([
      { lastName: 'Doe', firstName: 'Jane', creatorType: 'author' },
      { lastName: 'Smith', firstName: 'John', creatorType: 'author' },
    ])
  })
  it('treats comma-only strings as last names', () => {
    expect(parseAuthorString('Doe, Smith').map(a => a.lastName)).toEqual(['Doe', 'Smith'])
  })
  it('returns [] for empty input', () => {
    expect(parseAuthorString('  ')).toEqual([])
  })
})

describe('generateBibEntry', () => {
  it('escapes titles', () => {
    const out = generateBibEntry({ data: { itemType: 'journalArticle', title: 'A & B_c', creators: [], date: '2020' } }, 'k2020')
    expect(out).toContain('{A \\& B\\_c}')
  })
})

describe('buildNoteHtml', () => {
  it('escapes HTML and keeps line breaks', () => {
    const html = buildNoteHtml('a <b>\nc', '')
    expect(html).toContain('a &lt;b&gt;<br/>c')
  })
})
