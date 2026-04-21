import { BaseBoxShapeUtil, HTMLContainer, Geometry2d, Rectangle2d } from 'tldraw'
import type { TLBaseShape } from 'tldraw'
import { Globe, FileIcon } from 'lucide-react'

export type ILinkCardShape = TLBaseShape<'link-card', {
  w: number;
  h: number;
  url: string;
  label: string;
  kind: 'web' | 'file';
}>

export const LINK_W = 220
export const LINK_H = 68

function LinkCardInner({ shape }: { shape: any }) {
  const { url, label, kind } = shape.props
  const isWeb = kind === 'web'

  const accent = isWeb ? '#3b82f6' : '#f59e0b'
  const accentBg = isWeb ? '#eff6ff' : '#fffbeb'

  return (
    <HTMLContainer id={shape.id} style={{
      pointerEvents: 'all',
      width: LINK_W, height: LINK_H,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      backgroundColor: '#fff',
      borderRadius: 10,
      border: `1px solid ${isWeb ? '#bfdbfe' : '#fde68a'}`,
      boxShadow: '0 2px 10px rgba(0,0,0,0.07)',
      overflow: 'hidden',
      display: 'flex',
      userSelect: 'none',
    }}>
      {/* Accent strip */}
      <div style={{
        width: 48, flexShrink: 0, backgroundColor: accentBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRight: `1px solid ${isWeb ? '#bfdbfe' : '#fde68a'}`,
      }}>
        {isWeb
          ? <Globe size={18} color={accent} />
          : <FileIcon size={18} color={accent} />}
      </div>

      {/* Content */}
      <div style={{
        flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column',
        justifyContent: 'center', gap: 3, minWidth: 0,
      }}>
        <div style={{
          fontSize: 12.5, fontWeight: 600, color: '#111827',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {label}
        </div>
        <div style={{
          fontSize: 10, color: '#9ca3af',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {url}
        </div>
      </div>
    </HTMLContainer>
  )
}

export class LinkCardShapeUtil extends BaseBoxShapeUtil<any> {
  static override type = 'link-card' as const

  override getDefaultProps(): any {
    return { w: LINK_W, h: LINK_H, url: '', label: 'Link', kind: 'web' }
  }

  override canResize() { return false }

  override onDoubleClick(shape: any) {
    document.dispatchEvent(new CustomEvent('momo:open-link', { detail: { url: shape.props.url } }))
  }

  override getGeometry(shape: any): Geometry2d {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  override component(shape: any) {
    return <LinkCardInner shape={shape} />
  }

  override indicator(shape: any) {
    return <rect width={shape.props.w} height={shape.props.h} rx={10} />
  }
}
