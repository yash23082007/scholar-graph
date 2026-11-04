import { FormEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { api, Workspace } from '../../lib/api';
import './ResearchRuns.css';

type DocumentOption = { id: string; name: string; status: string };
type RunListItem = {
  id: string;
  task: string;
  status: string;
  currentStage: string;
  evidenceCount: number;
  errorMessage: string;
  createdAt: string;
};
type AgentItem = {
  id: string;
  agent: string;
  status: string;
  provider: string;
  model: string;
  output: string;
  errorCode: string;
};
type RunDetail = {
  id: string;
  task: string;
  status: string;
  currentStage: string;
  markdown: string;
  updatedAt: string;
  evidence: Array<{
    id: string;
    document: string;
    documentId: string | null;
    page: number | null;
    section: string | null;
    url: string | null;
    excerpt: string;
    sourceType: string;
    contentCoverage?: string;
    sourceProvider?: string | null;
    doi?: string | null;
    publishedAt?: string | null;
  }>;
  sourceWarnings: string[];
  artifacts: Record<string, unknown>;
  promptSnapshots: Record<string, { version: number }>;
  agentProviders: Record<string, string>;
  errorMessage: string;
};
type Draft = {
  id: string;
  version: number;
  markdown: string;
  createdBy: string;
  changeSummary: string;
  createdAt: string;
};
const agents = ['researcher', 'writer', 'critic', 'editor'];
const titles: Record<string, string> = {
  researcher: 'Find evidence',
  writer: 'Draft report',
  critic: 'Check claims',
  editor: 'Edit report',
};
const stageLabels: Record<string, string> = {
  researcher: 'Finding evidence',
  writer: 'Drafting',
  critic: 'Checking claims',
  editor: 'Editing',
  queued: 'Waiting to start',
  running: 'In progress',
  completed: 'Complete',
  failed: 'Needs attention',
  cancelled: 'Cancelled',
};
const statusLabel = (value: string) => stageLabels[value] || value;
const coverageLabel = (value?: string) =>
  ({
    user_uploaded_full_text: 'Extracted file text',
    web_page_extract: 'Web excerpt',
    abstract_only: 'Abstract only',
    metadata_only: 'Metadata only',
  })[value || ''] || 'Coverage not specified';

function linkEvidenceReferences(html: string, evidenceIds: Set<string>) {
  const sanitized = DOMPurify.sanitize(html);
  const parsed = new DOMParser().parseFromString(sanitized, 'text/html');
  const walker = document.createTreeWalker(parsed.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest('a,code,pre') && /\[E\d+\]/.test(node.data)) nodes.push(node);
  }
  for (const node of nodes) {
    const fragment = parsed.createDocumentFragment();
    const expression = /\[(E\d+)\]/g;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(node.data))) {
      if (match.index > cursor) fragment.append(node.data.slice(cursor, match.index));
      const id = match[1];
      const reference = parsed.createElement(evidenceIds.has(id) ? 'a' : 'span');
      reference.className = evidenceIds.has(id) ? 'evidence-citation' : 'citation-needs-review';
      reference.textContent = match[0];
      if (evidenceIds.has(id)) {
        reference.setAttribute('href', `#evidence-${id}`);
        reference.setAttribute('data-evidence-id', id);
        reference.setAttribute('aria-label', `Open source passage ${id}`);
      } else {
        reference.setAttribute('title', 'This source reference is not in the evidence list.');
      }
      fragment.append(reference);
      cursor = expression.lastIndex;
    }
    if (cursor < node.data.length) fragment.append(node.data.slice(cursor));
    node.replaceWith(fragment);
  }
  return DOMPurify.sanitize(parsed.body.innerHTML);
}

