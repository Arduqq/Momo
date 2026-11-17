import { pdfjs } from './pdfSetup'

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>[\]{}|\\^`]+)/

export interface PaperMetadata {
  itemType: string
  title: string
  creators: Array<{ creatorType: string; firstName: string; lastName: string }>
  date: string
  abstractNote: string
  DOI?: string
  publicationTitle?: string
  proceedingsTitle?: string
  url?: string
}

export async function extractDoiFromPdf(data: Uint8Array): Promise<string> {
  try {
    const pdf = await pdfjs.getDocument({ data }).promise
    const pagesToScan = Math.min(3, pdf.numPages)
    for (let p = 1; p <= pagesToScan; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      const text = (content.items as any[]).map(i => i.str).join(' ')
      const m = text.match(DOI_RE)
      if (m) return m[1].replace(/[.,;]+$/, '')
    }
  } catch { /* ignore */ }
  return ''
}

export async function fetchCrossrefMetadata(doi: string): Promise<PaperMetadata | null> {
  try {
    const resp = await fetch(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=momo@research.app`,
    )
    if (!resp.ok) return null
    const { message: w } = await resp.json()
    const creators = (w.author ?? []).map((a: any) => ({
      creatorType: 'author',
      firstName: a.given ?? '',
      lastName: a.family ?? '',
    }))
    const year = w.published?.['date-parts']?.[0]?.[0]?.toString() ?? ''
    const isConf = w.type === 'proceedings-article'
    return {
      itemType: isConf ? 'conferencePaper' : 'journalArticle',
      title: (w.title?.[0] ?? '').replace(/<[^>]+>/g, ''),
      creators,
      date: year,
      abstractNote: (w.abstract ?? '').replace(/<[^>]+>/g, ''),
      DOI: doi,
      publicationTitle: isConf ? undefined : (w['container-title']?.[0] ?? ''),
      proceedingsTitle: isConf ? (w['container-title']?.[0] ?? '') : undefined,
    }
  } catch {
    return null
  }
}

export function parseArxivXml(xml: string, arxivId: string): PaperMetadata | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const entry = doc.querySelector('entry')
    if (!entry) return null
    const title = entry.querySelector('title')?.textContent?.trim().replace(/\s+/g, ' ') ?? ''
    const summary = entry.querySelector('summary')?.textContent?.trim() ?? ''
    const published = entry.querySelector('published')?.textContent?.slice(0, 4) ?? ''
    const creators = Array.from(doc.querySelectorAll('author name')).map(n => {
      const parts = (n.textContent ?? '').trim().split(/\s+/)
      const lastName = parts.pop() ?? ''
      const firstName = parts.join(' ')
      return { creatorType: 'author', firstName, lastName }
    })
    return {
      itemType: 'preprint',
      title,
      creators,
      date: published,
      abstractNote: summary,
      publicationTitle: 'arXiv',
      url: `https://arxiv.org/abs/${arxivId}`,
    }
  } catch {
    return null
  }
}

export function detectAcademicUrl(url: string): { type: 'arxiv' | 'doi' | null; id: string } {
  try {
    const u = new URL(url)
    const arxivM = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]+\.[0-9]+(?:v\d+)?)/i)
    if (arxivM) return { type: 'arxiv', id: arxivM[1].replace(/\.pdf$/, '') }
    if (u.hostname === 'doi.org' || u.hostname === 'dx.doi.org') {
      return { type: 'doi', id: u.pathname.slice(1) }
    }
    const doiM = url.match(DOI_RE)
    if (doiM) return { type: 'doi', id: doiM[1] }
  } catch { /* malformed URL */ }
  return { type: null, id: '' }
}

export function metadataToPaperProps(meta: PaperMetadata, itemKey = '') {
  const authors = meta.creators
    .filter(c => c.creatorType === 'author')
    .map(c => [c.lastName, c.firstName].filter(Boolean).join(', '))
    .filter(Boolean)
    .join('; ')
  return {
    title: meta.title,
    authors,
    year: meta.date,
    venue: meta.publicationTitle ?? meta.proceedingsTitle ?? '',
    abstract: meta.abstractNote ?? '',
    contribution: '',
    relationship: '',
    read: false,
    thumbnail: '',
    pdfKey: '',
    citeKey: '',
    itemKey,
  }
}

export function extractOgTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  if (og) return og[1]
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return title ? title[1].trim() : ''
}
