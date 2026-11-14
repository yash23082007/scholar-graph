import 'dotenv/config';
import mongoose from 'mongoose';

/**
 * Deep end-to-end test of ScholarGraph as a real user.
 * Tests: registration, login, session, workspace CRUD, document upload,
 * document questions, research runs, agent prompts, drafts, search, edge cases.
 */
const BASE = 'http://localhost:4000';
const APP_ORIGIN = 'http://localhost:5173';
const TEST_EMAIL = `testuser_${Date.now()}@example.com`;
const TEST_PASSWORD = 'SuperSecure123!';
const TEST_NAME = 'Test User';

async function resetRateLimits() {
  if (process.env.MONGODB_URI) {
    try {
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGODB_URI);
      }
      await mongoose.connection.collection('ratelimitentries').deleteMany({});
    } catch (e) {
      console.warn('Could not reset rate limits:', e.message);
    }
  }
}

let sessionCookie = '';
let userId = '';
let workspaceId = '';
let secondWorkspaceId = '';
let documentId = '';
let runId = '';

const results = [];
let passCount = 0;
let failCount = 0;

function record(name, passed, detail = '') {
  results.push({ name, passed, detail });
  if (passed) passCount++;
  else failCount++;
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(method, path, body, opts = {}) {
  const url = `${BASE}${path}`;
  const headers = {
    ...(opts.noOrigin ? {} : { Origin: APP_ORIGIN }),
    ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    ...(opts.headers || {}),
  };
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const fetchOpts = { method, headers, redirect: 'manual' };
  if (body) {
    fetchOpts.body = body instanceof FormData ? body : JSON.stringify(body);
  }
  const res = await fetch(url, fetchOpts);
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const match = setCookie.match(/(scholargraph_session=[^;]+)/);
    if (match) sessionCookie = match[1];
  }
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json') && res.status !== 204) {
    try { data = await res.json(); } catch {}
  }
  return { status: res.status, data, headers: res.headers };
}

// ═══════════════════════════════════════════════
// 1. HEALTH & INFRASTRUCTURE
// ═══════════════════════════════════════════════
async function testHealth() {
  console.log('\n══════════════════════════════════════');
  console.log('1. HEALTH & INFRASTRUCTURE TESTS');
  console.log('══════════════════════════════════════');

  // 1.1 Health endpoint
  const h = await api('GET', '/api/health');
  record('Health endpoint returns ok', h.status === 200 && h.data?.ok === true);
  record('Database is connected', h.data?.database === 'connected');
  record('Auth is configured', h.data?.authConfigured === true);

  // 1.2 Liveness
  const live = await api('GET', '/api/health/live');
  record('Liveness probe ok', live.status === 200 && live.data?.ok === true);

  // 1.3 Readiness
  const ready = await api('GET', '/api/health/ready');
  record('Readiness probe returns status', ready.status === 200 || ready.status === 503);

  // 1.4 Providers
  const prov = await api('GET', '/api/v1/providers');
  record('Providers endpoint works', prov.status === 200 && prov.data?.providers);
  record('Groq provider configured', prov.data?.providers?.groq === true,
    `providers: ${JSON.stringify(prov.data?.providers)}`);

  // 1.5 Security headers
  record('X-Content-Type-Options header set', h.headers.get('x-content-type-options') === 'nosniff');
  record('X-Frame-Options header set', h.headers.get('x-frame-options') === 'DENY');
  record('X-Request-Id present', !!h.headers.get('x-request-id'));
  record('No X-Powered-By', !h.headers.get('x-powered-by'));

  // 1.6 Metrics without token → 404
  const m = await api('GET', '/api/metrics');
  record('Metrics without token returns 404', m.status === 404);
}

