import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function splitParagraphs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z0-9#])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function buildChunks(pages, { maxChars = 2800, overlapChars = 320 } = {}) {
  const chunks = [];
  let current = '';
  let currentPage = null;
  let currentSection = '';
  let section = '';
  const flush = () => {
    if (!current.trim()) return;
    const text = current.trim();
    chunks.push({
      chunkIndex: chunks.length,
      text,
      sectionTitle: currentSection || section,
      pageStart: currentPage,
      pageEnd: currentPage,
      contentHash: sha256(Buffer.from(text)),
    });
    current = '';
    currentPage = null;
    currentSection = section;
  };
  for (const page of pages) {
    for (const paragraph of splitParagraphs(page.text)) {
      const markdownHeading = paragraph.match(/^#{1,6}\s+(.+)$/)?.[1];
      const heading = markdownHeading || paragraph.match(/^([A-Z][^.!?]{2,100})$/)?.[1];
      if (heading) {
        const nextSection = heading.replace(/^#+\s*/, '').trim();
        if (current && nextSection !== section) flush();
        section = nextSection;
        if (markdownHeading) continue;
      }
      const parts =
        paragraph.length > maxChars
          ? paragraph.match(new RegExp(`[\\s\\S]{1,${maxChars}}`, 'g')) || [paragraph]
          : [paragraph];
      for (const part of parts) {
        if (current && (current.length + part.length + 2 > maxChars || currentPage !== page.page))
          flush();
        if (!current) {
          currentPage = page.page || null;
          currentSection = section;
        }
        current += `${current ? '\n\n' : ''}${part}`;
        if (current.length >= maxChars) {
          const saved = current;
          flush();
          const tail = saved.slice(-overlapChars).replace(/^\S*\s/, '');
          if (tail) {
            current = tail;
            currentPage = page.page || null;
            currentSection = section;
          }
        }
      }
    }
  }
  flush();
  return chunks;
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(x[\da-f]+|\d+);/gi, (match, code) => {
      const point =
        code[0].toLowerCase() === 'x' ? Number.parseInt(code.slice(1), 16) : Number(code);
      try {
        return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : match;
      } catch {
        return match;
      }
    });
}

function docxHtmlToText(html) {
  return String(html || '')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, content) => {
      const heading = content.replace(/<[^>]*>/g, ' ');
      return `\n${'#'.repeat(Number(level))} ${heading}\n\n`;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(?:p|div|li|tr|table)>/gi, '\n\n')
    .replace(/<\/(?:td|th)>/gi, '\t')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:[a-z]+|#\w+);/gi, (entity) => decodeHtmlEntities(entity))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractDocument(file) {
  const extension = file.originalname.toLowerCase().split('.').pop();
  const buffer = await readFile(file.path);
  if (!buffer.length) throw new Error('The uploaded document is empty.');
  if (extension === 'txt' || extension === 'md' || extension === 'markdown') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
    const binaryControls = [...text].filter(
      (character) => character < ' ' && !['\n', '\r', '\t', '\f'].includes(character),
    ).length;
    if (binaryControls / Math.max(1, text.length) > 0.005)
      throw new Error('This text file contains binary content and cannot be indexed safely.');
    return { pages: [{ page: 1, text }], warnings: [], format: extension === 'txt' ? 'TXT' : 'MD' };
  }
  if (extension === 'docx') {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b)
      throw new Error('The DOCX file container is invalid.');
    const mammoth = await import('mammoth');
    const result = await mammoth.convertToHtml({ path: file.path });
    const text = docxHtmlToText(result.value);
    return {
      pages: [{ page: null, text }],
      warnings: result.messages.map((message) => message.message).slice(0, 8),
      format: 'DOCX',
    };
  }
  if (extension === 'pdf') {
    if (buffer.subarray(0, 1024).indexOf(Buffer.from('%PDF-')) < 0)
      throw new Error('The PDF header is missing or invalid.');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true })
      .promise;
    const pages = [];
    const warnings = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text)
        warnings.push(`Page ${pageNumber} contains no selectable text; OCR is not available.`);
      pages.push({ page: pageNumber, text });
    }
    const emptyPages = pages.filter((page) => !page.text.trim());
    if (process.env.OCR_ENABLED === 'true' && emptyPages.length) {
      const maxPages = Math.min(Math.max(Number(process.env.OCR_MAX_PAGES || 20), 1), 100);
      const pagesToScan = emptyPages.slice(0, maxPages);
      const timeoutMs = Math.min(Math.max(Number(process.env.OCR_TIMEOUT_MS || 30000), 1000), 60000);
      const directory = await mkdtemp(path.join(os.tmpdir(), 'scholargraph-ocr-'));
      let unavailable = false;
      try {
        for (const page of pagesToScan) {
          const outputBase = path.join(directory, `page-${page.page}`);
          const imagePath = `${outputBase}.png`;
          try {
            await executeFile(
              process.env.PDF_RENDERER_CMD || 'pdftoppm',
              [
                '-f',
                String(page.page),
                '-l',
                String(page.page),
                '-singlefile',
                '-png',
                '-r',
                '160',
                file.path,
                outputBase,
              ],
              { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
            );
            const result = await executeFile(
              process.env.TESSERACT_CMD || 'tesseract',
              [imagePath, 'stdout', '-l', process.env.OCR_LANG || 'eng'],
              { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
            );
            page.text = String(result.stdout || '').replace(/\s+/g, ' ').trim();
          } catch {
            unavailable = true;
            break;
          }
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
      const scannedPageNumbers = new Set(pagesToScan.filter((page) => page.text.trim()).map((page) => page.page));
      for (let index = warnings.length - 1; index >= 0; index -= 1) {
        const match = warnings[index].match(/^Page (\d+) contains no selectable text/);
        if (match && scannedPageNumbers.has(Number(match[1]))) warnings.splice(index, 1);
      }
      if (unavailable)
        warnings.push('OCR could not run. Install Poppler and Tesseract, then retry indexing.');
      if (emptyPages.length > pagesToScan.length)
        warnings.push(`OCR page limit reached; ${emptyPages.length - pagesToScan.length} scanned pages remain unprocessed.`);
    }
    return { pages, warnings: warnings.slice(0, 12), format: 'PDF' };
  }
  throw new Error('Unsupported file type. Upload PDF, DOCX, TXT or Markdown.');
}
