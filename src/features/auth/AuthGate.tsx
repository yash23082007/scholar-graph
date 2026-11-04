import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, AuthResponse, User, Workspace } from '../../lib/api';
import ScholarGraphMark from '../../components/ScholarGraphMark';
import WorkspaceView from '../workspaces/WorkspaceView';

type Mode = 'login' | 'register';

export default function AuthGate() {
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [mode, setMode] = useState<Mode>('register');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<AuthResponse>('/auth/session')
      .then((result) => {
        setUser(result.user);
        setWorkspaces(result.workspaces);
      })
      .catch((err: unknown) => {
        if (
          !(err instanceof ApiError) ||
          !['UNAUTHENTICATED', 'SESSION_EXPIRED'].includes(err.code)
        ) {
          setError(err instanceof Error ? err.message : 'Unable to load your session.');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    const data = new FormData(event.currentTarget);
    const payload = Object.fromEntries(data.entries());
    if (!payload.workspaceName) delete payload.workspaceName;
    try {
      const result = await api<AuthResponse>(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setUser(result.user);
      setWorkspaces(result.workspaces);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
    setWorkspaces([]);
    setMode('login');
  }

  function updateWorkspaces(next: Workspace[]) {
    setWorkspaces(next);
  }

  if (loading)
    return (
      <main className="auth-loading">
        <div className="brand-lockup">
          <ScholarGraphMark className="brand-symbol" />
          <span>
            Scholar<span>Graph</span>
          </span>
        </div>
        <p>Restoring your research workspace…</p>
      </main>
    );
  if (user)
    return (
      <WorkspaceShell
        user={user}
        workspaces={workspaces}
        onWorkspaces={updateWorkspaces}
        onLogout={logout}
      />
    );

  return (
    <main className="auth-screen">
      <section className="auth-story">
        <a className="brand-lockup" href="/">
          <ScholarGraphMark className="brand-symbol" />
          <span>
            Scholar<span>Graph</span>
          </span>
        </a>
        <div className="story-copy">
          <span className="kicker">A WORKSPACE FOR CAREFUL RESEARCH</span>
          <h1>
            Keep the source close.
            <br />
            <em>Make every claim traceable.</em>
          </h1>
          <p>
            Bring papers and notes into one place. Read the evidence in context, then shape your
            findings into work you can review and revise.
          </p>
          <div className="story-points">
            <span>
              <i>01</i> Read across your documents
            </span>
            <span>
              <i>02</i> Inspect every cited passage
            </span>
            <span>
              <i>03</i> Keep a working history
            </span>
          </div>
        </div>
        <div className="auth-foot">ScholarGraph · Built by Yash</div>
      </section>
      <section className="auth-panel-wrap">
        <div className="auth-panel">
          <div className="auth-heading">
            <span className="kicker">{mode === 'register' ? 'GET STARTED' : 'WELCOME BACK'}</span>
            <h2>{mode === 'register' ? 'Create your workspace' : 'Sign in to ScholarGraph'}</h2>
            <p>
              {mode === 'register'
                ? 'Start a private research space for your sources and notes.'
                : 'Continue with your research and saved workspaces.'}
            </p>
          </div>
          {error && (
            <div className="form-error" role="alert">
              <strong>Could not continue</strong>
              <span>{error}</span>
              {error.includes('MONGODB_URI') && (
                <small>
                  Start MongoDB and set MONGODB_URI in the server environment, then restart the API.
                </small>
              )}
            </div>
          )}
          <form onSubmit={submit} className="auth-form">
            {mode === 'register' && (
              <label>
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={80}
                  placeholder="Alex Morgan"
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                maxLength={254}
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'register' ? 12 : 1}
                maxLength={128}
                placeholder={mode === 'register' ? 'At least 12 characters' : 'Your password'}
              />
            </label>
            {mode === 'register' && (
              <label>
                Workspace name <span className="optional">optional</span>
                <input name="workspaceName" maxLength={100} placeholder="My research" />
              </label>
            )}
            <button className="primary-action" type="submit" disabled={submitting}>
              {submitting ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
              <span>→</span>
            </button>
          </form>
          <div className="auth-switch">
            {mode === 'register' ? 'Already have an account?' : 'New to ScholarGraph?'}{' '}
            <button
              onClick={() => {
                setError('');
                setMode(mode === 'register' ? 'login' : 'register');
              }}
            >
              {' '}
              {mode === 'register' ? 'Sign in' : 'Create an account'}
            </button>
          </div>
          <p className="auth-privacy">
            Your account and workspaces are private. Provider integrations are configured by the
            server administrator.
          </p>
        </div>
      </section>
    </main>
  );
}

function WorkspaceShell({
  user,
  workspaces,
  onWorkspaces,
  onLogout,
}: {
  user: User;
  workspaces: Workspace[];
  onWorkspaces: (items: Workspace[]) => void;
  onLogout: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);

  async function refresh() {
    const result = await api<{ workspaces: Workspace[] }>('/workspaces');
    onWorkspaces(result.workspaces);
  }
  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await api('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name, description }),
      });
      setName('');
      setDescription('');
      await refresh();
      setNotice('Workspace created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create workspace.');
    } finally {
      setPending(false);
    }
  }
  async function rename(workspace: Workspace) {
    const next = window.prompt('Workspace name', workspace.name);
    if (next === null || !next.trim()) return;
    try {
      await api(`/workspaces/${workspace.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: next.trim() }),
      });
      await refresh();
      setNotice('Workspace updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update workspace.');
    }
  }
  async function remove(workspace: Workspace) {
    if (!window.confirm(`Delete “${workspace.name}”? This removes the workspace record.`)) return;
    try {
      await api(`/workspaces/${workspace.id}`, { method: 'DELETE' });
      await refresh();
      setNotice('Workspace deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete workspace.');
    }
  }

  if (activeWorkspace)
    return (
      <WorkspaceView
        workspace={activeWorkspace}
        user={user}
        onBack={() => {
          setActiveWorkspace(null);
          void refresh();
        }}
      />
    );

  return (
    <main className="home-screen">
      <header className="home-header">
        <a className="brand-lockup" href="/">
          <ScholarGraphMark className="brand-symbol" />
          <span>
            Scholar<span>Graph</span>
          </span>
        </a>
        <div className="account-menu">
          <span className="account-avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </span>
          <button onClick={() => void onLogout()}>Sign out</button>
        </div>
      </header>
      <div className="home-content">
        <section className="home-intro">
          <div>
            <span className="kicker">YOUR RESEARCH DESK</span>
            <h1>Welcome back, {user.name.split(' ')[0]}.</h1>
            <p>Pick up where you left off, or open a workspace to continue reading.</p>
          </div>
          <div className="home-mark">
            01<span>/</span> workspace hub
          </div>
        </section>
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
        <div className="workspace-section-head">
          <div>
            <h2>Your workspaces</h2>
            <p>
              {workspaces.length} {workspaces.length === 1 ? 'workspace' : 'workspaces'} · private
              to your account
            </p>
          </div>
          <span className="secure-label">
            <i /> Private
          </span>
        </div>
        {workspaces.length ? (
          <div className="workspace-grid">
            {workspaces.map((workspace, index) => (
              <article className="workspace-card" key={workspace.id}>
                <div className="workspace-card-top">
                  <span className={`workspace-icon tone-${index % 3}`}>0{index + 1}</span>
                  <button
                    className="more-menu"
                    aria-label={`Options for ${workspace.name}`}
                    onClick={() => void rename(workspace)}
                  >
                    ···
                  </button>
                </div>
                <h3>{workspace.name}</h3>
                <p>
                  {workspace.description ||
                    'A private space for your research sources and working notes.'}
                </p>
                <div className="workspace-card-footer">
                  <span>
                    Created{' '}
                    {workspace.createdAt
                      ? new Date(workspace.createdAt).toLocaleDateString()
                      : 'recently'}
                  </span>
                  <div className="workspace-card-links">
                    <button
                      className="open-workspace-link"
                      onClick={() => setActiveWorkspace(workspace)}
                    >
                      Open →
                    </button>
                    <button className="danger-link" onClick={() => void remove(workspace)}>
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-workspaces">
            <span className="empty-mark">＋</span>
            <h3>Your research starts with a workspace</h3>
            <p>Make a separate space for each topic, project or document collection.</p>
          </div>
        )}
        <form className="create-workspace" onSubmit={createWorkspace}>
          <div>
            <span className="kicker">START ANOTHER PROJECT</span>
            <h3>Create a workspace</h3>
            <p>Each workspace keeps its sources and runs together.</p>
          </div>
          <div className="create-fields">
            <input
              aria-label="Workspace name"
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Climate policy review"
            />
            <input
              aria-label="Description (optional)"
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description (optional)"
            />
            <button className="primary-action" disabled={pending}>
              {pending ? 'Creating…' : 'Create workspace'}
              <span>→</span>
            </button>
          </div>
        </form>
        <footer className="product-credit">ScholarGraph · Built by Yash</footer>
      </div>
    </main>
  );
}
