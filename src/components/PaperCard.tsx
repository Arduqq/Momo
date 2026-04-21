import React from 'react'
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Geometry2d,
  Rectangle2d,
  useEditor,
} from 'tldraw'
import type { TLBaseShape } from 'tldraw'

export type IPaperCardShape = TLBaseShape<'paper-card', {
  w: number;
  h: number;
  title: string;
  authors: string;
  year: string;
  venue: string;
  contribution: string;
  relationship: string;
  abstract: string;
  itemKey: string;
  pdfKey: string;
  thumbnail: string;
  read: boolean;
  citeKey: string;
}>

export const CARD_W = 190;
export const CARD_H = 230;
const THUMB_H = 130;

function PaperCardInner({ shape }: { shape: any }) {
  const editor = useEditor()
  const { title, authors, year, thumbnail, read, citeKey } = shape.props;
  const firstAuthor = authors?.split(',')?.[0]?.trim() ?? '';
  const meta = [firstAuthor, year].filter(Boolean).join(' · ');

  const toggleRead = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    editor.updateShape({ id: shape.id, type: 'paper-card', props: { read: !read } } as any)
  }

  return (
    <HTMLContainer
      id={shape.id}
      style={{
        pointerEvents: 'all',
        width: CARD_W,
        height: CARD_H,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        backgroundColor: '#fff',
        borderRadius: '10px',
        border: read ? '1.5px solid #6366f1' : '1px solid #e5e7eb',
        boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
      }}
    >
      {/* Thumbnail */}
      <div style={{
        height: THUMB_H,
        flexShrink: 0,
        overflow: 'hidden',
        backgroundColor: '#eef2ff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}>
        {thumbnail ? (
          <img
            src={thumbnail}
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
          />
        ) : (
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        )}

        {/* Read checkbox overlay */}
        <div
          onPointerDown={e => e.stopPropagation()}
          onClick={toggleRead}
          style={{
            position: 'absolute',
            bottom: '7px',
            right: '7px',
            width: '20px',
            height: '20px',
            borderRadius: '5px',
            backgroundColor: read ? '#6366f1' : 'rgba(255,255,255,0.85)',
            border: read ? '1.5px solid #6366f1' : '1.5px solid #d1d5db',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
          }}
          title={read ? 'Mark as unread' : 'Mark as read'}
        >
          {read && (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="2,6 5,9 10,3" />
            </svg>
          )}
        </div>
      </div>

      {/* Info */}
      <div style={{
        flex: 1,
        padding: '9px 11px',
        borderTop: '1px solid #f3f4f6',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: 0,
      }}>
        <div style={{
          fontWeight: '600',
          fontSize: '11.5px',
          color: '#111827',
          lineHeight: '1.45',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        } as React.CSSProperties}>
          {title}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 5 }}>
          {meta && (
            <div style={{
              fontSize: '10px', color: '#9ca3af',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {meta}
            </div>
          )}
          {citeKey && (
            <div style={{
              fontSize: '9px', color: '#c4c9d4', fontFamily: 'monospace',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              @{citeKey}
            </div>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}

export class PaperCardShapeUtil extends BaseBoxShapeUtil<any> {
  static override type = 'paper-card' as const

  override getDefaultProps(): any {
    return {
      w: CARD_W,
      h: CARD_H,
      title: 'Paper Title',
      authors: '',
      year: '',
      venue: '',
      contribution: '',
      relationship: '',
      abstract: '',
      itemKey: '',
      pdfKey: '',
      thumbnail: '',
      read: false,
      citeKey: '',
    }
  }

  override canResize() { return false }

  override onDoubleClick(shape: any) {
    const { pdfKey, itemKey, title } = shape.props
    document.dispatchEvent(new CustomEvent('momo:open-pdf', { detail: { pdfKey, itemKey, title } }))
  }

  override getGeometry(shape: any): Geometry2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    })
  }

  override component(shape: any) {
    return <PaperCardInner shape={shape} />
  }

  override indicator(shape: any) {
    return <rect width={shape.props.w} height={shape.props.h} rx={10} />
  }
}
