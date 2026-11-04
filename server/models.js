import mongoose from 'mongoose';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    passwordHash: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: ['active', 'disabled'],
      default: 'active',
      index: true,
    },
  },
  { timestamps: true },
);

const sessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

const workspaceSchema = new Schema(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    defaultCitationStyle: {
      type: String,
      enum: ['APA', 'IEEE', 'MLA', 'Chicago'],
      default: 'APA',
    },
  },
  { timestamps: true },
);
workspaceSchema.index({ ownerId: 1, updatedAt: -1 });

const documentSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    originalName: { type: String, required: true, maxlength: 255 },
    mimeType: { type: String, required: true },
    byteSize: { type: Number, required: true },
    storagePath: { type: String, required: true, select: false },
    sha256: { type: String, required: true },
    status: {
      type: String,
      enum: ['uploaded', 'extracting', 'ready', 'needs_attention', 'failed'],
      default: 'uploaded',
      index: true,
    },
    pageCount: { type: Number, default: 0 },
    extractionWarnings: { type: [String], default: [] },
    extractedCharacters: { type: Number, default: 0 },
  },
  { timestamps: true },
);
documentSchema.index({ workspaceId: 1, createdAt: -1 });
documentSchema.index({ workspaceId: 1, sha256: 1 }, { unique: true });

const documentChunkSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true },
    sectionTitle: { type: String, default: '' },
    pageStart: { type: Number, default: null },
    pageEnd: { type: Number, default: null },
    charStart: { type: Number, default: null },
    charEnd: { type: Number, default: null },
    contentHash: { type: String, required: true },
  },
  { timestamps: true },
);
documentChunkSchema.index({ workspaceId: 1, documentId: 1, chunkIndex: 1 }, { unique: true });

const researchRunSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    task: { type: String, required: true, maxlength: 5000 },
    outputType: {
      type: String,
      enum: ['brief', 'literature_review', 'technical_report', 'comparison'],
      default: 'brief',
    },
    selectedDocumentIds: [{ type: Schema.Types.ObjectId, ref: 'Document' }],
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed', 'cancelled'],
      default: 'queued',
      index: true,
    },
    currentStage: { type: String, default: 'queued' },
    markdown: { type: String, default: '' },
    errorMessage: { type: String, default: '' },
    revisionCount: { type: Number, default: 0 },
    eventSequence: { type: Number, default: 0 },
    sourceMode: {
      type: String,
      enum: ['documents_only', 'documents_web'],
      default: 'documents_only',
    },
    agentProviders: { type: Schema.Types.Mixed, default: {} },
    promptSnapshots: { type: Schema.Types.Mixed, default: {} },
    artifacts: { type: Schema.Types.Mixed, default: {} },
    evidence: { type: [Schema.Types.Mixed], default: [] },
    sourceWarnings: { type: [String], default: [] },
  },
  { timestamps: true },
);
researchRunSchema.index({ workspaceId: 1, createdAt: -1 });

const runEventSchema = new Schema(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'ResearchRun', required: true, index: true },
    sequence: { type: Number, required: true },
    type: { type: String, required: true },
    agent: { type: String, default: null },
    status: { type: String, default: null },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
runEventSchema.index({ runId: 1, sequence: 1 }, { unique: true });

const agentPromptSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    agent: { type: String, enum: ['researcher', 'writer', 'critic', 'editor'], required: true },
    prompt: { type: String, required: true, maxlength: 12000 },
    version: { type: Number, default: 1 },
  },
  { timestamps: true },
);
agentPromptSchema.index({ workspaceId: 1, agent: 1 }, { unique: true });

const promptVersionSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    agent: { type: String, enum: ['researcher', 'writer', 'critic', 'editor'], required: true },
    version: { type: Number, required: true },
    prompt: { type: String, required: true, maxlength: 12000 },
    changeNote: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
promptVersionSchema.index({ workspaceId: 1, agent: 1, version: 1 }, { unique: true });

const agentRunSchema = new Schema(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'ResearchRun', required: true, index: true },
    agent: { type: String, enum: ['researcher', 'writer', 'critic', 'editor'], required: true },
    attempt: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed', 'skipped'],
      default: 'queued',
    },
    provider: { type: String, default: '' },
    model: { type: String, default: '' },
    promptVersion: { type: Number, default: 1 },
    inputSummary: { type: String, default: '' },
    output: { type: String, default: '' },
    errorCode: { type: String, default: '' },
    usage: { type: Schema.Types.Mixed, default: null },
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true },
);
agentRunSchema.index({ runId: 1, agent: 1, attempt: 1 }, { unique: true });

const draftVersionSchema = new Schema(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'ResearchRun', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    version: { type: Number, required: true },
    markdown: { type: String, required: true },
    checksum: { type: String, required: true },
    createdBy: { type: String, enum: ['writer', 'editor', 'user'], required: true },
    changeSummary: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
draftVersionSchema.index({ runId: 1, version: 1 }, { unique: true });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);
export const Workspace = mongoose.models.Workspace || mongoose.model('Workspace', workspaceSchema);
export const Document = mongoose.models.Document || mongoose.model('Document', documentSchema);
export const DocumentChunk =
  mongoose.models.DocumentChunk || mongoose.model('DocumentChunk', documentChunkSchema);
export const ResearchRun =
  mongoose.models.ResearchRun || mongoose.model('ResearchRun', researchRunSchema);
export const RunEvent = mongoose.models.RunEvent || mongoose.model('RunEvent', runEventSchema);
export const AgentPrompt =
  mongoose.models.AgentPrompt || mongoose.model('AgentPrompt', agentPromptSchema);
export const PromptVersion =
  mongoose.models.PromptVersion || mongoose.model('PromptVersion', promptVersionSchema);
export const AgentRun = mongoose.models.AgentRun || mongoose.model('AgentRun', agentRunSchema);
export const DraftVersion =
  mongoose.models.DraftVersion || mongoose.model('DraftVersion', draftVersionSchema);
