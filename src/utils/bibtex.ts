const TYPE_MAP: Record<string, string> = {
  journalArticle:  'article',
  conferencePaper: 'inproceedings',
  book:            'book',
  bookSection:     'incollection',
  thesis:          'phdthesis',
  report:          'techreport',
  preprint:        'misc',
  manuscript:      'unpublished',
  webpage:         'misc',
  attachment:      'misc',
}

function bibType(itemType: string) {
  return TYPE_MAP[itemType] ?? 'misc'
}

function formatAuthors(creators: any[]): string {
  return (creators ?? [])
    .filter((c: any) => !c.creatorType || c.creatorType === 'author')
    .map((c: any) => {
      if (c.name) return c.name
      return [c.lastName, c.firstName].filter(Boolean).join(', ')
    })
    .filter(Boolean)
    .join(' and ')
}

// Escape characters that are special in LaTeX so titles like "R&D_100 50%" compile.
export function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, ' ')
    .replace(/([&%$#_])/g, '\\$1')
}

// Wrap in braces to protect capitalisation; strip any existing braces first.
function b(s: string) { return `{${escapeLatex(s.replace(/[{}]/g, ''))}}` }

// Parse the free-text author string stored on canvas cards into creators.
//  - "Last, First; Last, First"  (cite-web modal, DOI/arXiv drops)
//  - "Last, Last, Last"          (sidebar drags: last names only)
export function parseAuthorString(authors: string): Array<{ lastName: string; firstName?: string; creatorType: string }> {
  const text = (authors ?? '').trim()
  if (!text) return []
  if (text.includes(';')) {
    return text.split(';').map(p => p.trim()).filter(Boolean).map(p => {
      const [last, ...rest] = p.split(',')
      return { lastName: last.trim(), firstName: rest.join(',').trim() || undefined, creatorType: 'author' }
    })
  }
  return text.split(',').map(p => p.trim()).filter(Boolean).map(p => ({ lastName: p, creatorType: 'author' }))
}

function pages(p?: string) {
  return p ? p.replace(/\u2013|\u2014|-(?!-)/g, '--') : ''
}

function field(key: string, value: string): [string, string] {
  return [key, value]
}

export function generateBibEntry(item: any, citeKey: string): string {
  const d  = item.data
  const type = bibType(d.itemType)
  const f: [string, string][] = []

  const authors = formatAuthors(d.creators)
  if (authors)      f.push(field('author',  b(authors)))
  if (d.title)      f.push(field('title',   b(d.title)))

  const year = (d.date ?? '').match(/\d{4}/)?.[0]
  if (year)         f.push(field('year', year))

  if (type === 'article') {
    if (d.publicationTitle) f.push(field('journal',  b(d.publicationTitle)))
    if (d.volume)           f.push(field('volume',   d.volume))
    if (d.issue)            f.push(field('number',   d.issue))
    const p = pages(d.pages)
    if (p)                  f.push(field('pages',    p))

  } else if (type === 'inproceedings') {
    const bt = d.proceedingsTitle || d.conferenceName
    if (bt)           f.push(field('booktitle', b(bt)))
    if (d.publisher)  f.push(field('publisher', b(d.publisher)))
    if (d.place)      f.push(field('address',   b(d.place)))
    const p = pages(d.pages)
    if (p)            f.push(field('pages', p))

  } else if (type === 'book') {
    if (d.publisher) f.push(field('publisher', b(d.publisher)))
    if (d.place)     f.push(field('address',   b(d.place)))
    if (d.edition)   f.push(field('edition',   d.edition))
    if (d.isbn)      f.push(field('isbn',      d.isbn))

  } else if (type === 'incollection') {
    if (d.bookTitle)  f.push(field('booktitle', b(d.bookTitle)))
    if (d.publisher)  f.push(field('publisher', b(d.publisher)))
    if (d.place)      f.push(field('address',   b(d.place)))
    const p = pages(d.pages)
    if (p)            f.push(field('pages', p))

  } else if (type === 'phdthesis' || type === 'mastersthesis') {
    if (d.university) f.push(field('school',  b(d.university)))
    if (d.place)      f.push(field('address', b(d.place)))
    if (d.thesisType) f.push(field('type',    b(d.thesisType)))

  } else if (type === 'techreport') {
    const inst = d.institution || d.publisher
    if (inst)               f.push(field('institution', b(inst)))
    if (d.reportNumber)     f.push(field('number',      d.reportNumber))

  } else {
    // misc — preprints, arXiv, webpages, etc.
    const hw = [d.repository, d.archiveID].filter(Boolean).join(' ')
    if (hw)          f.push(field('howpublished', b(hw)))
    else if (d.url)  f.push(field('howpublished', `\\url{${d.url}}`))
    if (d.publisher) f.push(field('publisher', b(d.publisher)))
  }

  if (d.DOI)              f.push(field('doi',      d.DOI))
  if (d.url && !d.DOI)   f.push(field('url',      d.url))
  if (d.abstractNote)     f.push(field('abstract', b(d.abstractNote)))

  const keyWidth = Math.max(...f.map(([k]) => k.length))
  const body = f.map(([k, v]) => `  ${k.padEnd(keyWidth)} = ${v}`).join(',\n')
  return `@${type}{${citeKey},\n${body}\n}`
}

// Build a citekey from item data; ensures uniqueness within the export.
export function makeCiteKey(item: any, used: Set<string>): string {
  const first = (item.data.creators ?? []).find(
    (c: any) => !c.creatorType || c.creatorType === 'author'
  )
  const last = (first?.lastName || first?.name?.split(' ').pop() || 'Unknown')
    .replace(/[^a-zA-Z]/g, '')
  const year = (item.data.date ?? '').match(/\d{4}/)?.[0] ?? ''
  let base = `${last}${year}`
  if (!used.has(base)) { used.add(base); return base }
  for (let i = 97; i <= 122; i++) {
    const k = base + String.fromCharCode(i)
    if (!used.has(k)) { used.add(k); return k }
  }
  return base
}

function htmlEscape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
}

// HTML body for the Momo-managed Zotero child note.
export function buildNoteHtml(contribution: string, relationship: string): string {
  return '<h1>Momo notes</h1>' +
    `<h2>What is their contribution?</h2><p>${htmlEscape(contribution.trim()) || '<em>—</em>'}</p>` +
    `<h2>How is it relevant?</h2><p>${htmlEscape(relationship.trim()) || '<em>—</em>'}</p>` +
    '<p><em>Synced from Momo — edits made here are overwritten by the next sync.</em></p>'
}

export function assembleBibFile(entries: string[], workspaceName: string): string {
  const date = new Date().toISOString().slice(0, 10)
  return `% ${workspaceName} — exported from Momo on ${date}\n\n` +
    entries.join('\n\n') + '\n'
}
