import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api, User, Workspace } from '../../lib/api';
import ScholarGraphMark from '../../components/ScholarGraphMark';
import AgentStudio from './AgentStudio';
import ResearchRuns from './ResearchRuns';
import './WorkspaceView.css';

type DocumentItem = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: string;
  pages: number;
  characters: number;
  warnings: string[];
  createdAt: string;
};
type Evidence = {
  id: string;
  documentId: string | null;
  document: string;
  page: number | null;
  section: string | null;
  url: string | null;
  sourceType: string;
  contentCoverage?: string;
  sourceProvider?: string | null;
  doi?: string | null;
  authors?: string[];
  publishedAt?: string | null;
  excerpt: string;
};
type Answer = {
  answer: string;
  evidence: Evidence[];
  abstained: boolean;
  answerMode: string;
  model: { provider: string; model: string } | null;
  notice: string;
  sourceWarnings: string[];
};
type Props = { workspace: Workspace; user: User; onBack: () => void };
const tabs = ['Overview', 'Documents', 'Ask', 'Reports', 'Instructions'];

function renderLinkedAnswer(
  text: string,
  evidence: Evidence[],
  onOpen: (id: string) => void,
) {
  const validIds = new Set(evidence.map((item) => item.id));
  return text.split(/(\[E\d+\])/g).map((part, index) => {
    const match = part.match(/^\[(E\d+)\]$/);
    if (!match) return part;
    const id = match[1];
    return validIds.has(id) ? (
      <button
        className="answer-citation"
        key={`${id}-${index}`}
        type="button"
        aria-label={`Open evidence passage ${id}`}
        onClick={() => onOpen(id)}
      >
        {part}
      </button>
    ) : (
      <span className="citation-needs-review" key={`unmatched-${index}`}>
        {part}
      </span>
    );
  });
}

