import { pdfjs } from './pdfSetup'

export async function generateThumbnail(
  userId: string,
  apiKey: string,
  itemKey: string,
  existingPdfKey = '',
): Promise<{ thumbnail: string; pdfKey: string }> {
  try {
    let pdfKey = existingPdfKey;
    if (!pdfKey) {
      const resp = await fetch(
        `https://api.zotero.org/users/${userId}/items/${itemKey}/children`,
        { headers: { 'Zotero-API-Key': apiKey } },
      );
      if (!resp.ok) return { thumbnail: '', pdfKey: '' };
      const children: any[] = await resp.json();
      const pdfChild = children.find(c => c.data?.contentType === 'application/pdf');
      if (!pdfChild) return { thumbnail: '', pdfKey: '' };
      pdfKey = pdfChild.key;
    }

    const pdfData: Uint8Array | null = await window.ipcRenderer.invoke('read-zotero-pdf', pdfKey);
    if (!pdfData) return { thumbnail: '', pdfKey };

    const pdf = await pdfjs.getDocument({ data: pdfData }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 0.4 });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas }).promise;

    return { thumbnail: canvas.toDataURL('image/jpeg', 0.75), pdfKey };
  } catch (e) {
    console.warn('[PDF] thumbnail generation failed:', e);
    return { thumbnail: '', pdfKey: '' };
  }
}
