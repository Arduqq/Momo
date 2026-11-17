import { useEffect, useRef, useState } from 'react'
import { X, Globe, Loader2 } from 'lucide-react'

export interface WebCiteData {
  url: string
  title: string
  authors: string
  year: string
  venue: string
}

interface CiteWebModalProps {
  initialUrl: string
  onSubmit: (data: WebCiteData) => void
  onCancel: () => void
}

export function CiteWebModal({ initialUrl, onSubmit, onCancel }: CiteWebModalProps) {
  const [url, setUrl] = useState(initialUrl)
  const [title, setTitle] = useState('')
  const [authors, setAuthors] = useState('')
  const [year, setYear] = useState('')
  const [venue, setVenue] = useState('')
  const [fetching, setFetching] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!initialUrl) return
    setFetching(true)
    window.ipcRenderer.invoke('fetch-url', initialUrl).then((result: any) => {
      if (result?.body) {
        const og = result.body.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
        const t = result.body.match(/<title[^>]*>([^<]+)<\/title>/i)
        const found = og?.[1] || t?.[1]?.trim() || ''
        if (found && !title) setTitle(found.replace(/\s+/g, ' '))
      }
    }).catch(() => {}).finally(() => setFetching(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() && !url.trim()) return
    onSubmit({ url: url.trim(), title: title.trim(), authors: authors.trim(), year: year.trim(), venue: venue.trim() })
  }

  const input: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 7,
    border: '1px solid #d1d5db', fontSize: 13,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    outline: 'none', boxSizing: 'border-box',
    backgroundColor: '#fff', color: '#111827',
    transition: 'border-color 0.15s',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      backgroundColor: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div style={{
        backgroundColor: '#fff', borderRadius: 14,
        padding: '24px 28px', width: 420, maxWidth: '90vw',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Globe size={16} color="#6366f1" />
            <span style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>Cite web article</span>
          </div>
          <button onClick={onCancel} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#9ca3af', padding: 4, borderRadius: 6,
          }}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
              URL
              <input style={{ ...input, marginTop: 4 }} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." />
            </label>

            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
              Title{fetching && <Loader2 size={11} style={{ marginLeft: 6, animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} />}
              <input ref={titleRef} style={{ ...input, marginTop: 4 }} value={title}
                onChange={e => setTitle(e.target.value)} placeholder="Article title" />
            </label>

            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
              Authors <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span>
              <input style={{ ...input, marginTop: 4 }} value={authors}
                onChange={e => setAuthors(e.target.value)} placeholder="Last, First; Last, First" />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                Year <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span>
                <input style={{ ...input, marginTop: 4 }} value={year}
                  onChange={e => setYear(e.target.value)} placeholder="2024" maxLength={4} />
              </label>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                Publication <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span>
                <input style={{ ...input, marginTop: 4 }} value={venue}
                  onChange={e => setVenue(e.target.value)} placeholder="Nature, arXiv…" />
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCancel} style={{
              padding: '8px 18px', borderRadius: 8, border: '1px solid #d1d5db',
              background: '#fff', cursor: 'pointer', fontSize: 13, color: '#374151',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            }}>
              Cancel
            </button>
            <button type="submit" style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: '#6366f1', cursor: 'pointer', fontSize: 13,
              color: '#fff', fontWeight: 600,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            }}>
              Add to workspace
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
