import { NextResponse } from 'next/server';

/**
 * TEMPORARY diagnostic (remove after setup): reports the SHAPE of the
 * server-side env config without ever exposing the key value itself.
 * Helps distinguish: env missing entirely vs malformed value vs truncated.
 */

const TARGET_BASE = process.env.PAYGUARD_API_URL ?? 'http://localhost:4000';
const API_KEY = process.env.PAYGUARD_API_KEY ?? '';

export function GET(): NextResponse {
  const hex = API_KEY.startsWith('pgk_') ? API_KEY.slice(4, API_KEY.indexOf(':')) : '';
  return NextResponse.json({
    hasApiKey: API_KEY.length > 0,
    keyLength: API_KEY.length,
    expectedKeyLength: 84, // "pgk_" (4) + 64 hex + ":owner_northstar" (16)
    keyStartsWithPgk: API_KEY.startsWith('pgk_'),
    keyHasOwnerSuffix: API_KEY.endsWith(':owner_northstar'),
    keyContainsColon: API_KEY.includes(':'),
    keyContainsQuotes: API_KEY.includes('"') || API_KEY.includes("'"),
    keyContainsWhitespace: /\s/.test(API_KEY),
    // Hex fingerprint (first/last 8 chars) — compare against Render's key to
    // detect a DIFFERENT key with the same shape. Not a secret leak.
    keyHexPrefix8: hex.slice(0, 8),
    keyHexSuffix8: hex.slice(-8),
    apiUrlEnvPresent: process.env.PAYGUARD_API_URL !== undefined,
    targetHost: TARGET_BASE.replace(/^https?:\/\//, ''),
  });
}