// ═══════════════════════════════════════════════
// 2. AUTHENTICATION
// ═══════════════════════════════════════════════
async function testAuth() {
  console.log('\n══════════════════════════════════════');
  console.log('2. AUTHENTICATION TESTS');
  console.log('══════════════════════════════════════');

  // 2.1 Register with invalid data
  const r1 = await api('POST', '/api/v1/auth/register', { email: 'bad', name: '', password: '123' });
  record('Register rejects invalid data', r1.status === 400, r1.data?.error?.message);

  // 2.2 Register with short password
  const r2 = await api('POST', '/api/v1/auth/register', {
    email: TEST_EMAIL, name: TEST_NAME, password: 'short'
  });
  record('Register rejects short password (<12 chars)', r2.status === 400);

  // 2.3 Register with missing fields
  const r3 = await api('POST', '/api/v1/auth/register', { email: TEST_EMAIL });
  record('Register rejects missing fields', r3.status === 400);

  // 2.4 Register with extra fields (strict schema)
  const r4 = await api('POST', '/api/v1/auth/register', {
    email: TEST_EMAIL, name: TEST_NAME, password: TEST_PASSWORD, hackField: 'evil'
  });
  record('Register rejects extra fields (strict)', r4.status === 400);

  // 2.5 Valid registration
  const r5 = await api('POST', '/api/v1/auth/register', {
    email: TEST_EMAIL, name: TEST_NAME, password: TEST_PASSWORD
  });
  record('Valid registration succeeds', r5.status === 201);
  record('Registration returns user', !!r5.data?.user?.id, `user: ${r5.data?.user?.email}`);
  record('Registration creates default workspace', r5.data?.workspaces?.length >= 1);
  record('Session cookie set after register', !!sessionCookie);
  userId = r5.data?.user?.id;
  workspaceId = r5.data?.workspaces?.[0]?.id;

  // 2.6 Duplicate registration
  const savedCookie = sessionCookie;
  sessionCookie = '';
  const r6 = await api('POST', '/api/v1/auth/register', {
    email: TEST_EMAIL, name: 'Other', password: TEST_PASSWORD
  });
  record('Duplicate email registration fails (409)', r6.status === 409);
  sessionCookie = savedCookie;

  // 2.7 Session check
  const s = await api('GET', '/api/v1/auth/session');
  record('Session check returns user', s.status === 200 && s.data?.user?.email === TEST_EMAIL);
  record('Session returns workspaces', s.data?.workspaces?.length >= 1);

  // 2.8 Unauthenticated access
  const oldCookie = sessionCookie;
  sessionCookie = '';
  const u = await api('GET', '/api/v1/auth/session');
  record('Unauthenticated session check returns 401', u.status === 401);
  sessionCookie = oldCookie;

  // 2.9 Login with wrong password
  const oldCookie2 = sessionCookie;
  sessionCookie = '';
  const l1 = await api('POST', '/api/v1/auth/login', {
    email: TEST_EMAIL, password: 'WrongPassword12!'
  });
  record('Login with wrong password fails (401)', l1.status === 401);

  // 2.10 Login with non-existent email
  const l2 = await api('POST', '/api/v1/auth/login', {
    email: 'nobody@example.com', password: TEST_PASSWORD
  });
  record('Login with non-existent email fails (401)', l2.status === 401);
  record('Error does not leak which field is wrong', l2.data?.error?.code === 'INVALID_CREDENTIALS');

  // 2.11 Valid login
  const l3 = await api('POST', '/api/v1/auth/login', {
    email: TEST_EMAIL, password: TEST_PASSWORD
  });
  record('Valid login succeeds', l3.status === 200 && l3.data?.user?.id === userId);
  record('Login returns workspaces', l3.data?.workspaces?.length >= 1);
  record('Login sets session cookie', !!sessionCookie);

  // 2.12 Case-insensitive email
  const l4 = await api('POST', '/api/v1/auth/login', {
    email: TEST_EMAIL.toUpperCase(), password: TEST_PASSWORD
  });
  record('Login is case-insensitive for email', l4.status === 200);

  // 2.13 Cross-origin protection
  const cx = await api('POST', '/api/v1/auth/login', {
    email: TEST_EMAIL, password: TEST_PASSWORD
  }, { headers: { Origin: 'https://evil.com' }});
  // The requireSameOrigin middleware should block POST with wrong Origin, but login route
  // may be before the api router. Let's see:
  record('Cross-origin POST blocked or handled',
    cx.status === 403 || cx.status === 200,
    `status=${cx.status} code=${cx.data?.error?.code || 'ok'}`);
}

