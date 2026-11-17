import * as pdfjs from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// ?url tells Vite to copy the file and return the correct URL for both dev and production.
// CSP allows same-origin workers ("worker-src 'self'") so the HTTP/file:// URL works directly.
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

export { pdfjs }
