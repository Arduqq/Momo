import axios from 'axios';

export type ZoteroSort = 'dateModified' | 'date' | 'title';

export interface ZoteroItem {
  key: string;
  data: {
    itemType: string;
    title?: string;
    creators: Array<{ firstName?: string; lastName?: string; name?: string }>;
    date?: string;
    abstractNote?: string;
    publicationTitle?: string;
    proceedingsTitle?: string;
    publisher?: string;
    // attachment-specific fields
    contentType?: string;
    filename?: string;
    linkMode?: string;
    // free-form extra field — Better BibTeX stores "Citation Key: xxx" here
    extra?: string;
  };
}

export interface ZoteroAnnotation {
  key: string;
  version: number;
  data: {
    itemType: 'annotation';
    parentItem: string;
    annotationType: string;
    annotationText: string;
    annotationComment: string;
    annotationColor: string;
    annotationPageLabel: string;
    annotationPosition: string | { pageIndex: number; rects: number[][] };
  };
}

export function extractCiteKey(extra?: string): string {
  if (!extra) return ''
  const m = extra.match(/^Citation Key:\s*(\S+)/im)
  return m?.[1] ?? ''
}

export class ZoteroClient {
  private userId: string;
  private apiKey: string;
  private baseUrl = 'https://api.zotero.org';

  constructor(userId: string, apiKey: string) {
    this.userId = userId;
    this.apiKey = apiKey;
  }

  private get headers() {
    return { 'Zotero-API-Key': this.apiKey };
  }

  async fetchItems(query = '', start = 0, sort: ZoteroSort = 'dateModified', limit = 25): Promise<{ items: ZoteroItem[]; total: number }> {
    if (!this.userId || !this.apiKey) return { items: [], total: 0 };
    try {
      const direction = sort === 'title' ? 'asc' : 'desc';
      // /items/top returns all top-level items: regular papers + standalone PDFs,
      // but never child attachments (PDFs that belong to a paper).
      const response = await axios.get(`${this.baseUrl}/users/${this.userId}/items/top`, {
        params: { format: 'json', limit, start, sort, direction, q: query },
        headers: this.headers,
      });
      const total = parseInt(response.headers['total-results'] ?? '0', 10);
      const items = (response.data as ZoteroItem[]).filter(item =>
        item.data.itemType !== 'note' &&
        // keep all non-attachment items, and attachment items only if they are PDFs
        (item.data.itemType !== 'attachment' || item.data.contentType === 'application/pdf')
      );
      return { items, total };
    } catch (err: any) {
      console.error('[Zotero] request failed:', err?.response?.status, err?.response?.data ?? err?.message);
      throw err;
    }
  }

  async fetchItemsByKeys(itemKeys: string[]): Promise<any[]> {
    if (!itemKeys.length) return []
    const resp = await axios.get(`${this.baseUrl}/users/${this.userId}/items`, {
      params: { itemKey: itemKeys.join(','), format: 'json', limit: itemKeys.length },
      headers: this.headers,
    })
    return resp.data as any[]
  }

  async getPdfAttachmentKey(itemKey: string): Promise<string> {
    const resp = await axios.get(`${this.baseUrl}/users/${this.userId}/items/${itemKey}/children`, {
      headers: this.headers,
    });
    const pdfChild = (resp.data as any[]).find(c => c.data?.contentType === 'application/pdf');
    return pdfChild?.key || '';
  }

  async getAnnotations(attachmentKey: string): Promise<ZoteroAnnotation[]> {
    const resp = await axios.get(`${this.baseUrl}/users/${this.userId}/items/${attachmentKey}/children`, {
      headers: this.headers,
    });
    return (resp.data as ZoteroAnnotation[]).filter(i => i.data.itemType === 'annotation');
  }

  async createAnnotation(attachmentKey: string, annotation: {
    pageIndex: number;
    rects: number[][];
    text: string;
    comment: string;
    color: string;
    pageLabel: string;
  }): Promise<ZoteroAnnotation> {
    const resp = await axios.post(
      `${this.baseUrl}/users/${this.userId}/items`,
      [{
        itemType: 'annotation',
        parentItem: attachmentKey,
        annotationType: 'highlight',
        annotationText: annotation.text,
        annotationComment: annotation.comment,
        annotationColor: annotation.color,
        annotationPageLabel: annotation.pageLabel,
        annotationPosition: JSON.stringify({ pageIndex: annotation.pageIndex, rects: annotation.rects }),
      }],
      { headers: { ...this.headers, 'Content-Type': 'application/json' } },
    );
    const result = resp.data.successful?.['0']
    if (!result) {
      const failed = resp.data.failed?.['0']
      throw new Error(failed ? JSON.stringify(failed) : 'Zotero annotation creation returned no result')
    }
    return result;
  }

  async updateAnnotationComment(annotationKey: string, comment: string, version: number): Promise<void> {
    await axios.patch(
      `${this.baseUrl}/users/${this.userId}/items/${annotationKey}`,
      { annotationComment: comment },
      { headers: { ...this.headers, 'Content-Type': 'application/json', 'If-Unmodified-Since-Version': version } },
    );
  }

  async deleteAnnotation(annotationKey: string, version: number): Promise<void> {
    await axios.delete(
      `${this.baseUrl}/users/${this.userId}/items/${annotationKey}`,
      { headers: { ...this.headers, 'If-Unmodified-Since-Version': version } },
    );
  }
}
