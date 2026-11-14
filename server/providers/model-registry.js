import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const candidateSchema = z.object({
  provider: z.enum(['groq', 'gemini', 'local']),
  model: z.string().trim().min(1).max(160),
  tier: z.string().trim().min(1).max(32).optional(),
});
const roleSchema = z.object({
  primary: candidateSchema,
  fallback: z.array(candidateSchema).default([]),
  max_output_tokens: z.number().int().positive().max(65536).optional(),
  temperature: z.number().min(0).max(2).optional(),
  timeout_ms: z.number().int().positive().max(300000).optional(),
  schema: z.string().trim().min(1).max(100).optional(),
});
const registrySchema = z.object({
  version: z.string().min(1),
  roles: z.record(z.string().min(1), roleSchema),
  critical_roles: z.array(z.string()).default([]),
  policies: z.record(z.string(), z.unknown()).optional(),
  tiers: z.record(z.string(), z.unknown()).optional(),
  maintenance: z.record(z.string(), z.unknown()).optional(),
});

export function loadModelRegistry(filePath = process.env.MODEL_CONFIG_PATH || 'config/models.yaml') {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
  let parsed;
  try {
    parsed = parse(readFileSync(resolvedPath, 'utf8'), { uniqueKeys: true });
  } catch (cause) {
    throw new Error(`Could not read model registry at ${resolvedPath}: ${cause.message}`, { cause });
  }
  const result = registrySchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'registry'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Model registry is invalid: ${details}`);
  }
  for (const roleName of result.data.critical_roles) {
    if (!result.data.roles[roleName]) {
      throw new Error(`Model registry is invalid: critical role "${roleName}" is undefined.`);
    }
  }
  return result.data;
}

export const modelRegistry = loadModelRegistry();

export function getModelRole(role = 'answer') {
  const config = modelRegistry.roles[role];
  if (!config) throw new Error(`Model registry has no configuration for role "${role}".`);
  return config;
}

export function configuredModelCandidates(role = 'answer', requestedProvider = null) {
  const config = getModelRole(role);
  const configured = [config.primary, ...config.fallback].filter((candidate) => {
    if (candidate.provider === 'local') return false;
    if (requestedProvider && candidate.provider !== requestedProvider) return false;
    return Boolean(process.env[`${candidate.provider.toUpperCase()}_API_KEY`]);
  });
  const unique = new Map();
  for (const candidate of configured) unique.set(`${candidate.provider}:${candidate.model}`, candidate);
  return [...unique.values()];
}

export function validateModelRegistry({ strict = false, production = false } = {}) {
  const warnings = [];
  for (const roleName of modelRegistry.critical_roles) {
    const candidates = configuredModelCandidates(roleName);
    if (!candidates.length) {
      warnings.push(`Critical role "${roleName}" has no configured provider key.`);
    }
  }
  if (production && strict && warnings.length) {
    throw new Error(`Model registry validation failed: ${warnings.join(' ')}`);
  }
  return {
    version: modelRegistry.version,
    roleCount: Object.keys(modelRegistry.roles).length,
    providers: ['groq', 'gemini'].filter((provider) =>
      Boolean(process.env[`${provider.toUpperCase()}_API_KEY`]),
    ),
    warnings,
  };
}