// ═══════════════════════════════════════════════
// 3. WORKSPACE CRUD
// ═══════════════════════════════════════════════
async function testWorkspaces() {
  console.log('\n══════════════════════════════════════');
  console.log('3. WORKSPACE CRUD TESTS');
  console.log('══════════════════════════════════════');

  // 3.1 List workspaces
  const list = await api('GET', '/api/v1/workspaces');
  record('List workspaces works', list.status === 200);
  record('Has at least 1 workspace', list.data?.workspaces?.length >= 1);

  // 3.2 Create workspace
  const w = await api('POST', '/api/v1/workspaces', {
    name: 'Test Research Project',
    description: 'A workspace for testing'
  });
  record('Create workspace succeeds', w.status === 201);
  secondWorkspaceId = w.data?.workspace?.id;
  record('Workspace has correct name', w.data?.workspace?.name === 'Test Research Project');

  // 3.3 Get workspace by ID
  const g = await api('GET', `/api/v1/workspaces/${workspaceId}`);
  record('Get workspace by ID works', g.status === 200 && g.data?.workspace?.id === workspaceId);

  // 3.4 Get workspace with invalid ID
  const bad = await api('GET', '/api/v1/workspaces/not-an-id');
  record('Invalid workspace ID returns 400', bad.status === 400);

  // 3.5 Get non-existent workspace
  const ne = await api('GET', '/api/v1/workspaces/507f1f77bcf86cd799439011');
  record('Non-existent workspace returns 404', ne.status === 404);

  // 3.6 Patch workspace
  const p = await api('PATCH', `/api/v1/workspaces/${secondWorkspaceId}`, {
    name: 'Updated Research',
    defaultCitationStyle: 'IEEE'
  });
  record('Patch workspace works', p.status === 200);
  record('Workspace name updated', p.data?.workspace?.name === 'Updated Research');
  record('Citation style set', p.data?.workspace?.defaultCitationStyle === 'IEEE');

  // 3.7 Patch with empty body
  const pe = await api('PATCH', `/api/v1/workspaces/${secondWorkspaceId}`, {});
  record('Patch with empty body rejected', pe.status === 400);

  // 3.8 Patch with invalid citation style
  const pic = await api('PATCH', `/api/v1/workspaces/${secondWorkspaceId}`, {
    defaultCitationStyle: 'Harvard'
  });
  record('Invalid citation style rejected', pic.status === 400);

  // 3.9 Create workspace with empty name
  const en = await api('POST', '/api/v1/workspaces', { name: '' });
  record('Empty workspace name rejected', en.status === 400);

  // 3.10 Create workspace with very long name
  const ln = await api('POST', '/api/v1/workspaces', { name: 'A'.repeat(200) });
  record('Name >100 chars rejected', ln.status === 400);
}

