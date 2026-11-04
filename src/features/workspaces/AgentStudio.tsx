import { useEffect, useState } from 'react';
import { api, Workspace } from '../../lib/api';
import './AgentStudio.css';

type AgentName = 'researcher' | 'writer' | 'critic' | 'editor';
type PromptItem = { agent: AgentName; prompt: string; version: number; isDefault: boolean };
type PromptVersion = { version: number; prompt: string; changeNote: string; createdAt: string };
const labels: Record<AgentName, string> = {
  researcher: 'Find evidence',
  writer: 'Draft report',
  critic: 'Check claims',
  editor: 'Edit report',
};
const roles: AgentName[] = ['researcher', 'writer', 'critic', 'editor'];

export default function AgentStudio({ workspace }: { workspace: Workspace }) {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [agent, setAgent] = useState<AgentName>('researcher');
  const [draft, setDraft] = useState('');
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const current = prompts.find((item) => item.agent === agent);

  async function load() {
    setLoading(true);
    try {
      const result = await api<{ prompts: PromptItem[] }>(`/workspaces/${workspace.id}/prompts`);
      setPrompts(result.prompts);
      const selected = result.prompts.find((item) => item.agent === agent);
      if (selected) setDraft(selected.prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load prompts.');
    } finally {
      setLoading(false);
    }
  }
  async function loadVersions(role = agent) {
    try {
      const result = await api<{ versions: PromptVersion[] }>(
        `/workspaces/${workspace.id}/prompts/${role}/versions`,
      );
      setVersions(result.versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load prompt history.');
    }
  }
  useEffect(() => {
    void load();
  }, [workspace.id]);
  useEffect(() => {
    const selected = prompts.find((item) => item.agent === agent);
    setDraft(selected?.prompt || '');
    setSelectedVersion(null);
    void loadVersions(agent);
  }, [agent, prompts]);

  async function save() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/workspaces/${workspace.id}/prompts/${agent}`, {
        method: 'PATCH',
        body: JSON.stringify({ prompt: draft, changeNote }),
      });
      setChangeNote('');
      setMessage('A new prompt version was saved.');
      await load();
      await loadVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save prompt.');
    } finally {
      setBusy(false);
    }
  }
  async function restore(version: number) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/workspaces/${workspace.id}/prompts/${agent}/restore/${version}`, {
        method: 'POST',
      });
      setMessage(`Restored version ${version} as a new active version.`);
      await load();
      await loadVersions();
      setSelectedVersion(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to restore prompt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="agent-studio-page">
      <div className="studio-layout-new">
        <aside className="studio-agent-list">
          {roles.map((role, index) => (
            <button
              key={role}
              className={agent === role ? 'selected' : ''}
              onClick={() => setAgent(role)}
            >
              <span>0{index + 1}</span>
              <div>
                <strong>{labels[role]}</strong>
                <small>
                  {
                    [
                      'Find and organize sources',
                      'Write a first draft',
                      'Check claims against sources',
                      'Improve clarity and accuracy',
                    ][index]
                  }
                </small>
              </div>
              <i>›</i>
            </button>
          ))}
        </aside>
        <section className="studio-edit-panel">
          <div className="studio-panel-head">
            <div>
              <span className="kicker">REPORT INSTRUCTIONS</span>
              <h2>{labels[agent]}</h2>
              <p>Changes apply to new reports. Each report keeps its own saved copy.</p>
            </div>
            <span className="version-pill">
              v{current?.version || 1}
              {current?.isDefault ? ' · default' : ' · active'}
            </span>
          </div>
          {(error || message) && (
            <div className={error ? 'inline-error' : 'inline-success'} role="status">
              {error || message}
            </div>
          )}
          {loading ? (
            <div className="document-empty">Loading prompt…</div>
          ) : (
            <>
              <div className="prompt-boundary-note">
                <strong>Sources remain the basis for each report.</strong>
                <span>
                  These instructions guide how evidence is organized and written. They do not change
                  which workspaces or files can be accessed.
                </span>
              </div>
              <textarea
                className="agent-prompt-textarea"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={12000}
                aria-label={`${labels[agent]} system prompt`}
              />
              <div className="prompt-footer">
                <span>{draft.length.toLocaleString()} / 12,000 characters</span>
                <span>{versions.length} saved versions</span>
              </div>
              <div className="prompt-actions-new">
                <input
                  value={changeNote}
                  onChange={(event) => setChangeNote(event.target.value)}
                  maxLength={300}
                  placeholder="What changed? (optional)"
                />
                <button
                  className="primary-action"
                  disabled={busy || draft.trim().length < 20}
                  onClick={() => void save()}
                >
                  {busy ? 'Saving…' : 'Save new version'}
                  <span>→</span>
                </button>
              </div>
            </>
          )}
          <div className="prompt-history">
            <div>
              <h3>Version history</h3>
              <small>
                Restoring a version saves it as a new version, keeping earlier reports intact.
              </small>
            </div>
            {versions.length ? (
              versions.map((version) => (
                <article key={version.version} className="prompt-version-row">
                  <div>
                    <strong>v{version.version}</strong>
                    <span>
                      {version.changeNote || 'Instruction update'} ·{' '}
                      {new Date(version.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setDraft(version.prompt);
                      setSelectedVersion(version.version);
                    }}
                  >
                    View
                  </button>
                  <button disabled={busy} onClick={() => void restore(version.version)}>
                    Restore
                  </button>
                </article>
              ))
            ) : (
              <p className="no-sources">
                No custom versions yet. The built-in prompt remains active until you save one.
              </p>
            )}
            {selectedVersion !== null && (
              <div className="version-preview">
                <strong>Previewing v{selectedVersion}</strong>
                <pre>{draft}</pre>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
