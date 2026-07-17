import { PDFDocument } from "pdf-lib";

/* Client-side PDF splitting: free, offline, instant. Each chunk is then
   analysed directly (no transcription pass), so every page is read exactly
   once — complete coverage at a fraction of the token cost. */

export interface PdfChunk { base64: string; from: number; to: number; }

export async function splitPdf(base64: string, pagesPerChunk = 8): Promise<{ chunks: PdfChunk[]; totalPages: number }> {
  const src = await PDFDocument.load(base64, { ignoreEncryption: true });
  const totalPages = src.getPageCount();
  const chunks: PdfChunk[] = [];
  for (let start = 0; start < totalPages; start += pagesPerChunk) {
    const count = Math.min(pagesPerChunk, totalPages - start);
    const doc = await PDFDocument.create();
    const idxs = Array.from({ length: count }, (_, i) => start + i);
    const pages = await doc.copyPages(src, idxs);
    pages.forEach((p) => doc.addPage(p));
    chunks.push({ base64: await doc.saveAsBase64(), from: start + 1, to: start + count });
  }
  return { chunks, totalPages };
}