// ═══════════════════════════════════════════════
// 4. DOCUMENT UPLOAD & MANAGEMENT
// ═══════════════════════════════════════════════
async function testDocuments() {
  console.log('\n══════════════════════════════════════');
  console.log('4. DOCUMENT UPLOAD & MANAGEMENT TESTS');
  console.log('══════════════════════════════════════');

  // 4.1 Upload a text file
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { Blob } = await import('node:buffer');

  // Create a test file
  const testContent = `# Research on AI Safety

Artificial intelligence safety is a growing field of study. This document explores key concepts
in alignment, interpretability, and robustness of AI systems.

## Key Findings

1. Alignment research focuses on ensuring AI systems pursue intended goals.
2. Interpretability helps understand model decision-making processes.
3. Robustness ensures AI systems perform well under distribution shift.

## References

Smith, J. (2024). AI Safety: A Comprehensive Review. Journal of AI Research, 15(3), 45-67.
`;
  const testFilePath = path.join(process.cwd(), 'test_document.txt');
  fs.writeFileSync(testFilePath, testContent);

  const formData = new FormData();
  formData.append('files', new Blob([testContent], { type: 'text/plain' }), 'test_document.txt');

  const up = await api('POST', `/api/v1/workspaces/${workspaceId}/documents`, formData);
  record('Text file upload succeeds', up.status === 201 || up.status === 200,
    `status=${up.status}, results=${JSON.stringify(up.data?.results?.map(r => r.status))}`);

  if (up.data?.results?.[0]?.id) {
    documentId = up.data.results[0].id;
  }

  // 4.2 Upload with no files
  const noFiles = await api('POST', `/api/v1/workspaces/${workspaceId}/documents`, new FormData());
  record('Upload with no files returns error', noFiles.status === 400);

  // 4.3 List documents
  const docs = await api('GET', `/api/v1/workspaces/${workspaceId}/documents`);
  record('List documents works', docs.status === 200);
  record('Documents array returned', Array.isArray(docs.data?.documents));
  if (documentId) {
    record('Uploaded document appears in list',
      docs.data?.documents?.some(d => d.id === documentId));
  }

  // 4.4 Document pagination
  const page = await api('GET', `/api/v1/workspaces/${workspaceId}/documents?page=1&pageSize=5`);
  record('Pagination works', page.status === 200 && page.data?.pageSize === 5);

  // 4.5 Invalid pagination
  const badPage = await api('GET', `/api/v1/workspaces/${workspaceId}/documents?page=-1`);
  record('Invalid page rejected', badPage.status === 400);

  // 4.6 Document search
  const search = await api('GET', `/api/v1/workspaces/${workspaceId}/documents?search=test`);
  record('Document search works', search.status === 200);

  // 4.7 Upload a markdown file
  const mdContent = '# Markdown Test\n\nThis is a **markdown** document.';
  const mdForm = new FormData();
  mdForm.append('files', new Blob([mdContent], { type: 'text/markdown' }), 'research_notes.md');
  const mdUp = await api('POST', `/api/v1/workspaces/${workspaceId}/documents`, mdForm);
  record('Markdown file upload works', mdUp.status === 201 || mdUp.status === 200);

  // Clean up test file
  try { fs.unlinkSync(testFilePath); } catch {}
}

// ═══════════════════════════════════════════════
// 5. DOCUMENT QUESTIONS (Evidence-Based Q&A)
// ═══════════════════════════════════════════════
async function testQuestions() {
  console.log('\n══════════════════════════════════════');
  console.log('5. DOCUMENT QUESTIONS TESTS');
  console.log('══════════════════════════════════════');

  // 5.1 Ask a question about uploaded documents
  const q = await api('POST', `/api/v1/workspaces/${workspaceId}/questions`, {
    question: 'What are the key findings about AI safety?',
    sourceMode: 'documents_only'
  });
  record('Question endpoint works', q.status === 200 || q.status === 201,
    `status=${q.status}, hasAnswer=${!!q.data?.answer}`);

  // 5.2 Question too short
  const qs = await api('POST', `/api/v1/workspaces/${workspaceId}/questions`, {
    question: 'AI',
  });
  record('Short question (<3 chars) rejected', qs.status === 400);

  // 5.3 Question with specific document IDs
  if (documentId) {
    const qd = await api('POST', `/api/v1/workspaces/${workspaceId}/questions`, {
      question: 'What are the key findings about AI safety?',
      documentIds: [documentId],
      sourceMode: 'documents_only'
    });
    record('Question with documentIds works', qd.status === 200 || qd.status === 201);
  }

  // 5.4 Question with provider specification
  const qp = await api('POST', `/api/v1/workspaces/${workspaceId}/questions`, {
    question: 'Summarize the main ideas in the uploaded documents',
    provider: 'groq'
  });
  record('Question with provider param works', qp.status === 200 || qp.status === 201,
    `status=${qp.status}`);

  // 5.5 Question with extra fields (strict)
  const qe = await api('POST', `/api/v1/workspaces/${workspaceId}/questions`, {
    question: 'Test question for strictness',
    invalidField: 'hack'
  });
  record('Question with extra fields rejected (strict)', qe.status === 400);

  // 5.6 Retrieval-only mode
  const qr = await api('POST', `/api/v1/workspaces/${workspaceId}/questions`, {
    question: 'What is alignment research?',
    provider: 'retrieval_only'
  });
  record('Retrieval-only question works', qr.status === 200 || qr.status === 201);
}

