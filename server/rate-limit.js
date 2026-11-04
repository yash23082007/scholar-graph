import { createHmac } from 'node:crypto';
import { RateLimitEntry } from './models.js';

const keySecret =
  process.env.RATE_LIMIT_HASH_SECRET ||
  process.env.SESSION_SECRET ||
  process.env.MONGODB_URI ||
  'scholargraph-development-rate-limit';

export function rateLimitKey(ip, path) {
  return createHmac('sha256', keySecret).update(`${ip}:${path}`).digest('hex');
}

export async function consumeRateLimit(key, { now = new Date(), windowMs = 15 * 60 * 1000 } = {}) {
  const resetAt = new Date(now.getTime() + windowMs);
  const current = await RateLimitEntry.findOneAndUpdate(
    { _id: key, resetAt: { $gt: now } },
    { $inc: { count: 1 } },
    { new: true },
  ).lean();
  if (current) return { count: current.count, resetAt: current.resetAt };

  const reset = await RateLimitEntry.findOneAndUpdate(
    { _id: key, resetAt: { $lte: now } },
    { $set: { count: 1, resetAt } },
    { new: true },
  ).lean();
  if (reset) return { count: reset.count, resetAt: reset.resetAt };

  try {
    const created = await RateLimitEntry.create({ _id: key, count: 1, resetAt });
    return { count: created.count, resetAt: created.resetAt };
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const raced = await RateLimitEntry.findOneAndUpdate(
      { _id: key, resetAt: { $gt: now } },
      { $inc: { count: 1 } },
      { new: true },
    ).lean();
    if (raced) return { count: raced.count, resetAt: raced.resetAt };
    throw err;
  }
}