export default function WorkspaceView({ workspace, user, onBack }: Props) {
  const [tab, setTab] = useState('Overview');
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [documentSearch, setDocumentSearch] = useState('');
  const [documentPage, setDocumentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [question, setQuestion] = useState('');
  const [sourceMode, setSourceMode] = useState<'documents_only' | 'documents_web'>(
    'documents_only',
  );
  const [provider, setProvider] = useState<'groq' | 'gemini' | 'retrieval_only'>('retrieval_only');
  const [availableProviders, setAvailableProviders] = useState<{ groq: boolean; gemini: boolean }>({
    groq: false,
    gemini: false,
  });
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [selectedAnswerEvidenceId, setSelectedAnswerEvidenceId] = useState('');
  const [asking, setAsking] = useState(false);
  const [queuedQuestion, setQueuedQuestion] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const questionRef = useRef('');

  async function loadDocuments() {
    setLoading(true);
    try {
      const result = await api<{ documents: DocumentItem[] }>(
        `/workspaces/${workspace.id}/documents?page=1&pageSize=50`,
      );
      setDocuments(result.documents);
      setSelectedIds((existing) =>
        existing.length
          ? existing.filter((id) =>
              result.documents.some((doc) => doc.id === id && doc.status === 'ready'),
            )
          : result.documents.filter((doc) => doc.status === 'ready').map((doc) => doc.id),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load documents.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDocuments();
  }, [workspace.id]);
  useEffect(() => {
    api<{
      providers: { groq: boolean; gemini: boolean; preferred: string | null };
      webSearch: boolean;
    }>('/providers')
      .then((result) => {
        setAvailableProviders(result.providers);
        if (result.providers.preferred === 'groq' || result.providers.preferred === 'gemini')
          setProvider(result.providers.preferred);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    questionRef.current = question;
  }, [question]);
  useEffect(() => {
    if (!selectedAnswerEvidenceId) return;
    const target = document.getElementById(`answer-evidence-${selectedAnswerEvidenceId}`);
    if (!target) return;
    target.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [selectedAnswerEvidenceId, answer]);
  useEffect(() => {
    if (!uploading && queuedQuestion) {
      const queued = queuedQuestion;
      setQueuedQuestion('');
      void askQuestion(queued);
    }
  }, [uploading, queuedQuestion]);

  const readyDocuments = useMemo(
    () => documents.filter((doc) => doc.status === 'ready'),
    [documents],
  );
  const filteredDocuments = useMemo(() => {
    const query = documentSearch.trim().toLocaleLowerCase();
    return query
      ? documents.filter((doc) => `${doc.name} ${doc.status}`.toLocaleLowerCase().includes(query))
      : documents;
  }, [documents, documentSearch]);
  const documentPageSize = 10;
  const documentTotalPages = Math.max(1, Math.ceil(filteredDocuments.length / documentPageSize));
  const visibleDocuments = filteredDocuments.slice(
    (documentPage - 1) * documentPageSize,
    documentPage * documentPageSize,
  );
  const chosenDocuments = selectedIds.length ? selectedIds : readyDocuments.map((doc) => doc.id);

  async function uploadFiles(files: FileList | File[]) {
    const allFiles = Array.from(files);
    if (!allFiles.length) return;
    setError('');
    setNotice('');
    const allowed = /\.(pdf|docx|txt|md|markdown)$/i;
    const invalid = allFiles.find(
      (file) => !allowed.test(file.name) || file.size > 20 * 1024 * 1024,
    );
    if (invalid) {
      setError(`${invalid.name}: upload PDF, DOCX, TXT or Markdown files up to 20 MB.`);
      return;
    }
    const form = new FormData();
    allFiles.forEach((file) => form.append('files', file));
    setUploading(true);
    setTab('Documents');
    try {
      const result = await api<{
        documents: Array<{ id: string; name: string; status: string; warnings?: string[] }>;
      }>(`/workspaces/${workspace.id}/documents`, { method: 'POST', body: form });
      const added = result.documents.filter((doc) => doc.status !== 'duplicate');
      setNotice(
        `${added.length} file${added.length === 1 ? '' : 's'} processed. ${result.documents.filter((doc) => doc.status === 'duplicate').length ? 'Duplicate files were skipped.' : ''}`,
      );
      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void uploadFiles(event.dataTransfer.files);
  }
  function onSelectFiles(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void uploadFiles(event.target.files);
  }

  async function askQuestion(text = questionRef.current) {
    const clean = text.trim();
    if (!clean || asking) return;
    if (uploading) {
      setQueuedQuestion(clean);
      setNotice('Question queued. It will run after the current files finish indexing.');
      return;
    }
    setQuestion(clean);
    setError('');
    setNotice('');
    setSelectedAnswerEvidenceId('');
    setAnswer(null);
    setAsking(true);
    setTab('Ask');
    try {
      const result = await api<Answer & { sourceWarnings: string[] }>(
        `/workspaces/${workspace.id}/questions`,
        {
          method: 'POST',
          body: JSON.stringify({
            question: clean,
            documentIds: chosenDocuments,
            sourceMode,
            provider,
          }),
        },
      );
      setAnswer(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not answer that question.');
    } finally {
      setAsking(false);
    }
  }

  async function deleteDocument(doc: DocumentItem) {
    if (!window.confirm(`Delete “${doc.name}” and its extracted text?`)) return;
    try {
      await api(`/documents/${doc.id}`, { method: 'DELETE' });
      setDocuments((list) => list.filter((item) => item.id !== doc.id));
      setSelectedIds((ids) => ids.filter((id) => id !== doc.id));
      setNotice('Document and extracted passages deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete document.');
    }
  }

  async function retryDocument(doc: DocumentItem) {
    setError('');
    try {
      const result = await api<{ document: { status: string; warnings?: string[] } }>(
        `/documents/${doc.id}/reprocess`,
        { method: 'POST' },
      );
      setNotice(
        result.document.status === 'ready'
          ? `${doc.name} was indexed successfully.`
          : `${doc.name} still needs attention. Review its processing warnings.`,
      );
      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not retry document indexing.');
    }
  }

  return (
    <main className="workspace-app">
      <header className="workspace-app-header">
        <button className="back-button" onClick={onBack}>
          ← Workspaces
        </button>
        <div className="workspace-app-brand">
          <ScholarGraphMark className="brand-symbol" size={38} />
          <strong>
            Scholar<span>Graph</span>
          </strong>
        </div>
        <div className="workspace-app-user">
          <span>{user.name}</span>
          <b>{user.name.slice(0, 1).toUpperCase()}</b>
        </div>
      </header>
      <div className="workspace-app-body">
        <aside className="workspace-rail">
          <div className="active-workspace">
            <small>WORKSPACE</small>
            <strong>{workspace.name}</strong>
            <span>Private research space</span>
          </div>
          <nav aria-label="Workspace navigation">
            {tabs.map((item, index) => (
              <button
                key={item}
                className={tab === item ? 'current' : ''}
                onClick={() => setTab(item)}
              >
                <i>{['⌂', '▤', '⌕', '↗', '✳'][index]}</i>
                {item}
              </button>
            ))}
          </nav>
          <div className="rail-bottom">
            <small>YOUR LIBRARY</small>
            <strong>{documents.length} sources</strong>
            <span>{readyDocuments.length} ready to search</span>
          </div>
        </aside>
        <section className="workspace-main">
          <div className="workspace-main-title">
            <div>
              <span className="kicker">
                {tab === 'Overview' ? 'RESEARCH DESK' : tab.toUpperCase()}
              </span>
              <h1>{tab === 'Overview' ? workspace.name : tab}</h1>
              <p>
                {tab === 'Ask'
                  ? 'Ask a focused question, then open the passages that support the answer.'
                  : tab === 'Documents'
                    ? 'Add files, find a source by name, and retry indexing when needed.'
                    : tab === 'Overview'
                      ? 'Keep your reading, questions and reports together in one private place.'
                      : tab === 'Reports'
                        ? 'Start with a research question and follow the evidence through each report.'
                        : 'Adjust the guidance used when ScholarGraph prepares a report.'}
              </p>
            </div>
            {tab !== 'Ask' && (
              <button
                className="secondary-action"
                onClick={() => {
                  setTab('Documents');
                  fileInput.current?.click();
                }}
              >
                ＋ Add documents
              </button>
            )}
          </div>
          {(error || notice) && (
            <div className={error ? 'inline-error' : 'inline-success'} role="status">
              {error || notice}
              <button
                onClick={() => {
                  setError('');
                  setNotice('');
                }}
              >
                ×
              </button>
            </div>
          )}
          {tab === 'Overview' && (
            <div className="workspace-overview">
              <div className="overview-stats">
                <article>
                  <span>Indexed sources</span>
                  <strong>{readyDocuments.length.toString().padStart(2, '0')}</strong>
                </article>
                <article>
                  <span>Needs attention</span>
                  <strong>
                    {documents
                      .filter((doc) => doc.status !== 'ready')
                      .length.toString()
                      .padStart(2, '0')}
                  </strong>
                </article>
                <article>
                  <span>Workspace access</span>
                  <strong>Private</strong>
                </article>
              </div>
              <div className="overview-grid">
                <div className="overview-card">
                  <div>
                    <span className="kicker">DOCUMENT LIBRARY</span>
                    <h2>Build your evidence base</h2>
                    <p>
                      Upload papers, reports, notes and technical references. Extracted text and
                      page metadata remain private in this workspace.
                    </p>
                  </div>
                  <button
                    className="primary-action"
                    onClick={() => {
                      setTab('Documents');
                      fileInput.current?.click();
                    }}
                  >
                    Upload sources <span>→</span>
                  </button>
                </div>
                <div className="overview-card ask-promo">
                  <div>
                    <span className="kicker">SOURCE-GROUNDED Q&A</span>
                    <h2>Ask across your sources</h2>
                    <p>
                      Find the actual passages related to a research question, then inspect the
                      source yourself.
                    </p>
                  </div>
                  <button className="secondary-action" onClick={() => setTab('Ask')}>
                    Ask a question →
                  </button>
                </div>
              </div>
              <h2 className="subsection-title">Recent sources</h2>
              <DocumentList
                documents={documents.slice(0, 4)}
                loading={loading}
                onDelete={deleteDocument}
                onRetry={retryDocument}
                onOpenAsk={() => setTab('Ask')}
              />
            </div>
          )}
          {tab === 'Documents' && (
            <>
              <div
                className={`drop-zone ${dragging ? 'dragging' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <div className="drop-icon">↑</div>
                <h2>
                  {uploading ? 'Uploading and indexing your files…' : 'Drop research files here'}
                </h2>
                <p>PDF, DOCX, TXT or Markdown · up to 20 MB each · maximum 10 at a time</p>
                <button
                  className="secondary-action"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  Browse files
                </button>
                <small>
                  Selectable PDF text is supported. Scanned pages are marked for attention; OCR is
                  not configured.
                </small>
              </div>
              <div className="library-head">
                <div>
                  <h2>Source library</h2>
                  <p>
                    {filteredDocuments.length} of {documents.length} documents ·{' '}
                    {readyDocuments.length} indexed
                  </p>
                </div>
                <button onClick={() => void loadDocuments()}>↻ Refresh</button>
              </div>
              <div className="document-toolbar">
                <input
                  type="search"
                  aria-label="Search documents"
                  placeholder="Search by file name or status"
                  value={documentSearch}
                  onChange={(event) => {
                    setDocumentSearch(event.target.value);
                    setDocumentPage(1);
                  }}
                />
                {filteredDocuments.length > documentPageSize && (
                  <div className="document-pagination" aria-label="Document pages">
                    <button
                      disabled={documentPage <= 1}
                      onClick={() => setDocumentPage((page) => Math.max(1, page - 1))}
                    >
                      Previous
                    </button>
                    <span>
                      {documentPage} / {documentTotalPages}
                    </span>
                    <button
                      disabled={documentPage >= documentTotalPages}
                      onClick={() =>
                        setDocumentPage((page) => Math.min(documentTotalPages, page + 1))
                      }
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
              <DocumentList
                documents={visibleDocuments}
                loading={loading}
                onDelete={deleteDocument}
                onRetry={retryDocument}
                onOpenAsk={() => setTab('Ask')}
              />
            </>
          )}
          {tab === 'Ask' && (
            <div className="ask-page">
              <div className="ask-source-row">
                <div>
                  <strong>Sources</strong>
                  <span>
                    {selectedIds.length || readyDocuments.length} selected · {readyDocuments.length}{' '}
                    indexed
                  </span>
                </div>
                <button onClick={() => setTab('Documents')}>Manage sources</button>
              </div>
              <div className="source-checks">
                {documents.length ? (
                  documents.map((doc) => (
                    <label key={doc.id} className={doc.status === 'ready' ? '' : 'not-ready'}>
                      <input
                        type="checkbox"
                        disabled={doc.status !== 'ready'}
                        checked={
                          selectedIds.length ? selectedIds.includes(doc.id) : doc.status === 'ready'
                        }
                        onChange={() =>
                          setSelectedIds((ids) =>
                            ids.includes(doc.id)
                              ? ids.filter((id) => id !== doc.id)
                              : [...ids, doc.id],
                          )
                        }
                      />
                      <span>{doc.name}</span>
                      <small>
                        {doc.status === 'ready'
                          ? `${doc.pages} pages · ready`
                          : doc.status.replace('_', ' ')}
                      </small>
                    </label>
                  ))
                ) : (
                  <p className="no-sources">Upload sources to ask a question.</p>
                )}
              </div>
              <div className="mode-row">
                <div className="mode-select">
                  <span>Research mode</span>
                  <button
                    className={sourceMode === 'documents_only' ? 'selected' : ''}
                    onClick={() => setSourceMode('documents_only')}
                  >
                    My documents
                  </button>
                  <button
                    className={sourceMode === 'documents_web' ? 'selected' : ''}
                    onClick={() => setSourceMode('documents_web')}
                  >
                    Documents + online sources
                  </button>
                </div>
                <label className="provider-select">
                  AI provider
                  <select
                    value={provider}
                    onChange={(event) =>
                      setProvider(event.target.value as 'groq' | 'gemini' | 'retrieval_only')
                    }
                  >
                    <option value="retrieval_only">No AI synthesis</option>
                    {availableProviders.groq && <option value="groq">Groq</option>}
                    {availableProviders.gemini && <option value="gemini">Gemini</option>}
                  </select>
                </label>
              </div>
              <form
                className="question-card"
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  void askQuestion();
                }}
              >
                <label htmlFor="research-question">What do you want to find out?</label>
                <textarea
                  id="research-question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  rows={4}
                  placeholder="Compare the methods and limitations across these papers…"
                />
                <div>
                  <small>
                    {uploading
                      ? 'Files are indexing. You can ask now and the question will wait.'
                      : 'Answers use only passages retrieved from selected sources.'}
                  </small>
                  <button
                    className="primary-action"
                    disabled={asking || (!question.trim() && !uploading)}
                  >
                    {asking ? 'Searching sources…' : uploading ? 'Queue question' : 'Find evidence'}
                    <span>→</span>
                  </button>
                </div>
              </form>
              {answer && (
                <section className="answer-card">
                  <div className="answer-header">
                    <div>
                      <span className="kicker">
                        {answer.answerMode === 'ai_assisted'
                          ? 'AI-ASSISTED DRAFT'
                          : answer.abstained
                            ? 'NO MATCHING EVIDENCE'
                            : 'RETRIEVED EVIDENCE'}
                      </span>
                      <h2>Answer</h2>
                    </div>
                    {answer.model && (
                      <small>
                        {answer.model.provider} · {answer.model.model}
                      </small>
                    )}
                  </div>
                  <p className="answer-copy">
                    {renderLinkedAnswer(answer.answer, answer.evidence, setSelectedAnswerEvidenceId)}
                  </p>
                  {answer.notice && <p className="answer-caveat">{answer.notice}</p>}
                  {answer.sourceWarnings.map((warning) => (
                    <p className="source-warning" key={warning}>
                      {warning}
                    </p>
                  ))}
                  <h3>Evidence</h3>
                  {answer.evidence.length ? (
                    answer.evidence.map((item) => (
                      <article
                        className={`evidence-result ${selectedAnswerEvidenceId === item.id ? 'evidence-selected' : ''}`}
                        id={`answer-evidence-${item.id}`}
                        key={item.id}
                        aria-current={selectedAnswerEvidenceId === item.id ? 'true' : undefined}
                      >
                        <div className="evidence-meta">
                          <strong>{item.id}</strong>
                          <span>
                            {item.sourceType === 'uploaded_document'
                              ? 'Your document'
                              : item.sourceType === 'academic_record'
                                ? `${item.sourceProvider || 'Scholarly'} · ${item.contentCoverage || 'metadata only'}`
                                : 'Web source'}
                          </span>
                        </div>
                        <div>
                          <h4>
                            {item.document}
                            {item.publishedAt ? ` · ${item.publishedAt}` : ''}
                            {item.page ? ` · page ${item.page}` : ''}
                            {item.section ? ` · ${item.section}` : ''}
                          </h4>
                          <blockquote>{item.excerpt}</blockquote>
                          {item.doi && (
                            <small className="evidence-coverage">
                              Coverage: {item.contentCoverage || 'metadata only'} · DOI {item.doi}
                            </small>
                          )}
                          {item.url && (
                            <a href={item.url} target="_blank" rel="noreferrer">
                              Open original source ↗
                            </a>
                          )}
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="no-sources">
                      Try different wording or confirm that a matching file is indexed.
                    </p>
                  )}
                </section>
              )}
            </div>
          )}
          {tab === 'Reports' && (
            <ResearchRuns
              workspace={workspace}
              documents={documents.map(({ id, name, status }) => ({ id, name, status }))}
            />
          )}
          {tab === 'Instructions' && <AgentStudio workspace={workspace} />}
          <footer className="product-credit">ScholarGraph · Built by Yash</footer>
        </section>
      </div>
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept=".pdf,.docx,.txt,.md,.markdown"
        onChange={onSelectFiles}
      />
    </main>
  );
}

function DocumentList({
  documents,
  loading,
  onDelete,
  onRetry,
  onOpenAsk,
}: {
  documents: DocumentItem[];
  loading: boolean;
  onDelete: (doc: DocumentItem) => void;
  onRetry: (doc: DocumentItem) => void;
  onOpenAsk: () => void;
}) {
  if (loading) return <div className="document-empty">Loading your source library…</div>;
  if (!documents.length)
    return (
      <div className="document-empty">
        <span>▤</span>
        <h3>No sources yet</h3>
        <p>Add research documents to make them searchable here.</p>
        <button className="text-link" onClick={onOpenAsk}>
          Open source Q&A
        </button>
      </div>
    );
  return (
    <div className="document-list">
      {documents.map((doc) => (
        <article className="document-item" key={doc.id}>
          <span className={`file-type ${doc.status === 'ready' ? 'ready' : 'attention'}`}>
            {doc.name.split('.').pop()?.toUpperCase().slice(0, 4)}
          </span>
          <div className="document-details">
            <strong>{doc.name}</strong>
            <span>
              {(doc.size / 1024 / 1024).toFixed(1)} MB · {doc.pages || '—'} pages ·{' '}
              {doc.characters.toLocaleString()} characters
            </span>
            {doc.warnings?.map((warning) => (
              <small className="document-warning" key={warning}>
                {warning}
              </small>
            ))}
          </div>
          <span className={`document-status ${doc.status}`}>{doc.status.replace('_', ' ')}</span>
          {(doc.status === 'failed' || doc.status === 'needs_attention') && (
            <button className="retry-document" onClick={() => onRetry(doc)}>
              Retry indexing
            </button>
          )}
          <button
            className="delete-document"
            aria-label={`Delete ${doc.name}`}
            onClick={() => onDelete(doc)}
          >
            Delete
          </button>
        </article>
      ))}
    </div>
  );
}