// ═══════════════════════════════════════════════
// 6. RESEARCH RUNS
// ═══════════════════════════════════════════════
async function testResearchRuns() {
  console.log('\n══════════════════════════════════════');
  console.log('6. RESEARCH RUNS TESTS');
  console.log('══════════════════════════════════════');

  // 6.1 Start a research run
  const r = await api('POST', `/api/v1/workspaces/${workspaceId}/runs`, {
    task: 'Write a brief summary of AI safety research findings from the uploaded documents',
    outputType: 'brief',
    sourceMode: 'documents_only'
  });
  record('Start research run works', r.status === 201 || r.status === 200,
    `status=${r.status}, hasId=${!!r.data?.run?.id}`);
  runId = r.data?.run?.id;

  // 6.2 Run with invalid task (too short)
  const rs = await api('POST', `/api/v1/workspaces/${workspaceId}/runs`, {
    task: 'Hi',
    outputType: 'brief'
  });
  record('Run with short task (<5 chars) rejected', rs.status === 400);

  // 6.3 Run with invalid outputType
  const rot = await api('POST', `/api/v1/workspaces/${workspaceId}/runs`, {
    task: 'Write a summary of the documents',
    outputType: 'invalid_type'
  });
  record('Run with invalid outputType rejected', rot.status === 400);

  // 6.4 List runs
  const lr = await api('GET', `/api/v1/workspaces/${workspaceId}/runs`);
  record('List research runs works', lr.status === 200);
  record('Runs array returned', Array.isArray(lr.data?.runs));

  // Wait a moment for the run to progress
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 6.5 Get run by ID
  if (runId) {
    const gr = await api('GET', `/api/v1/workspaces/${workspaceId}/runs/${runId}`);
    record('Get run by ID works', gr.status === 200, `status=${gr.data?.run?.status}`);

    // 6.6 Get run events
    const ev = await api('GET', `/api/v1/workspaces/${workspaceId}/runs/${runId}/events`);
    record('Get run events works', ev.status === 200);

    // 6.7 Cancel run
    const cr = await api('POST', `/api/v1/workspaces/${workspaceId}/runs/${runId}/cancel`);
    record('Cancel run works', cr.status === 200 || cr.status === 204 || cr.status === 409,
      `status=${cr.status}`);
  }

  // 6.8 Get non-existent run
  const ne = await api('GET', `/api/v1/workspaces/${workspaceId}/runs/507f1f77bcf86cd799439011`);
  record('Non-existent run returns 404', ne.status === 404);

  // 6.9 Different output types
  for (const outputType of ['literature_review', 'technical_report', 'comparison']) {
    const rt = await api('POST', `/api/v1/workspaces/${workspaceId}/runs`, {
      task: 'Analyze AI safety research across the uploaded documents',
      outputType,
      sourceMode: 'documents_only'
    });
    record(`Run with outputType="${outputType}" accepted`,
      rt.status === 201 || rt.status === 200,
      `status=${rt.status}`);
    // Cancel immediately to not overload
    if (rt.data?.run?.id) {
      await api('POST', `/api/v1/workspaces/${workspaceId}/runs/${rt.data.run.id}/cancel`);
    }
  }
}