export default function ResearchRuns({
  workspace,
  documents,
}: {
  workspace: Workspace;
  documents: DocumentOption[];
}) {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [agentRuns, setAgentRuns] = useState<AgentItem[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [creating, setCreating] = useState(false);
  const [task, setTask] = useState('');
  const [outputType, setOutputType] = useState('literature_review');
  const [sourceMode, setSourceMode] = useState<'documents_only' | 'documents_web'>(
    'documents_only',
  );
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [providerConfig, setProviderConfig] = useState<Record<string, string>>({});
  const [providers, setProviders] = useState<{ groq: boolean; gemini: boolean }>({
    groq: false,
    gemini: false,
  });
  const [editorValue, setEditorValue] = useState('');
  const [view, setView] = useState<'report' | 'evidence' | 'agents' | 'history'>('report');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(false);
  const [liveUpdates, setLiveUpdates] = useState(false);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState('');
  const selectedDocsTouched = useRef(false);
  const knownDocumentIds = useRef(new Set<string>());
  useEffect(() => {
    const ready = documents.filter((doc) => doc.status === 'ready').map((doc) => doc.id);
    const added = ready.filter((id) => !knownDocumentIds.current.has(id));
    if (!selectedDocsTouched.current && !knownDocumentIds.current.size) setSelectedDocs(ready);
    else if (added.length) setSelectedDocs((current) => [...new Set([...current, ...added])]);
    knownDocumentIds.current = new Set(documents.map((doc) => doc.id));
  }, [documents]);

  async function loadRuns() {
    const result = await api<{ runs: RunListItem[] }>(`/workspaces/${workspace.id}/runs`);
    setRuns(result.runs);
    if (!selectedId && result.runs[0]) setSelectedId(result.runs[0].id);
  }
  async function loadDetail(id: string) {
    const result = await api<{ run: RunDetail; agents: AgentItem[] }>(`/runs/${id}`);
    setDetail(result.run);
    setAgentRuns(result.agents);
    setEditorValue(result.run.markdown || '');
  }
  async function loadDrafts(id: string) {
    const result = await api<{ drafts: Draft[] }>(`/runs/${id}/drafts`);
    setDrafts(result.drafts);
  }
  useEffect(() => {
    api<{ providers: { groq: boolean; gemini: boolean } }>('/providers')
      .then((value) => setProviders(value.providers))
      .catch(() => {});
    void loadRuns().catch((err) => setError(err.message));
  }, [workspace.id]);
  useEffect(() => {
    if (selectedId) void loadDetail(selectedId).catch((err) => setError(err.message));
    else setDetail(null);
  }, [selectedId]);
  useEffect(() => {
    if (selectedId) void loadDrafts(selectedId).catch(() => {});
  }, [selectedId, detail?.updatedAt]);
  useEffect(() => {
    if (!selectedId || !detail || ['completed', 'failed', 'cancelled'].includes(detail.status))
      return;
    const stream = new EventSource(`/api/v1/runs/${selectedId}/events`);
    stream.onopen = () => setLiveUpdates(true);
    stream.onerror = () => setLiveUpdates(false);
    const refresh = () => {
      void loadDetail(selectedId);
      void loadRuns();
    };
    [
      'run.created',
      'run.started',
      'agent.started',
      'agent.progress',
      'agent.completed',
      'agent.failed',
      'revision.started',
      'run.completed',
      'run.failed',
      'run.cancelled',
      'document.updated',
    ].forEach((eventName) => stream.addEventListener(eventName, refresh));
    return () => {
      setLiveUpdates(false);
      stream.close();
    };
  }, [selectedId, detail?.status]);
  const evidenceIds = useMemo(() => new Set(detail?.evidence.map((item) => item.id) || []), [detail?.evidence]);
  const citationIds = useMemo(
    () => [...new Set([...editorValue.matchAll(/\[(E\d+)\]/g)].map((match) => match[1]))],
    [editorValue],
  );
  const unmatchedCitationIds = citationIds.filter((id) => !evidenceIds.has(id));
  const previewHtml = useMemo(
    () => linkEvidenceReferences(marked.parse(editorValue || '') as string, evidenceIds),
    [editorValue, evidenceIds],
  );
  useEffect(() => {
    if (view !== 'evidence' || !selectedEvidenceId) return;
    const target = document.getElementById(`evidence-${selectedEvidenceId}`);
    if (!target) return;
    target.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [view, selectedEvidenceId]);

  function openCitation(event: ReactMouseEvent<HTMLElement>) {
    const target = (event.target as HTMLElement).closest<HTMLAnchorElement>('a.evidence-citation');
    if (!target?.dataset.evidenceId) return;
    event.preventDefault();
    setSelectedEvidenceId(target.dataset.evidenceId);
    setView('evidence');
  }

  async function createRun(event: FormEvent) {
    event.preventDefault();
    const readyIds = new Set(
      documents.filter((doc) => doc.status === 'ready').map((doc) => doc.id),
    );
    if (sourceMode === 'documents_only' && !selectedDocs.some((id) => readyIds.has(id))) {
      setError('Choose at least one indexed document, or include web and scholarly sources.');
      return;
    }
    if (!providers.groq && !providers.gemini) {
      setError(
        'A report model is not configured yet. Ask your administrator to set up Groq or Gemini.',
      );
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{ run: { id: string } }>(`/workspaces/${workspace.id}/runs`, {
        method: 'POST',
        body: JSON.stringify({
          task,
          outputType,
          sourceMode,
          documentIds: selectedDocs,
          agentProviders: providerConfig,
        }),
      });
      setTask('');
      setCreating(false);
      await loadRuns();
      setSelectedId(result.run.id);
      setMessage('Your report is queued. You can follow its progress here.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the report.');
    } finally {
      setBusy(false);
    }
  }
  async function cancelRun() {
    if (!selectedId) return;
    try {
      await api(`/runs/${selectedId}/cancel`, { method: 'POST' });
      await loadDetail(selectedId);
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the report.');
    }
  }
  async function saveDraft() {
    if (!selectedId || !detail) return;
    setBusy(true);
    setError('');
    try {
      await api(`/runs/${selectedId}/drafts`, {
        method: 'POST',
        body: JSON.stringify({ markdown: editorValue }),
      });
      await loadDetail(selectedId);
      await loadDrafts(selectedId);
      setMessage('A new draft version was saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the draft.');
    } finally {
      setBusy(false);
    }
  }
  function downloadMarkdown() {
    const blob = new Blob([editorValue], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(detail?.task || 'scholargraph-report')
      .slice(0, 48)
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="runs-page">
      <section className="runs-sidebar">
        <div className="runs-sidebar-title">
          <div>
            <span className="kicker">YOUR WRITING</span>
            <h2>Reports</h2>
          </div>
          <button onClick={() => setCreating((value) => !value)}>＋ New report</button>
        </div>
        {creating && (
          <form className="new-run-form" onSubmit={createRun}>
            <div className="form-section-intro">
              <strong>Create a report</strong>
              <span>Start with a question you can answer from sources.</span>
            </div>
            <label>
              What do you want to find out?
              <textarea
                required
                minLength={5}
                maxLength={5000}
                value={task}
                onChange={(event) => setTask(event.target.value)}
                placeholder="What should this report investigate?"
              />
            </label>
            <label>
              Report format
              <select value={outputType} onChange={(event) => setOutputType(event.target.value)}>
                <option value="literature_review">Literature review</option>
                <option value="brief">Research brief</option>
                <option value="comparison">Evidence comparison</option>
                <option value="technical_report">Technical report</option>
              </select>
            </label>
            <label>
              Where should we look?
              <select
                value={sourceMode}
                onChange={(event) =>
                  setSourceMode(event.target.value as 'documents_only' | 'documents_web')
                }
              >
                <option value="documents_only">Selected documents</option>
                <option value="documents_web">My documents + web and scholarly sources</option>
              </select>
            </label>
            <div className="run-doc-picker">
              <strong>Use these documents</strong>
              {documents
                .filter((doc) => doc.status === 'ready')
                .map((doc) => (
                  <label key={doc.id}>
                    <input
                      type="checkbox"
                      checked={selectedDocs.includes(doc.id)}
                      onChange={() => {
                        selectedDocsTouched.current = true;
                        setSelectedDocs((ids) =>
                          ids.includes(doc.id)
                            ? ids.filter((id) => id !== doc.id)
                            : [...ids, doc.id],
                        );
                      }}
                    />
                    {doc.name}
                  </label>
                ))}
              {!documents.some((doc) => doc.status === 'ready') && (
                <small>
                  Add a file on the Documents page, or include web and scholarly sources.
                </small>
              )}
            </div>
            <details className="run-provider-settings">
              <summary>Choose models for each step</summary>
              {agents.map((agent) => (
                <label key={agent}>
                  {titles[agent]}
                  <select
                    value={providerConfig[agent] || ''}
                    onChange={(event) =>
                      setProviderConfig((value) => ({ ...value, [agent]: event.target.value }))
                    }
                  >
                    <option value="">Server default</option>
                    {providers.groq && <option value="groq">Groq</option>}
                    {providers.gemini && <option value="gemini">Gemini</option>}
                  </select>
                </label>
              ))}
            </details>
            <button
              className="primary-action"
              disabled={
                busy ||
                task.trim().length < 5 ||
                (!providers.groq && !providers.gemini) ||
                (sourceMode === 'documents_only' &&
                  !documents.some((doc) => doc.status === 'ready' && selectedDocs.includes(doc.id)))
              }
            >
              {busy ? 'Creating report…' : 'Create report'}
              <span>→</span>
            </button>
            <small>
              Reports use four review steps. You can inspect the evidence and edit the draft.
            </small>
            {!providers.groq && !providers.gemini && (
              <small>
                A report model is not available yet. Ask your administrator to set up Groq or
                Gemini.
              </small>
            )}
            {sourceMode === 'documents_only' && selectedDocs.length === 0 && (
              <small>Choose an indexed document or include web and scholarly sources.</small>
            )}
          </form>
        )}
        <div className="run-list-label">
          REPORT HISTORY <span>{runs.length}</span>
        </div>
        {runs.length ? (
          runs.map((run) => (
            <button
              key={run.id}
              className={`run-history-item ${selectedId === run.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(run.id)}
            >
              <span className={`run-state-dot ${run.status}`} />
              <div>
                <strong>{run.task}</strong>
                <small>
                  {statusLabel(run.currentStage || run.status)} ·{' '}
                  {new Date(run.createdAt).toLocaleDateString()}
                </small>
              </div>
              <span className={`run-status-label ${run.status}`}>{statusLabel(run.status)}</span>
            </button>
          ))
        ) : (
          <div className="runs-empty">
            Your reports will appear here. Create one from a question and the sources you want to
            use.
          </div>
        )}
      </section>
      <section className="run-detail-page">
        {error && <div className="inline-error">{error}</div>}
        {message && (
          <div className="inline-success">
            {message}
            <button onClick={() => setMessage('')}>×</button>
          </div>
        )}
        {!detail ? (
          <div className="coming-panel">
            <span className="coming-symbol">↗</span>
            <h2>Start with a question</h2>
            <p>
              Choose your sources and report format. You’ll be able to inspect the evidence and
              revise the draft before exporting it.
            </p>
            <button className="primary-action" onClick={() => setCreating(true)}>
              Create your first report →
            </button>
          </div>
        ) : (
          <>
            <div className="run-detail-heading">
              <div>
                <span className="kicker">
                  {statusLabel(detail.status)} · {statusLabel(detail.currentStage)}
                </span>
                <h2>{detail.task}</h2>
                <p>
                  Source snapshot: {detail.evidence.length} evidence items ·{' '}
                  {detail.sourceWarnings.length} source warnings
                </p>
              </div>
              <div className="run-live-actions">
                {['queued', 'running'].includes(detail.status) && (
                  <span className={`live-update-indicator ${liveUpdates ? 'connected' : ''}`} role="status">
                    <i /> {liveUpdates ? 'Live updates' : 'Reconnecting'}
                  </span>
                )}
                {['queued', 'running'].includes(detail.status) && (
                  <button className="cancel-run" onClick={() => void cancelRun()}>
                    Cancel report
                  </button>
                )}
              </div>
            </div>
            <div className="agent-stage-row">
              {agents.map((agent) => {
                const stage = agentRuns.find((item) => item.agent === agent);
                return (
                  <article key={agent} className={`agent-stage ${stage?.status || 'queued'}`}>
                    <span>
                      {stage?.status === 'completed'
                        ? '✓'
                        : stage?.status === 'running'
                          ? '◌'
                          : stage?.status === 'failed'
                            ? '!'
                            : '·'}
                    </span>
                    <div>
                      <strong>{titles[agent]}</strong>
                      <small>
                        {statusLabel(stage?.status || 'queued')}
                        {stage?.model ? ` · ${stage.model}` : ''}
                      </small>
                    </div>
                  </article>
                );
              })}
            </div>
            {detail.errorMessage && <div className="inline-error">{detail.errorMessage}</div>}
            {detail.sourceWarnings.map((warning) => (
              <div className="source-warning" key={warning}>
                {warning}
              </div>
            ))}
            <nav className="run-detail-tabs">
              {(['report', 'evidence', 'agents', 'history'] as const).map((item) => (
                <button
                  className={view === item ? 'selected' : ''}
                  key={item}
                  onClick={() => setView(item)}
                >
                  {item === 'report'
                    ? 'Report'
                    : item === 'evidence'
                      ? `Evidence (${detail.evidence.length})`
                      : item === 'agents'
                        ? 'Research steps'
                        : 'Version history'}
                </button>
              ))}
            </nav>
            {view === 'report' && (
              <div className="run-report">
                <div className="report-actions">
                  <span>
                    Report · {editorValue.trim() ? editorValue.trim().split(/\s+/).length : 0} words
                  </span>
                  <div>
                    <button onClick={() => setPreview((value) => !value)}>
                      {preview ? 'Edit report' : 'Read view'}
                    </button>
                    <button onClick={downloadMarkdown}>Download Markdown</button>
                    <button onClick={() => window.print()}>Print / save PDF</button>
                    <button
                      className="save-draft"
                      disabled={busy || detail.status !== 'completed'}
                      onClick={() => void saveDraft()}
                    >
                      {busy ? 'Saving…' : 'Save version'}
                    </button>
                  </div>
                </div>
                <div className={`citation-check ${unmatchedCitationIds.length ? 'needs-review' : ''}`}>
                  <strong>
                    {unmatchedCitationIds.length
                      ? `${unmatchedCitationIds.length} source reference${unmatchedCitationIds.length === 1 ? '' : 's'} need review`
                      : citationIds.length
                        ? `${citationIds.length} source reference${citationIds.length === 1 ? '' : 's'} match this report’s evidence`
                        : 'No source references in this draft'}
                  </strong>
                  <span>
                    Reference IDs are checked automatically. Open each passage to confirm it supports
                    the surrounding claim.
                  </span>
                  {unmatchedCitationIds.length > 0 && (
                    <button onClick={() => setView('evidence')}>Review evidence</button>
                  )}
                </div>
                {preview ? (
                  <article
                    className="markdown-preview print-report"
                    onClick={openCitation}
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                ) : (
                  <textarea
                    className="run-markdown-editor"
                    value={editorValue}
                    onChange={(event) => setEditorValue(event.target.value)}
                    placeholder={
                      detail.status === 'completed'
                        ? 'The Final Editor draft will appear here.'
                        : 'The report appears when the Final Editor completes.'
                    }
                  />
                )}
                <p className="review-note">
                  In read view, select a source reference to open its exact passage. A matching ID
                  confirms the source exists; review the passage before relying on the claim.
                </p>
              </div>
            )}
            {view === 'evidence' && (
              <div className="run-evidence-list">
                {detail.evidence.length ? (
                  detail.evidence.map((item) => (
                    <article
                      id={`evidence-${item.id}`}
                      key={item.id}
                      className={selectedEvidenceId === item.id ? 'evidence-selected' : ''}
                      aria-current={selectedEvidenceId === item.id ? 'true' : undefined}
                    >
                      <header>
                        <strong>{item.id}</strong>
                        <span>
                          {item.sourceType === 'uploaded_document'
                            ? 'Your document'
                            : item.sourceType === 'academic_record'
                              ? `${item.sourceProvider || 'Scholarly source'} · ${item.contentCoverage || 'metadata only'}`
                              : 'Web source'}
                        </span>
                      </header>
                      <h3>
                        {item.document}
                        {item.publishedAt ? ` · ${item.publishedAt}` : ''}
                        {item.page ? ` · page ${item.page}` : ''}
                        {item.section ? ` · ${item.section}` : ''}
                      </h3>
                      <blockquote>{item.excerpt}</blockquote>
                      {(item.contentCoverage || item.doi) && (
                        <small className="evidence-coverage">
                          {coverageLabel(item.contentCoverage)}
                          {item.doi ? ` · DOI ${item.doi}` : ''}
                        </small>
                      )}
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noreferrer">
                          Open source ↗
                        </a>
                      )}
                    </article>
                  ))
                ) : (
                  <p className="no-sources">No evidence was retrieved for this run.</p>
                )}
              </div>
            )}
            {view === 'agents' && (
              <div className="agent-output-list">
                {agents.map((agent) => {
                  const stage = agentRuns.find((item) => item.agent === agent);
                  return (
                    <article key={agent}>
                      <header>
                        <div>
                          <span className="kicker">{titles[agent].toUpperCase()}</span>
                          <strong>
                            {statusLabel(stage?.status || 'queued')}{' '}
                            {stage?.provider && `· ${stage.provider} ${stage.model}`}
                          </strong>
                        </div>
                        <span>Prompt v{detail.promptSnapshots[agent]?.version || 1}</span>
                      </header>
                      <pre>{stage?.output || 'No output has been saved for this stage yet.'}</pre>
                    </article>
                  );
                })}
              </div>
            )}
            {view === 'history' && (
              <div className="draft-history">
                {drafts.length ? (
                  drafts.map((draft) => (
                    <article key={draft.id}>
                      <div>
                        <strong>Version {draft.version}</strong>
                        <span>
                          Saved by {draft.createdBy} · {new Date(draft.createdAt).toLocaleString()}
                        </span>
                        <small>{draft.changeSummary}</small>
                      </div>
                      <button
                        onClick={() => {
                          setEditorValue(draft.markdown);
                          setPreview(false);
                          setView('report');
                        }}
                      >
                        Restore this version
                      </button>
                    </article>
                  ))
                ) : (
                  <p className="no-sources">No saved draft versions.</p>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
