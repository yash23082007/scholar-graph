# ScholarGraph Web UI Testing Guide

## 🔐 Step 1: Sign In

**Test Account Credentials:**
- **Email:** `tester_20261105185502@scholargraph.test`
- **Password:** `TestPassword123!`

**Steps:**
1. Open http://localhost:5173 in your browser
2. You should see a sign-in form
3. Enter the email and password above
4. Click "Sign in"
5. You should be redirected to the workspace view

---

## 📁 Step 2: Explore Your Workspace

**What you'll see:**
- Workspace name: "Updated Research Workspace"
- Description: "Testing workspace updates"
- Default citation style: APA

**Documents already uploaded:**
- `sample-research.md` (1,167 characters) - about renewable energy economics
- `sample-thesis.txt` (1,294 characters) - about machine learning in healthcare

---

## 📤 Step 3: Upload Additional Documents

**Try uploading:**

### Option A: Create a new file to upload
Create a file called `ai-ethics.txt` with this content:

```
Ethical Considerations in Artificial Intelligence

AI systems raise important ethical questions about bias, privacy, and accountability.
Machine learning models can perpetuate historical biases present in training data,
leading to discriminatory outcomes in hiring, lending, and criminal justice.

Key ethical principles for AI include:
- Transparency: Users should understand how AI makes decisions
- Fairness: Systems should not discriminate based on protected characteristics
- Privacy: Personal data should be collected and used responsibly
- Accountability: There should be human oversight and redress mechanisms

Recent regulations like the EU AI Act establish risk-based frameworks for AI governance.
```

### Option B: Upload existing documents
- Navigate to the Documents tab
- Click "Upload" or drag-and-drop files
- Supported formats: PDF, DOCX, TXT, MD/Markdown
- Watch the processing status change from "extracting" to "ready"

**Expected behavior:**
- Duplicate detection: Re-uploading the same file shows "duplicate" status
- Processing: Files are parsed into searchable chunks
- Warning: "Malware scanner is not configured" (this is expected in dev)

---

## 🔍 Step 4: Search Documents

**In the Documents tab:**

1. **Search by name:**
   - Type "thesis" in the search box
   - Should show only `sample-thesis.txt`

2. **Search by name:**
   - Type "research" in the search box
   - Should show only `sample-research.md`

3. **Clear search:**
   - Clear the search box
   - Should show all documents (2-3 total)

4. **View document details:**
   - Click on a document name
   - See the full text split into section-aware chunks
   - Each chunk shows page number and section title

---

## 💬 Step 5: Ask Questions (Q&A Feature)

Navigate to the "Questions" or "Ask" tab and try these:

### Test 1: Retrieval Only (No AI)
**Question:** `How many jobs were created by renewable energy investments?`
**Settings:**
- Source Mode: Documents Only
- Provider: Retrieval Only

**Expected result:**
- Shows 5 ranked passages
- Highlights matched terms: "jobs", "created", "renewable", "energy"
- Evidence [E1] should contain: "12 million jobs globally by 2023"

### Test 2: AI-Assisted (Gemini)
**Question:** `What was the GDP growth difference between early and late renewable energy adopters?`
**Settings:**
- Source Mode: Documents Only
- Provider: Gemini