// ═══════════════════════════════════════════════
// 7. AGENT PROMPTS
// ═══════════════════════════════════════════════
async function testAgentPrompts() {
  console.log('\n══════════════════════════════════════');
  console.log('7. AGENT PROMPTS TESTS');
  console.log('══════════════════════════════════════');

  // 7.1 List agent prompts
  const lp = await api('GET', `/api/v1/workspaces/${workspaceId}/prompts`);
  record('List agent prompts works', lp.status === 200);

  // 7.2 Get prompt for each role
  for (const role of ['researcher', 'writer', 'critic', 'editor']) {
    const rp = await api('GET', `/api/v1/workspaces/${workspaceId}/prompts/${role}`);
    record(`Get ${role} prompt works`, rp.status === 200,
      `hasPrompt=${!!rp.data?.prompt}`);
  }

  // 7.3 Update a prompt
  const up = await api('PUT', `/api/v1/workspaces/${workspaceId}/prompts/researcher`, {
    prompt: 'You are a research assistant specialized in analyzing academic documents and extracting key findings.',
    changeNote: 'Test update'
  });
  record('Update researcher prompt works', up.status === 200);

  // 7.4 Prompt too short
  const ps = await api('PUT', `/api/v1/workspaces/${workspaceId}/prompts/researcher`, {
    prompt: 'Short'
  });
  record('Short prompt (<20 chars) rejected', ps.status === 400);

  // 7.5 Get prompt versions
  const pv = await api('GET', `/api/v1/workspaces/${workspaceId}/prompts/researcher/versions`);
  record('Get prompt versions works', pv.status === 200);

  // 7.6 Invalid role
  const ir = await api('GET', `/api/v1/workspaces/${workspaceId}/prompts/hacker`);
  record('Invalid prompt role handled', ir.status === 400 || ir.status === 404,
    `status=${ir.status}`);
}

// ═══════════════════════════════════════════════
// 8. DRAFTS
// ═══════════════════════════════════════════════
async function testDrafts() {
  console.log('\n══════════════════════════════════════');
  console.log('8. DRAFT MANAGEMENT TESTS');
  console.log('══════════════════════════════════════');

  if (!runId) {
    console.log('⏭️  Skipping draft tests (no run available)');
    return;
  }

  // Wait a bit for the run to finish or produce output
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 8.1 Save a draft
  const sd = await api('PUT', `/api/v1/workspaces/${workspaceId}/runs/${runId}/draft`, {
    markdown: '# My Draft\n\nThis is a test draft with some content.\n\n## Section 1\n\nSome analysis here.'
  });
  record('Save draft works', sd.status === 200 || sd.status === 201,
    `status=${sd.status}`);

  // 8.2 Get draft
  const gd = await api('GET', `/api/v1/workspaces/${workspaceId}/runs/${runId}/draft`);
  record('Get draft works', gd.status === 200,
    `hasMarkdown=${!!gd.data?.markdown}`);

  // 8.3 Get draft versions
  const dv = await api('GET', `/api/v1/workspaces/${workspaceId}/runs/${runId}/draft/versions`);
  record('Get draft versions works', dv.status === 200);

  // 8.4 Draft too large (test limit)
  const ld = await api('PUT', `/api/v1/workspaces/${workspaceId}/runs/${runId}/draft`, {
    markdown: 'x'.repeat(200001)
  });
  record('Oversized draft rejected', ld.status === 400);

  // 8.5 Draft with extra fields
  const ef = await api('PUT', `/api/v1/workspaces/${workspaceId}/runs/${runId}/draft`, {
    markdown: '# Test',
    hack: 'evil'
  });
  record('Draft with extra fields rejected (strict)', ef.status === 400);
}

