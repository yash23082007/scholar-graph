const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'what',
  'which',
  'where',
  'when',
  'does',
  'are',
  'was',
  'were',
  'have',
  'has',
  'into',
  'about',
  'across',
  'their',
  'these',
  'those',
  'paper',
  'papers',
  'document',
  'documents',
  'compare',
  'summarize',
]);

export function tokenize(text) {
  return (
    String(text || '')
      .toLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu)
      ?.filter((word) => word.length > 1 && !STOP_WORDS.has(word)) || []
  );
}

export function rankChunks(question, chunks, limit = 8) {
  const terms = [...new Set(tokenize(question))];
  if (!terms.length) return [];
  return chunks
    .map((chunk) => {
      const content = tokenize(chunk.text);
      const frequencies = new Map();
      for (const word of content) frequencies.set(word, (frequencies.get(word) || 0) + 1);
      const score = terms.reduce(
        (sum, term) =>
          sum + (frequencies.has(term) ? 1 + Math.min(2, frequencies.get(term) / 3) : 0),
        0,
      );
      return { ...chunk, score };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function makeEvidenceAnswer(question, chunks) {
  if (!chunks.length)
    return {
      answer: `I could not find matching evidence for “${question}” in the selected, indexed documents. Try different terms or check that the relevant files finished processing.`,
      evidence: [],
      abstained: true,
      answerMode: 'no_match',
    };
  const evidence = chunks.map((chunk, index) => ({
    id: `E${index + 1}`,
    documentId: chunk.documentId ? String(chunk.documentId?._id || chunk.documentId) : null,
    document: chunk.documentName || 'Untitled source',
    page: chunk.pageStart || null,
    section: chunk.sectionTitle || null,
    url: chunk.url || null,
    sourceType: chunk.sourceType || 'uploaded_document',
    retrievedAt: chunk.retrievedAt || null,
    contentCoverage: chunk.contentCoverage || (chunk.sourceType === 'academic_record' ? 'metadata_only' : chunk.sourceType === 'web_page_extract' ? 'web_page_extract' : 'user_uploaded_full_text'),
    sourceProvider: chunk.sourceProvider || null,
    doi: chunk.doi || null,
    authors: chunk.authors || [],
    publishedAt: chunk.publishedAt || null,
    excerpt: chunk.text.slice(0, 900),
  }));
  return {
    answer: `I found ${evidence.length} passage${evidence.length === 1 ? '' : 's'} that match your question. Review the excerpts below; this lexical retrieval result does not verify that a passage fully supports a conclusion.`,
    evidence,
    abstained: false,
    answerMode: 'retrieval_only',
  };
}
