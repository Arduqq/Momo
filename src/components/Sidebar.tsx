import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ZoteroClient, extractCiteKey } from '../api/zotero';
import type { ZoteroItem, ZoteroSort } from '../api/zotero';
import { Search, Loader2, Book, EyeOff, RotateCcw, ChevronDown, ChevronUp, ExternalLink, FileX, FolderOpen } from 'lucide-react';

const PAGE_SIZE = 25;

interface HiddenItem {
  key: string; title: string; authors: string; year: string; venue: string; abstract: string;
}

interface SidebarProps {
  userId: string;
  apiKey: string;
  workspaceId: string | null;
  placedItemKeys: Set<string>;
}

function extractYear(date?: string): string {
  if (!date) return '';
  const m = date.match(/\d{4}/);
  return m ? m[0] : '';
}

function extractVenue(item: ZoteroItem): string {
  return item.data.publicationTitle || item.data.proceedingsTitle || item.data.publisher || '';
}

const SORT_LABELS: { value: ZoteroSort; label: string }[] = [
  { value: 'dateModified', label: 'Recent' },
  { value: 'date', label: 'Year' },
  { value: 'title', label: 'Title' },
];

export const Sidebar: React.FC<SidebarProps> = ({ userId, apiKey, workspaceId, placedItemKeys }) => {
  const [items, setItems] = useState<ZoteroItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [hiddenItems, setHiddenItems] = useState<HiddenItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ZoteroSort>('dateModified');
  const [view, setView] = useState<'library' | 'hidden'>('library');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const startRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const client = useMemo(() => new ZoteroClient(userId, apiKey), [userId, apiKey]);

  const checkPdf = useCallback(async (item: ZoteroItem): Promise<{ attachmentKey: string; exists: boolean }> => {
    try {
      // Standalone PDF attachment: the item itself IS the PDF
      if (item.data.itemType === 'attachment' && item.data.contentType === 'application/pdf') {
        const { exists } = await window.ipcRenderer.invoke('check-pdf-exists', item.key) as { exists: boolean };
        return { attachmentKey: item.key, exists };
      }
      const attachmentKey = await client.getPdfAttachmentKey(item.key);
      if (!attachmentKey) return { attachmentKey: '', exists: false };
      const { exists } = await window.ipcRenderer.invoke('check-pdf-exists', attachmentKey) as { exists: boolean };
      return { attachmentKey, exists };
    } catch {
      return { attachmentKey: '', exists: false };
    }
  }, [client]);

  // Load hidden items when workspace changes
  useEffect(() => {
    if (!workspaceId) { setHiddenItems([]); return; }
    window.ipcRenderer.invoke('get-hidden-items', workspaceId).then((h: HiddenItem[]) => {
      setHiddenItems(h || []);
    });
    setExpandedKey(null);
  }, [workspaceId]);

  // Initial fetch / reset when query, sort, or credentials change
  useEffect(() => {
    if (!userId || !apiKey) return;
    startRef.current = 0;
    setItems([]);
    setHasMore(false);
    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const { items: newItems, total } = await client.fetchItems(query, 0, sort, PAGE_SIZE);
        if (!cancelled) {
          setItems(newItems);
          startRef.current = newItems.length;
          setHasMore(newItems.length < total);
        }
      } catch {
        // error already logged in client
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);

    return () => { cancelled = true; clearTimeout(timer); setLoading(false); };
  }, [query, sort, userId, apiKey, client]);

  // Load next page
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !userId || !apiKey) return;
    setLoadingMore(true);
    try {
      const { items: newItems, total } = await client.fetchItems(query, startRef.current, sort, PAGE_SIZE);
      setItems(prev => [...prev, ...newItems]);
      startRef.current += newItems.length;
      setHasMore(startRef.current < total);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, query, sort, userId, apiKey, client]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: '120px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const hiddenKeySet = useMemo(() => new Set(hiddenItems.map(h => h.key)), [hiddenItems]);
  const visibleItems = useMemo(() =>
    items.filter(item => !hiddenKeySet.has(item.key) && !placedItemKeys.has(item.key)),
    [items, hiddenKeySet, placedItemKeys]
  );

  const hideItem = async (item: ZoteroItem) => {
    if (!workspaceId) return;
    const h: HiddenItem = {
      key: item.key,
      title: item.data.title ?? '',
      authors: item.data.creators?.map(c => c.lastName || c.name).filter(Boolean).join(', ') || '',
      year: extractYear(item.data.date),
      venue: extractVenue(item),
      abstract: item.data.abstractNote || '',
    };
    await window.ipcRenderer.invoke('add-hidden-item', workspaceId, h);
    setHiddenItems(prev => [...prev, h]);
    setExpandedKey(null);
  };

  const restoreItem = async (key: string) => {
    if (!workspaceId) return;
    await window.ipcRenderer.invoke('remove-hidden-item', workspaceId, key);
    setHiddenItems(prev => prev.filter(h => h.key !== key));
    setExpandedKey(null);
  };

  const onDragStart = (e: React.DragEvent, item: ZoteroItem) => {
    const isStandaloneAttachment = item.data.itemType === 'attachment' && item.data.contentType === 'application/pdf';
    const authors = item.data.creators?.map(c => c.lastName || c.name).filter(Boolean).join(', ') || '';
    const displayTitle = item.data.title?.trim() || item.data.filename || '';
    const dragData = {
      type: 'paper-card',
      props: {
        title: displayTitle,
        authors,
        year: extractYear(item.data.date),
        venue: extractVenue(item),
        contribution: '', relationship: '',
        abstract: item.data.abstractNote || '',
        // For standalone attachments the item key IS the pdf key
        itemKey: isStandaloneAttachment ? '' : item.key,
        pdfKey: isStandaloneAttachment ? item.key : '',
        thumbnail: '', read: false,
        citeKey: extractCiteKey(item.data.extra),
      }
    };
    e.dataTransfer.setData('application/momo-paper', JSON.stringify(dragData));
  };

  return (
    <div style={{
      width: 300, height: '100vh', borderRight: '1px solid #eee',
      display: 'flex', flexDirection: 'column', backgroundColor: '#f9f9f9', zIndex: 10, flexShrink: 0,
    }}>
      {/* Header — paddingTop clears macOS traffic-light buttons */}
      <div style={{ padding: '52px 14px 0', borderBottom: '1px solid #eee', display: 'flex', flexDirection: 'column', gap: 8, WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#111', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>Zotero Library</span>

        {/* Library / Hidden tabs */}
        <div style={{ display: 'flex', backgroundColor: '#f3f4f6', borderRadius: 7, padding: 2, gap: 2, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {(['library', 'hidden'] as const).map(v => (
            <button key={v} onClick={() => { setView(v); setExpandedKey(null); }} style={{
              flex: 1, border: 'none', cursor: 'pointer', borderRadius: 5, padding: '5px 0',
              fontSize: 11.5, fontWeight: view === v ? 600 : 400,
              backgroundColor: view === v ? '#fff' : 'transparent',
              color: view === v ? '#111' : '#6b7280',
              boxShadow: view === v ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              transition: 'all 0.15s', fontFamily: 'inherit',
            }}>
              {v === 'library' ? 'Library' : 'Hidden'}
              {v === 'hidden' && hiddenItems.length > 0 && (
                <span style={{
                  backgroundColor: view === 'hidden' ? '#6366f1' : '#9ca3af',
                  color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700,
                  padding: '1px 6px', lineHeight: '16px',
                }}>
                  {hiddenItems.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search + sort — library view only */}
        {view === 'library' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: '#bbb' }} />
              <input
                type="text" placeholder="Search papers…" value={query}
                onChange={e => setQuery(e.target.value)}
                style={{
                  width: '100%', padding: '6px 8px 6px 26px', borderRadius: 6,
                  border: '1px solid #ddd', fontSize: 12.5, outline: 'none', boxSizing: 'border-box',
                  backgroundColor: '#fff',
                }}
              />
            </div>
            {/* Sort pills */}
            <div style={{ display: 'flex', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#aaa', alignSelf: 'center', marginRight: 2 }}>Sort:</span>
              {SORT_LABELS.map(({ value, label }) => (
                <button key={value} onClick={() => setSort(value)} style={{
                  border: sort === value ? '1px solid #6366f1' : '1px solid #e5e7eb',
                  backgroundColor: sort === value ? '#eef2ff' : '#fff',
                  color: sort === value ? '#4f46e5' : '#6b7280',
                  borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: sort === value ? 600 : 400,
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.1s',
                }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {view === 'library' ? (
          <>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                <Loader2 className="animate-spin" size={20} color="#bbb" />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {visibleItems.map(item => (
                  <LibraryCard
                    key={item.key} item={item}
                    expanded={expandedKey === item.key}
                    onToggle={() => setExpandedKey(expandedKey === item.key ? null : item.key)}
                    onHide={() => hideItem(item)}
                    onDragStart={e => onDragStart(e, item)}
                    workspaceId={workspaceId}
                    checkPdf={checkPdf}
                  />
                ))}
                {visibleItems.length === 0 && !loading && (
                  <p style={{ fontSize: 12, color: '#bbb', textAlign: 'center', marginTop: 24 }}>
                    {hiddenKeySet.size > 0 ? 'All results hidden for this workspace.' : 'No results.'}
                  </p>
                )}
                {/* Sentinel for infinite scroll */}
                <div ref={sentinelRef} style={{ height: 1 }} />
                {loadingMore && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
                    <Loader2 className="animate-spin" size={16} color="#bbb" />
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {hiddenItems.length === 0 ? (
              <p style={{ fontSize: 12, color: '#bbb', textAlign: 'center', marginTop: 24 }}>
                No hidden papers for this workspace.
              </p>
            ) : (
              hiddenItems.map(item => (
                <HiddenCard
                  key={item.key} item={item}
                  expanded={expandedKey === item.key}
                  onToggle={() => setExpandedKey(expandedKey === item.key ? null : item.key)}
                  onRestore={() => restoreItem(item.key)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── LibraryCard ──────────────────────────────────────────────────────────────

interface PdfStatus { loading: boolean; attachmentKey: string; exists: boolean }

function LibraryCard({ item, expanded, onToggle, onHide, onDragStart, workspaceId, checkPdf }: {
  item: ZoteroItem; expanded: boolean;
  onToggle: () => void; onHide: () => void;
  onDragStart: (e: React.DragEvent) => void;
  workspaceId: string | null;
  checkPdf: (item: ZoteroItem) => Promise<{ attachmentKey: string; exists: boolean }>;
}) {
  const year = extractYear(item.data.date);
  const venue = extractVenue(item);
  const authors = item.data.creators?.map(c => c.lastName || c.name).filter(Boolean).join(', ') || '';
  const title = item.data.title?.trim() || item.data.filename?.replace(/\.pdf$/i, '') || '';
  const [pdfStatus, setPdfStatus] = useState<PdfStatus | null>(null);

  useEffect(() => {
    if (!expanded) { setPdfStatus(null); return; }
    setPdfStatus({ loading: true, attachmentKey: '', exists: false });
    checkPdf(item).then(s => setPdfStatus({ loading: false, ...s }));
  }, [expanded, item.key, checkPdf]);

  const locatePdf = async () => {
    if (!pdfStatus?.attachmentKey) return;
    const ok = await window.ipcRenderer.invoke('locate-pdf', pdfStatus.attachmentKey) as boolean;
    if (ok) setPdfStatus(s => s ? { ...s, exists: true } : s);
  };

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #ebebeb', borderRadius: 7, overflow: 'hidden',
      transition: 'box-shadow 0.15s',
    }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>
      <div draggable onDragStart={onDragStart} onClick={onToggle}
        style={{ padding: '9px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, userSelect: 'none' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <Book size={12} style={{ marginTop: 3, flexShrink: 0, color: '#c4c9d4' }} />
          <span style={{ fontSize: 12.5, fontWeight: title ? 500 : 400, color: title ? '#1f2937' : '#9ca3af', fontStyle: title ? 'normal' : 'italic', lineHeight: 1.4, flex: 1 }}>
            {title || '(Untitled)'}
          </span>
          <span style={{ color: '#d1d5db', flexShrink: 0 }}>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </span>
        </div>
        {authors && (
          <div style={{ fontSize: 11, color: '#b0b8c4', marginLeft: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {authors}
          </div>
        )}
        {(year || venue) && (
          <div style={{ fontSize: 11, color: '#c8cdd5', marginLeft: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[year, venue].filter(Boolean).join(' · ')}
          </div>
        )}
        {extractCiteKey(item.data.extra) && (
          <div style={{ fontSize: 10, color: '#d1d5db', marginLeft: 18, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            @{extractCiteKey(item.data.extra)}
          </div>
        )}
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #f3f4f6', padding: '9px 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {item.data.abstractNote ? (
            <p style={{ margin: 0, fontSize: 11.5, color: '#4b5563', lineHeight: 1.7 }}>
              {item.data.abstractNote}
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: 11.5, color: '#9ca3af', fontStyle: 'italic' }}>No abstract available.</p>
          )}

          {/* PDF status */}
          {pdfStatus && !pdfStatus.loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: pdfStatus.exists ? '#16a34a' : '#9ca3af' }}>
              {pdfStatus.exists ? null : <FileX size={11} />}
              {pdfStatus.exists ? null : (
                pdfStatus.attachmentKey
                  ? <span>PDF not found locally.</span>
                  : <span>No PDF attachment in Zotero.</span>
              )}
              {!pdfStatus.exists && pdfStatus.attachmentKey && (
                <button onClick={e => { e.stopPropagation(); locatePdf(); }} style={actionBtn('#fefce8', '#92400e', '#fcd34d')}>
                  <FolderOpen size={11} />
                  Locate PDF…
                </button>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              onClick={e => { e.stopPropagation(); window.ipcRenderer.invoke('open-external', `zotero://select/library/items/${item.key}`) }}
              style={actionBtn('#f3f4f6', '#374151')}
            >
              <ExternalLink size={11} />
              Open in Zotero
            </button>
            {workspaceId && (
              <button onClick={e => { e.stopPropagation(); onHide(); }} style={actionBtn('#fff5f5', '#dc2626', '#fca5a5')}>
                <EyeOff size={11} />
                Hide from workspace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HiddenCard ───────────────────────────────────────────────────────────────

function HiddenCard({ item, expanded, onToggle, onRestore }: {
  item: HiddenItem; expanded: boolean; onToggle: () => void; onRestore: () => void;
}) {
  return (
    <div style={{
      backgroundColor: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 7,
      overflow: 'hidden', opacity: 0.8,
    }}>
      <div onClick={onToggle} style={{ padding: '9px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, userSelect: 'none' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <Book size={12} style={{ marginTop: 3, flexShrink: 0, color: '#d1d5db' }} />
          <span style={{ fontSize: 12.5, fontWeight: 500, color: '#6b7280', lineHeight: 1.4, flex: 1 }}>
            {item.title}
          </span>
          <span style={{ color: '#d1d5db', flexShrink: 0 }}>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </span>
        </div>
        {item.authors && (
          <div style={{ fontSize: 11, color: '#c4c9d4', marginLeft: 18 }}>{item.authors}</div>
        )}
        {(item.year || item.venue) && (
          <div style={{ fontSize: 11, color: '#d1d5db', marginLeft: 18 }}>
            {[item.year, item.venue].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #f3f4f6', padding: '9px 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {item.abstract ? (
            <p style={{ margin: 0, fontSize: 11.5, color: '#6b7280', lineHeight: 1.7 }}>{item.abstract}</p>
          ) : (
            <p style={{ margin: 0, fontSize: 11.5, color: '#9ca3af', fontStyle: 'italic' }}>No abstract available.</p>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              onClick={e => { e.stopPropagation(); window.ipcRenderer.invoke('open-external', `zotero://select/library/items/${item.key}`) }}
              style={actionBtn('#f3f4f6', '#374151')}
            >
              <ExternalLink size={11} />
              Open in Zotero
            </button>
            <button onClick={e => { e.stopPropagation(); onRestore(); }} style={actionBtn('#eef2ff', '#4f46e5', '#a5b4fc')}>
              <RotateCcw size={11} />
              Restore to library
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function actionBtn(bg: string, color: string, borderColor?: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 4,
    border: `1px solid ${borderColor ?? '#e5e7eb'}`,
    backgroundColor: bg, color, borderRadius: 5,
    padding: '3px 9px', fontSize: 11, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  };
}
