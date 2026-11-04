import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeEvidenceAnswer, rankChunks, tokenize } from '../server/retrieval.js';
import { buildChunks, extractDocument, sha256 } from '../server/documents.js';

test('lexical retrieval ranks exact research terms and excludes non-matches', () => {
  const chunks = [
    {
      text: 'The experiment compared retrieval quality across the benchmark.',
      documentName: 'Methods.pdf',
    },
    { text: 'A general paragraph about research writing.', documentName: 'Notes.md' },
  ];
  assert.match(tokenize('Compare retrieval quality').join(' '), /retrieval/);
  const ranked = rankChunks('retrieval quality', chunks);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].documentName, 'Methods.pdf');
});

test('retrieval abstains when no source passage matches', () => {
  const answer = makeEvidenceAnswer('test question', []);
  assert.equal(answer.abstained, true);
  assert.equal(answer.evidence.length, 0);
});

test('section-aware chunks preserve page boundaries and content hashes', () => {
  const chunks = buildChunks([
    { page: 1, text: '# Methods\n\nWe used a randomized sample and preregistered analysis.' },
    { page: 2, text: '# Limitations\n\nThe sample was small and came from one institution.' },
  ]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].sectionTitle, 'Methods');
  assert.equal(chunks[0].pageStart, 1);
  assert.equal(chunks[1].pageStart, 2);
  assert.notEqual(chunks[0].contentHash, chunks[1].contentHash);
});

test('uploaded Markdown extraction preserves indexed content and stable file hashes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scholargraph-upload-'));
  const filePath = path.join(directory, 'research-notes.md');
  const contents = Buffer.from(
    '# Methods\n\nThe study used a preregistered randomized sample.\n\n# Limits\n\nThe sample included one institution.',
  );
  try {
    await writeFile(filePath, contents);
    const extracted = await extractDocument({ originalname: 'research-notes.md', path: filePath });
    const chunks = buildChunks(extracted.pages);
    assert.equal(extracted.format, 'MD');
    assert.equal(extracted.pages.length, 1);
    assert.ok(chunks.some((chunk) => chunk.sectionTitle === 'Methods'));
    assert.ok(chunks.some((chunk) => chunk.sectionTitle === 'Limits'));
    assert.equal(sha256(contents), sha256(Buffer.from(contents)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('uploaded text with invalid UTF-8 is rejected instead of silently corrupted', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scholargraph-upload-'));
  const filePath = path.join(directory, 'malformed.txt');
  try {
    await writeFile(filePath, Buffer.from([0xff, 0xfe, 0x00]));
    await assert.rejects(
      extractDocument({ originalname: 'malformed.txt', path: filePath }),
      TypeError,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