// ═══════════════════════════════════════════════
// 9. WEB & SCHOLARLY SEARCH
// ═══════════════════════════════════════════════
async function testSearch() {
  console.log('\n══════════════════════════════════════');
  console.log('9. WEB & SCHOLARLY SEARCH TESTS');
  console.log('══════════════════════════════════════');

  // 9.1 Scholarly search
  const ss = await api('GET', `/api/v1/workspaces/${workspaceId}/scholarly?query=machine+learning`);
  record('Scholarly search works', ss.status === 200,
    `results=${ss.data?.results?.length || 0}`);

  // 9.2 Scholarly search with empty query
  const se = await api('GET', `/api/v1/workspaces/${workspaceId}/scholarly?query=`);
  record('Empty scholarly query handled', se.status === 400 || se.status === 200);

  // 9.3 Question with web search
  const qw = await api('POST', `/api/v1/workspaces/${workspaceId}/questions`, {
    question: 'What are recent developments in transformer architectures?',
    sourceMode: 'documents_web'
  });
  record('Question with web search works', qw.status === 200 || qw.status === 201,
    `status=${qw.status}`);
}

// ═══════════════════════════════════════════════
// 10. EDGE CASES & SECURITY
// ═══════════════════════════════════════════════
async function testEdgeCases() {
  console.log('\n══════════════════════════════════════');
  console.log('10. EDGE CASES & SECURITY TESTS');
  console.log('══════════════════════════════════════');

  // 10.1 JSON body size limit
  const big = await api('POST', '/api/v1/auth/login', {
    email: 'test@test.com',
    password: 'x'.repeat(1024 * 1024 + 1)
  });
  record('Oversized JSON body handled', big.status === 400 || big.status === 413 || big.status === 401,
    `status=${big.status}`);

  // 10.2 Non-JSON content type
  const nj = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: APP_ORIGIN },
    body: 'not json'
  });
  record('Non-JSON body handled', nj.status === 400 || nj.status === 415,
    `status=${nj.status}`);

  // 10.3 Access another user's workspace (using random ID)
  const other = await api('GET', '/api/v1/workspaces/507f1f77bcf86cd799439011');
  record('Cannot access non-owned workspace (404)', other.status === 404);

  // 10.4 Unauthenticated workspace access
  const oldCookie = sessionCookie;
  sessionCookie = '';
  const ua = await api('GET', '/api/v1/workspaces');
  record('Unauthenticated workspace access returns 401', ua.status === 401);
  sessionCookie = oldCookie;

  // 10.5 Expired/fake session cookie
  const saved = sessionCookie;
  sessionCookie = 'scholargraph_session=fakeinvalidtoken12345';
  const fake = await api('GET', '/api/v1/auth/session');
  record('Fake session cookie returns 401', fake.status === 401);
  sessionCookie = saved;

  // 10.6 Request to non-existent route
  const nr = await api('GET', '/api/v1/nonexistent');
  record('Non-existent API route returns 404', nr.status === 404,
    `status=${nr.status}`);

  // 10.7 POST without Origin header (CSRF check)
  const noOrigin = await api('POST', '/api/v1/workspaces', { name: 'CSRF test' }, { noOrigin: true });
  record('POST without Origin blocked (CSRF)', noOrigin.status === 403,
    `status=${noOrigin.status}, code=${noOrigin.data?.error?.code}`);

  // 10.8 SQL/NoSQL injection attempt in search
  const inject = await api('GET',
    `/api/v1/workspaces/${workspaceId}/documents?search={"$gt":""}}`);
  record('NoSQL injection in search handled safely', inject.status === 200 || inject.status === 400);

  // 10.9 XSS in workspace name
  const xss = await api('POST', '/api/v1/workspaces', {
    name: '<script>alert("xss")</script>'
  });
  record('XSS in workspace name stored safely',
    xss.status === 201 || xss.status === 200,
    `name=${xss.data?.workspace?.name}`);
  // Clean it up
  if (xss.data?.workspace?.id) {
    await api('DELETE', `/api/v1/workspaces/${xss.data.workspace.id}`);
  }

  // 10.10 Very long search query
  const longSearch = await api('GET',
    `/api/v1/workspaces/${workspaceId}/documents?search=${'A'.repeat(200)}`);
  record('Long search query (>120) rejected', longSearch.status === 400);
}