**Expected result:**
- AI synthesizes an answer citing [E#] evidence IDs
- Answer: "Countries with early renewable energy adoption experienced GDP growth rates 2.3% higher..."
- Shows evidence passages with citations
- Notice: "AI-generated answer. Evidence IDs are checked for existence..."

### Test 3: Web Search Mode
**Question:** `What are the latest applications of deep learning in medical imaging?`
**Settings:**
- Source Mode: Documents + Web
- Provider: Gemini

**Expected result:**
- Combines your uploaded documents + Tavily web results + scholarly metadata
- Evidence includes:
  - Web page extracts with URLs
  - Academic records with DOIs and authors
  - Your uploaded document chunks
- AI synthesizes from all sources

---

## 🔬 Step 6: Start a Research Run (4-Agent Pipeline)

Navigate to "Research Runs" or "Reports" tab:

### Create a new research run:

**Task:** 
```
Analyze the economic benefits and job creation impact of renewable energy investments based on the uploaded research documents.
```

**Settings:**
- Output Type: Brief (or Literature Review / Technical Report)
- Documents: Select `sample-research.md`
- Source Mode: Documents Only
- Agent Providers:
  - Researcher: Gemini
  - Writer: Gemini
  - Critic: Gemini
  - Editor: Gemini

**Click "Start Research"**

### Watch the Progress (Real-time SSE):

You should see stages progress in real-time:

1. **📊 Retrieval** - Gathering evidence (a few seconds)
2. **🔍 Researcher** - Building evidence dossier (~30-60 seconds)
3. **✍️ Writer** - Creating initial draft (~30-60 seconds)
4. **👁️ Critic** - Auditing the draft (~30-60 seconds)
5. **📝 Editor** - Polishing final report (~30-60 seconds)
6. **✅ Completed** - Full Markdown report ready

**Total time:** ~2-4 minutes

---

## 📝 Step 7: View and Edit the Report

Once the research run completes:

### View the Report:
1. Click on the completed run
2. See the full Markdown report with:
   - Cited evidence: `[E1]`, `[E2]`, etc.
   - Structured sections
   - Evidence-linked findings

3. **Click on evidence IDs** to see the exact source passages

### Test Live Editing:
1. Click "Edit" or switch to edit mode
2. Make changes to the Markdown
3. See **live preview** update as you type
4. Changes are **auto-saved** every few seconds
5. Check the "Last saved" timestamp

### Test Version History:
1. Make some edits and save
2. Click "Save Version" (explicit save)
3. Add a change note: "Added executive summary"
4. Go to "Versions" or "History" tab
5. See all saved versions with timestamps
6. Click "Restore" on an older version
7. See the diff/comparison highlighting changes

### Export Options:
1. **Download Markdown:** Click "Download" to get `.md` file
2. **Print to PDF:** Click "Print" → "Save as PDF" in browser dialog

---

## 🎛️ Step 8: Customize Agent Prompts

Navigate to "Settings" or "Agent Prompts":

### View Current Prompts:
- See prompts for all 4 agents (Researcher, Writer, Critic, Editor)
- Each shows version number and whether it's default or custom

### Modify a Prompt:
1. Click "Edit" on the Researcher prompt
2. Change the instructions, e.g.:
```
Build a comprehensive evidence dossier focusing on quantitative data.
Record all statistics, percentages, and numerical findings with precise citations.
Highlight gaps where numerical evidence is missing.
```
3. Add change note: "Emphasizing quantitative focus"
4. Save the new prompt

### View Version History:
1. Click "History" on an agent
2. See all prompt versions with change notes
3. Test "Restore" to revert to an older prompt version

### Test in New Run:
1. Start a new research run
2. It will use your customized prompt for the Researcher agent
3. Compare the output style to previous runs

---

## 🧪 Step 9: Test Document Management

### Reprocess a Failed Document:
If you uploaded a malformed file:
1. Find a document with status "failed" or "needs_attention"
2. Click "Reprocess" or "Retry"
3. Watch the status update

### Delete a Document:
1. Select a document
2. Click "Delete" 
3. Confirm the deletion
4. Document and all its chunks are removed
5. Verify it no longer appears in Q&A evidence

---

## 🔓 Step 10: Test Authentication

### Sign Out:
1. Click your profile/avatar in the top-right
2. Click "Sign out"
3. Session cookie is cleared
4. Redirected to sign-in page

### Sign In Again:
1. Use the same credentials:
   - Email: `tester_20261105185502@scholargraph.test`
   - Password: `TestPassword123!`
2. Your workspace and documents persist
3. Research runs and drafts are still available

### Test Invalid Login:
1. Try wrong password: `WrongPassword123`
2. Should see error: "Email or password is incorrect"
3. No session cookie created

---

## ✅ Feature Checklist

Mark each as you test:

- [ ] Sign in with test account
- [ ] View workspace details
- [ ] Upload new document
- [ ] Test duplicate detection (re-upload same file)
- [ ] Search documents by name
- [ ] View document chunks and sections
- [ ] Ask question (retrieval only mode)
- [ ] Ask question (AI-assisted with Gemini)
- [ ] Ask question (web search mode)
- [ ] Start research run
- [ ] Watch real-time progress (SSE events)
- [ ] View completed research report
- [ ] Click evidence IDs to inspect sources
- [ ] Edit report with live Markdown preview
- [ ] Auto-save functionality
- [ ] Save explicit version with note
- [ ] View version history
- [ ] Restore old version
- [ ] Download Markdown file
- [ ] Print to PDF (browser)
- [ ] View agent prompts
- [ ] Edit and save custom prompt
- [ ] View prompt version history
- [ ] Delete a document
- [ ] Sign out
- [ ] Sign in again (persistence check)

---

## 🐛 Common Issues & Solutions

### Issue: "Database unavailable"
- **Solution:** Check MongoDB is running: `mongod` or check connection string in `.env`

### Issue: AI provider errors
- **Solution:** Verify API keys in `.env`:
  - `GROQ_API_KEY=...`
  - `GEMINI_API_KEY=...`

### Issue: Upload fails silently
- **Solution:** Check console for errors, verify file size < 20MB

### Issue: SSE events not updating
- **Solution:** Refresh the page, check network tab for EventSource connection

### Issue: Citation IDs invalid
- **Solution:** This is expected if model invents citations; critic agent should catch it

---

## 📊 Expected Performance

- **Document upload + parsing:** 1-5 seconds
- **Q&A retrieval only:** < 1 second
- **Q&A with AI synthesis:** 2-5 seconds
- **Full research run:** 2-4 minutes (depends on provider speed)
- **Auto-save:** Every 3-5 seconds after editing stops

---

## 🎯 Success Criteria

You've successfully tested ScholarGraph if:

1. ✅ All authentication flows work (login, logout, session restore)
2. ✅ Documents upload, parse, and become searchable
3. ✅ Q&A returns relevant evidence with proper citations
4. ✅ Research runs complete with all 4 agent stages
5. ✅ Reports display with working evidence links
6. ✅ Draft editing has live preview and auto-save
7. ✅ Version history saves and restores correctly
8. ✅ Agent prompts can be customized and versioned
9. ✅ Data persists across sign-out/sign-in
10. ✅ Real-time progress updates via SSE work smoothly

---

**Happy Testing! 🚀**

If you find any bugs or have questions, check:
- Browser console for client errors
- Server logs in the terminal running `npm run dev`
- MongoDB connection status via `/api/health`