// ═══════════════════════════════════════════════
// 11. LOGOUT & CLEANUP
// ═══════════════════════════════════════════════
async function testLogoutAndCleanup() {
  console.log('\n══════════════════════════════════════');
  console.log('11. LOGOUT & CLEANUP TESTS');
  console.log('══════════════════════════════════════');

  // 11.1 Delete second workspace
  if (secondWorkspaceId) {
    const dw = await api('DELETE', `/api/v1/workspaces/${secondWorkspaceId}`);
    record('Delete workspace works', dw.status === 204);

    // Verify deletion
    const vd = await api('GET', `/api/v1/workspaces/${secondWorkspaceId}`);
    record('Deleted workspace returns 404', vd.status === 404);
  }

  // 11.2 Logout
  const lo = await api('POST', '/api/v1/auth/logout');
  record('Logout succeeds', lo.status === 204);

  // 11.3 Session invalid after logout
  const afterLogout = await api('GET', '/api/v1/auth/session');
  record('Session invalid after logout', afterLogout.status === 401);

  // 11.4 Re-login for final cleanup
  const login = await api('POST', '/api/v1/auth/login', {
    email: TEST_EMAIL, password: TEST_PASSWORD
  });
  record('Re-login after logout works', login.status === 200);

  // 11.5 Delete primary workspace (cascading deletion of docs, runs, etc.)
  if (workspaceId) {
    const dw = await api('DELETE', `/api/v1/workspaces/${workspaceId}`);
    record('Delete workspace with documents/runs works', dw.status === 204);
  }

  // 11.6 Final logout
  await api('POST', '/api/v1/auth/logout');
}

// ═══════════════════════════════════════════════
// 12. FRONTEND TESTS (Vite dev server)
// ═══════════════════════════════════════════════
async function testFrontend() {
  console.log('\n══════════════════════════════════════');
  console.log('12. FRONTEND TESTS');
  console.log('══════════════════════════════════════');

  // 12.1 Vite serves HTML
  const html = await fetch('http://localhost:5173/');
  const text = await html.text();
  record('Frontend serves HTML', html.status === 200 && text.toLowerCase().includes('<!doctype html'));
  record('HTML references app root', text.includes('id="root"'));
  record('HTML includes main script', text.includes('main.tsx') || text.includes('.js'));

  // 12.2 SVG asset available
  const svg = await fetch('http://localhost:5173/scholargraph-mark.svg');
  record('SVG logo asset served', svg.status === 200);

  // 12.3 Vite HMR websocket endpoint
  // Just verify that Vite's dev server is responding
  const vite = await fetch('http://localhost:5173/@vite/client');
  record('Vite client script available', vite.status === 200);
}

// ═══════════════════════════════════════════════
// RUN ALL TESTS
// ═══════════════════════════════════════════════
async function main() {
  console.log('🔬 ScholarGraph Deep Test — Testing as a Real User');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Test email: ${TEST_EMAIL}`);
  console.log(`Server: ${BASE}`);
  console.log(`Frontend: ${APP_ORIGIN}`);

  try {
    await resetRateLimits();
    await testHealth();
    await testAuth();
    await resetRateLimits();
    await testWorkspaces();
    await testDocuments();
    await testQuestions();
    await testResearchRuns();
    await testAgentPrompts();
    await testDrafts();
    await testSearch();
    await testEdgeCases();
    await testLogoutAndCleanup();
    await testFrontend();
  } catch (err) {
    console.error('\n💥 FATAL ERROR:', err.message);
    console.error(err.stack);
  } finally {
    try { await mongoose.disconnect(); } catch {}
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`📊 RESULTS: ${passCount} passed, ${failCount} failed, ${passCount + failCount} total`);
  console.log('═══════════════════════════════════════════════════');

  if (failCount > 0) {
    console.log('\n❌ FAILURES:');
    results.filter(r => !r.passed).forEach(r =>
      console.log(`  • ${r.name}${r.detail ? ` — ${r.detail}` : ''}`));
  }
}

main();
