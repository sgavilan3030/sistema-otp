import 'dotenv/config';
import express from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs';
import net from 'net';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { exec, execFile } from 'child_process';
import compression from 'compression';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;
app.disable('x-powered-by');
app.set('trust proxy', false);

const DATA_DIR = path.join(process.cwd(), 'data');
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o750 });
  }
} catch (_) {}

function loadOrCreateSecret(envVarName: string, fileName: string, byteLen = 32): string {
  const fromEnv = String(process.env[envVarName] || '').trim();
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  const secretPath = path.join(DATA_DIR, fileName);
  try {
    if (fs.existsSync(secretPath)) {
      const val = fs.readFileSync(secretPath, 'utf8').trim();
      if (val && val.length >= 16) return val;
    }
    const generated = crypto.randomBytes(byteLen).toString('hex');
    fs.writeFileSync(secretPath, generated, { encoding: 'utf8', mode: 0o600 });
    return generated;
  } catch (_) {
    return crypto.randomBytes(byteLen).toString('hex');
  }
}

const AUTH_SECRET = loadOrCreateSecret('AUTH_SECRET', '.auth_secret', 32);
const INTERNAL_WEBHOOK_KEY = loadOrCreateSecret('INTERNAL_WEBHOOK_KEY', '.webhook_key', 24);
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const revokedTokenIds = new Map<string, number>();

export const hasLocalAsterisk =
  fs.existsSync('/usr/sbin/asterisk') ||
  fs.existsSync('/usr/local/sbin/asterisk') ||
  fs.existsSync('/usr/bin/asterisk') ||
  fs.existsSync('/usr/local/bin/asterisk') ||
  fs.existsSync('/var/run/asterisk/asterisk.ctl');

export function getAsteriskBinary(): string {
  for (const bin of ['/usr/sbin/asterisk', '/usr/local/sbin/asterisk', '/usr/bin/asterisk', '/usr/local/bin/asterisk']) {
    if (fs.existsSync(bin)) return bin;
  }
  return 'asterisk';
}

const REMOTE_ASTERISK_HTTP = process.env.ASTERISK_REMOTE_HTTP || (hasLocalAsterisk ? '' : 'http://169.58.66.206:3000');
export const ASTERISK_HOST = process.env.ASTERISK_HOST || (hasLocalAsterisk ? '127.0.0.1' : '169.58.66.206');
const AMI_HOST = process.env.AMI_HOST || ASTERISK_HOST;
const AMI_PORT = Number(process.env.AMI_PORT) || 5038;
const AMI_USER = process.env.AMI_USER || 'sammy';
const AMI_SECRET = process.env.AMI_SECRET || 'Robert2026RDTGcvgbsg';
const AMI_ADMIN_SECRET =
  String(process.env.AMI_ADMIN_SECRET || '').trim() ||
  crypto.createHash('sha256').update(`${AMI_SECRET}:ami_admin`).digest('hex').slice(0, 24);

let remoteConsecutiveFailures = 0;
let remoteLastFailureTime = 0;
let remoteLastSuccessTime = 0;

// Security headers (preserve iframe preview compatibility by omitting X-Frame-Options: DENY)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Enable gzip/deflate compression for fast asset transfer
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Helper to execute AMI Action via raw TCP socket :5038 with connection pooling / debounce to prevent login/logout churn
let amiCachedResult: { data: string; timestamp: number } | null = null;
let isAmiExecuting = false;

function isLoopbackIp(rawIp?: string | string[]): boolean {
  const ip = Array.isArray(rawIp) ? rawIp[0] : String(rawIp || '').trim();
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function isDirectLoopback(req: express.Request): boolean {
  if (
    req.headers['x-forwarded-for'] ||
    req.headers['x-real-ip'] ||
    req.headers['cf-connecting-ip'] ||
    req.headers['forwarded']
  ) {
    return false;
  }
  return isLoopbackIp(req.socket?.remoteAddress);
}

function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isInternalAsteriskWebhook(req: express.Request): boolean {
  const headerKey = String(req.headers['x-internal-webhook-key'] || '').trim();
  if (headerKey && safeEqualStrings(headerKey, INTERNAL_WEBHOOK_KEY)) {
    return true;
  }
  return isDirectLoopback(req);
}

function getClientRateLimitKey(req: express.Request): string {
  const xReal = String(req.headers['x-real-ip'] || '').trim();
  const xFwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xReal || xFwd || String(req.socket?.remoteAddress || 'unknown');
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets.entries()) {
    if (now > v.resetAt) rateBuckets.delete(k);
  }
  for (const [jti, exp] of revokedTokenIds.entries()) {
    if (now > exp) revokedTokenIds.delete(jti);
  }
}, 5 * 60 * 1000).unref();

function checkRateLimit(bucketKey: string, maxRequests: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = rateBuckets.get(bucketKey);
  if (!entry || now > entry.resetAt) {
    rateBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  entry.count += 1;
  if (entry.count > maxRequests) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

function loginRateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const clientIp = getClientRateLimitKey(req);
  const identifier = String(req.body?.identifier || req.body?.username || '').trim().toLowerCase().slice(0, 64);
  const ipLimit = checkRateLimit(`login:ip:${clientIp}`, 15, 15 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({
      success: false,
      error: `Demasiados intentos de inicio de sesión. Intenta nuevamente en ${ipLimit.retryAfterSec}s.`,
    });
  }
  if (identifier) {
    const userLimit = checkRateLimit(`login:user:${clientIp}:${identifier}`, 10, 15 * 60 * 1000);
    if (!userLimit.allowed) {
      res.setHeader('Retry-After', String(userLimit.retryAfterSec));
      return res.status(429).json({
        success: false,
        error: `Cuenta temporalmente bloqueada por seguridad. Espera ${userLimit.retryAfterSec}s.`,
      });
    }
  }
  next();
}

function apiRateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (isDirectLoopback(req)) return next();
  const key = `api:${getClientRateLimitKey(req)}`;
  const check = checkRateLimit(key, 300, 60 * 1000);
  if (!check.allowed) {
    res.setHeader('Retry-After', String(check.retryAfterSec));
    return res.status(429).json({ success: false, error: 'Límite de solicitudes excedido. Espera un momento.' });
  }
  next();
}

function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(plain: string, storedHash?: string): boolean {
  if (!plain || !storedHash) return false;
  if (!storedHash.startsWith('scrypt$')) {
    return safeEqualStrings(plain, storedHash);
  }
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const [, salt, hexDigest] = parts;
  try {
    const derived = crypto.scryptSync(plain, salt, 64);
    const expected = Buffer.from(hexDigest, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch (_) {
    return false;
  }
}

interface AuthTokenPayload {
  sub: string;
  username: string;
  role: string;
  tenantId?: string;
  assignedExtensions?: string[];
  jti: string;
  iat: number;
  exp: number;
}

function createAuthToken(user: any): string {
  const now = Date.now();
  const payload: AuthTokenPayload = {
    sub: String(user.id || user.username),
    username: String(user.username || ''),
    role: String(user.role || 'agent'),
    tenantId: user.tenantId ? String(user.tenantId) : undefined,
    assignedExtensions: Array.isArray(user.assignedExtensions) ? user.assignedExtensions.map(String) : [],
    jti: crypto.randomBytes(12).toString('hex'),
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyAuthToken(token?: string): AuthTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const encodedPayload = token.slice(0, dotIdx);
  const signature = token.slice(dotIdx + 1);
  if (!encodedPayload || !signature) return null;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(encodedPayload).digest('base64url');
  if (!safeEqualStrings(signature, expectedSig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as AuthTokenPayload;
    if (!payload || !payload.sub || !payload.exp || Date.now() > payload.exp) return null;
    if (payload.jti && revokedTokenIds.has(payload.jti)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

const TENANTS_FILE = path.join(DATA_DIR, 'tenants.json');
const MEMBERSHIP_SETTINGS_FILE = path.join(DATA_DIR, 'membership_settings.json');
const MEMBERSHIP_REQUESTS_FILE = path.join(DATA_DIR, 'membership_requests.json');

interface ServerMembershipSettings {
  enforceMembershipSystem: boolean;
  initialMonthDays: number;
  weekDays: number;
  demoDays: number;
  initialMonthPriceUsd: number;
  weeklyPriceUsd: number;
  callCenterBasePriceUsd: number;
  callCenterPerAgentMonthPriceUsd: number;
  callCenterPerAgentWeekPriceUsd: number;
  defaultCallCenterAgents: number;
  allowSelfRenewalFromBalance: boolean;
}

const DEFAULT_MEMBERSHIP_SETTINGS: ServerMembershipSettings = {
  enforceMembershipSystem: true,
  initialMonthDays: 30,
  weekDays: 7,
  demoDays: 1,
  initialMonthPriceUsd: 150,
  weeklyPriceUsd: 45,
  callCenterBasePriceUsd: 0,
  callCenterPerAgentMonthPriceUsd: 25,
  callCenterPerAgentWeekPriceUsd: 8,
  defaultCallCenterAgents: 5,
  allowSelfRenewalFromBalance: false,
};

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

function sanitizeOptionalUsdAmount(val: unknown): { valid: boolean; value?: number; error?: string } {
  if (val === undefined || val === null || val === '') return { valid: true, value: undefined };
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0 || num > 1000000) {
    return { valid: false, error: 'El monto en USD debe ser un número válido entre 0 y 1,000,000.' };
  }
  return { valid: true, value: roundUsd(num) };
}

function sanitizeOptionalAgentCount(val: unknown): { valid: boolean; value?: number; error?: string } {
  if (val === undefined || val === null || val === '') return { valid: true, value: undefined };
  const num = Number(val);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1 || num > 1000) {
    return { valid: false, error: 'La cantidad de agentes debe ser un número entero entre 1 y 1000.' };
  }
  return { valid: true, value: num };
}

function countActiveAgentsForTenant(tenantId: string, usersList?: any[]): number {
  if (!tenantId) return 0;
  const list = Array.isArray(usersList) ? usersList : loadStoredUsers();
  return list.filter(
    (u: any) => u && String(u.tenantId || '') === String(tenantId) && !isGlobalAdminUser(u)
  ).length;
}

function calculateSuggestedMembershipPrice(
  scope: 'tenant' | 'user',
  action: 'initial_month' | 'weekly_extension',
  membership: any,
  settings: ServerMembershipSettings,
  weeksCount = 1,
  overrideAgents?: number
): number {
  if (scope === 'tenant') {
    const agents = Math.max(
      1,
      Math.floor(Number(overrideAgents ?? membership?.licensedAgents ?? settings.defaultCallCenterAgents ?? 5) || 5)
    );
    if (action === 'initial_month') {
      if (typeof membership?.customMonthPriceUsd === 'number' && Number.isFinite(membership.customMonthPriceUsd) && overrideAgents === undefined) {
        return roundUsd(Math.max(0, membership.customMonthPriceUsd));
      }
      return roundUsd(
        Math.max(0, (Number(settings.callCenterBasePriceUsd) || 0) + agents * (Number(settings.callCenterPerAgentMonthPriceUsd) || 0))
      );
    }
    const w = Math.max(1, Math.floor(weeksCount || 1));
    if (typeof membership?.customWeeklyPriceUsd === 'number' && Number.isFinite(membership.customWeeklyPriceUsd) && overrideAgents === undefined) {
      return roundUsd(Math.max(0, w * membership.customWeeklyPriceUsd));
    }
    return roundUsd(Math.max(0, w * agents * (Number(settings.callCenterPerAgentWeekPriceUsd) || 0)));
  }

  if (action === 'initial_month') {
    if (typeof membership?.customMonthPriceUsd === 'number' && Number.isFinite(membership.customMonthPriceUsd)) {
      return roundUsd(Math.max(0, membership.customMonthPriceUsd));
    }
    return roundUsd(Math.max(0, Number(settings.initialMonthPriceUsd) || 0));
  }
  const w = Math.max(1, Math.floor(weeksCount || 1));
  if (typeof membership?.customWeeklyPriceUsd === 'number' && Number.isFinite(membership.customWeeklyPriceUsd)) {
    return roundUsd(Math.max(0, w * membership.customWeeklyPriceUsd));
  }
  return roundUsd(Math.max(0, w * (Number(settings.weeklyPriceUsd) || 0)));
}

function loadMembershipSettings(): ServerMembershipSettings {
  try {
    if (fs.existsSync(MEMBERSHIP_SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(MEMBERSHIP_SETTINGS_FILE, 'utf8'));
      if (raw && typeof raw === 'object') {
        return {
          enforceMembershipSystem: raw.enforceMembershipSystem !== false,
          initialMonthDays: Math.max(1, Math.floor(Number(raw.initialMonthDays) || 30)),
          weekDays: Math.max(1, Math.floor(Number(raw.weekDays) || 7)),
          demoDays: Math.max(1, Math.min(30, Math.floor(Number(raw.demoDays) || 1))),
          initialMonthPriceUsd: roundUsd(Math.max(0, Number(raw.initialMonthPriceUsd ?? 150))),
          weeklyPriceUsd: roundUsd(Math.max(0, Number(raw.weeklyPriceUsd ?? 45))),
          callCenterBasePriceUsd: roundUsd(Math.max(0, Number(raw.callCenterBasePriceUsd ?? 0))),
          callCenterPerAgentMonthPriceUsd: roundUsd(Math.max(0, Number(raw.callCenterPerAgentMonthPriceUsd ?? 25))),
          callCenterPerAgentWeekPriceUsd: roundUsd(Math.max(0, Number(raw.callCenterPerAgentWeekPriceUsd ?? 8))),
          defaultCallCenterAgents: Math.max(1, Math.min(1000, Math.floor(Number(raw.defaultCallCenterAgents ?? 5) || 5))),
          allowSelfRenewalFromBalance: Boolean(raw.allowSelfRenewalFromBalance),
        };
      }
    }
  } catch (_) {}
  return { ...DEFAULT_MEMBERSHIP_SETTINGS };
}

function saveMembershipSettings(nextSettings: Partial<ServerMembershipSettings>): ServerMembershipSettings {
  const current = loadMembershipSettings();
  const merged: ServerMembershipSettings = {
    enforceMembershipSystem:
      typeof nextSettings.enforceMembershipSystem === 'boolean'
        ? nextSettings.enforceMembershipSystem
        : current.enforceMembershipSystem,
    initialMonthDays: Math.max(1, Math.min(365, Math.floor(Number(nextSettings.initialMonthDays ?? current.initialMonthDays) || 30))),
    weekDays: Math.max(1, Math.min(31, Math.floor(Number(nextSettings.weekDays ?? current.weekDays) || 7))),
    demoDays: Math.max(1, Math.min(30, Math.floor(Number(nextSettings.demoDays ?? current.demoDays) || 1))),
    initialMonthPriceUsd: roundUsd(Math.max(0, Math.min(1000000, Number(nextSettings.initialMonthPriceUsd ?? current.initialMonthPriceUsd) || 0))),
    weeklyPriceUsd: roundUsd(Math.max(0, Math.min(1000000, Number(nextSettings.weeklyPriceUsd ?? current.weeklyPriceUsd) || 0))),
    callCenterBasePriceUsd: roundUsd(Math.max(0, Math.min(1000000, Number(nextSettings.callCenterBasePriceUsd ?? current.callCenterBasePriceUsd) || 0))),
    callCenterPerAgentMonthPriceUsd: roundUsd(Math.max(0, Math.min(1000000, Number(nextSettings.callCenterPerAgentMonthPriceUsd ?? current.callCenterPerAgentMonthPriceUsd) || 0))),
    callCenterPerAgentWeekPriceUsd: roundUsd(Math.max(0, Math.min(1000000, Number(nextSettings.callCenterPerAgentWeekPriceUsd ?? current.callCenterPerAgentWeekPriceUsd) || 0))),
    defaultCallCenterAgents: Math.max(1, Math.min(1000, Math.floor(Number(nextSettings.defaultCallCenterAgents ?? current.defaultCallCenterAgents) || 5))),
    allowSelfRenewalFromBalance:
      typeof nextSettings.allowSelfRenewalFromBalance === 'boolean'
        ? nextSettings.allowSelfRenewalFromBalance
        : current.allowSelfRenewalFromBalance,
  };
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o750 });
  fs.writeFileSync(MEMBERSHIP_SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function loadMembershipRequests(): any[] {
  try {
    if (fs.existsSync(MEMBERSHIP_REQUESTS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(MEMBERSHIP_REQUESTS_FILE, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return [];
}

function saveMembershipRequests(requests: any[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o750 });
    fs.writeFileSync(MEMBERSHIP_REQUESTS_FILE, JSON.stringify(requests, null, 2), 'utf8');
  } catch (_) {}
}

function evaluateMembershipRecord(
  rawMembership: any,
  settings: ServerMembershipSettings,
  scope: 'tenant' | 'user',
  targetId: string,
  targetName: string,
  activeAgentsCount?: number,
  tenantObj?: any
) {
  const now = Date.now();
  const m = rawMembership && typeof rawMembership === 'object' ? rawMembership : null;
  const initialMonthActivated = Boolean(m?.initialMonthActivated);
  const isDemo = Boolean(m?.isDemo && !initialMonthActivated);
  const demoUsed = Boolean(m?.demoUsed || m?.isDemo);
  const expiresAt = m?.expiresAt ? String(m.expiresAt) : undefined;
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const hasFutureExpiry = !isNaN(expiresAtMs) && expiresAtMs > now;

  let status: 'unactivated' | 'active' | 'expired' | 'suspended' = 'unactivated';
  if (m?.status === 'suspended') {
    status = 'suspended';
  } else if (hasFutureExpiry && (initialMonthActivated || isDemo)) {
    status = 'active';
  } else if (initialMonthActivated || demoUsed) {
    status = 'expired';
  } else {
    status = 'unactivated';
  }

  const remainingMs = status === 'active' && !isNaN(expiresAtMs) ? Math.max(0, expiresAtMs - now) : 0;
  const remainingDays = Math.floor(remainingMs / 86400000);
  const remainingHours = Math.floor((remainingMs % 86400000) / 3600000);
  const isActive = settings.enforceMembershipSystem ? status === 'active' : status !== 'suspended';

  const history: any[] = Array.isArray(m?.history) ? m.history : [];
  const paidEntries = history.filter((h) => typeof h?.amountPaid === 'number' && Number.isFinite(h.amountPaid) && h.action !== 'demo_1_day');
  const firstInitialPaidEntry = [...paidEntries]
    .reverse()
    .find((h) => h.action === 'initial_month' || h.action === 'request_approved');
  const latestPaidEntry = paidEntries[0];
  const computedTotalPaid = roundUsd(
    paidEntries.reduce((sum, h) => sum + Math.max(0, Number(h.amountPaid) || 0), 0)
  );

  const initialActivationPriceUsd =
    typeof m?.initialActivationPriceUsd === 'number' && Number.isFinite(m.initialActivationPriceUsd)
      ? roundUsd(m.initialActivationPriceUsd)
      : firstInitialPaidEntry
      ? roundUsd(Number(firstInitialPaidEntry.amountPaid) || 0)
      : undefined;

  const lastPaidAmountUsd =
    typeof m?.lastPaidAmountUsd === 'number' && Number.isFinite(m.lastPaidAmountUsd)
      ? roundUsd(m.lastPaidAmountUsd)
      : latestPaidEntry
      ? roundUsd(Number(latestPaidEntry.amountPaid) || 0)
      : undefined;

  const totalPaidUsd =
    typeof m?.totalPaidUsd === 'number' && Number.isFinite(m.totalPaidUsd)
      ? roundUsd(m.totalPaidUsd)
      : computedTotalPaid;

  const rawLicensedAgents = m?.licensedAgents ?? tenantObj?.licensedAgents;
  const licensedAgents =
    scope === 'tenant'
      ? (typeof rawLicensedAgents === 'number' && Number.isFinite(rawLicensedAgents) && rawLicensedAgents > 0
          ? Math.floor(rawLicensedAgents)
          : undefined)
      : undefined;

  return {
    enforceSystem: settings.enforceMembershipSystem,
    exempt: false,
    isActive,
    status,
    scope,
    targetId,
    targetName,
    initialMonthActivated,
    isDemo,
    demoUsed,
    initialActivatedAt: m?.initialActivatedAt,
    expiresAt,
    remainingMs,
    remainingDays,
    remainingHours,
    totalWeeksAdded: Number(m?.totalWeeksAdded) || 0,
    canActivateWeeks: initialMonthActivated,
    mustActivateInitialMonth: !initialMonthActivated,
    planCategory: scope === 'tenant' ? 'call_center' as const : 'individual' as const,
    licensedAgents,
    activeAgentsCount: scope === 'tenant' ? (typeof activeAgentsCount === 'number' ? activeAgentsCount : 0) : undefined,
    initialActivationPriceUsd,
    lastPaidAmountUsd,
    totalPaidUsd,
    customMonthPriceUsd:
      typeof m?.customMonthPriceUsd === 'number' && Number.isFinite(m.customMonthPriceUsd)
        ? roundUsd(m.customMonthPriceUsd)
        : undefined,
    customWeeklyPriceUsd:
      typeof m?.customWeeklyPriceUsd === 'number' && Number.isFinite(m.customWeeklyPriceUsd)
        ? roundUsd(m.customWeeklyPriceUsd)
        : undefined,
    history,
  };
}

function resolveEffectiveMembershipForUser(
  user: any,
  tenantsList?: any[],
  settings?: ServerMembershipSettings,
  usersList?: any[]
) {
  const s = settings || loadMembershipSettings();
  if (!user || isGlobalAdminUser(user)) {
    return {
      enforceSystem: s.enforceMembershipSystem,
      exempt: true,
      isActive: true,
      status: 'exempt' as const,
      scope: 'global_admin' as const,
      targetId: String(user?.id || 'global'),
      targetName: String(user?.name || 'Super Administrador Global'),
      initialMonthActivated: true,
      isDemo: false,
      demoUsed: false,
      remainingMs: 0,
      remainingDays: 9999,
      remainingHours: 0,
      totalWeeksAdded: 0,
      canActivateWeeks: true,
      mustActivateInitialMonth: false,
      history: [],
    };
  }

  if (user.tenantId && !user.membership?.independent) {
    const tList = Array.isArray(tenantsList) ? tenantsList : loadStoredTenants();
    const matchedTenant = tList.find((t: any) => t && String(t.id) === String(user.tenantId));
    if (matchedTenant) {
      const activeAgents = countActiveAgentsForTenant(String(matchedTenant.id), usersList);
      return evaluateMembershipRecord(
        matchedTenant.membership,
        s,
        'tenant',
        String(matchedTenant.id),
        String(matchedTenant.name || matchedTenant.code || matchedTenant.id),
        activeAgents,
        matchedTenant
      );
    }
  }

  return evaluateMembershipRecord(
    user.membership,
    s,
    'user',
    String(user.id || user.username || 'unknown'),
    String(user.name || user.username || 'Cliente')
  );
}

function applyMembershipActivation(
  currentMembership: any,
  params: {
    action: 'initial_month' | 'demo_1_day' | 'weekly_extension' | 'suspend' | 'reactivate' | 'plan_update' | 'reset';
    scope?: 'tenant' | 'user';
    weeksCount?: number;
    amountPaid?: number;
    licensedAgents?: number;
    customMonthPriceUsd?: number;
    customWeeklyPriceUsd?: number;
    clearCustomPrices?: boolean;
    paymentMethod?: string;
    reference?: string;
    notes?: string;
    requestApproved?: boolean;
  },
  performedBy: string,
  settings?: ServerMembershipSettings
): { ok: boolean; error?: string; membership?: any } {
  const s = settings || loadMembershipSettings();
  const scope: 'tenant' | 'user' = params.scope === 'tenant' ? 'tenant' : 'user';
  const prev = currentMembership && typeof currentMembership === 'object' ? { ...currentMembership } : {
    status: 'unactivated',
    initialMonthActivated: false,
    isDemo: false,
    demoUsed: false,
    totalWeeksAdded: 0,
    totalPaidUsd: 0,
    history: [],
  };
  const prevHistory = Array.isArray(prev.history) ? [...prev.history] : [];
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const prevExpiresMs = prev.expiresAt ? Date.parse(String(prev.expiresAt)) : NaN;
  const baseMs = !isNaN(prevExpiresMs) && prevExpiresMs > now ? prevExpiresMs : now;

  const resolvedAgents =
    scope === 'tenant'
      ? (typeof params.licensedAgents === 'number' && Number.isFinite(params.licensedAgents) && params.licensedAgents >= 1
          ? Math.floor(params.licensedAgents)
          : (typeof prev.licensedAgents === 'number' && prev.licensedAgents >= 1
              ? Math.floor(prev.licensedAgents)
              : undefined))
      : undefined;

  const nextCustomMonth = params.clearCustomPrices
    ? undefined
    : (typeof params.customMonthPriceUsd === 'number' && Number.isFinite(params.customMonthPriceUsd)
        ? roundUsd(Math.max(0, params.customMonthPriceUsd))
        : prev.customMonthPriceUsd);

  const nextCustomWeekly = params.clearCustomPrices
    ? undefined
    : (typeof params.customWeeklyPriceUsd === 'number' && Number.isFinite(params.customWeeklyPriceUsd)
        ? roundUsd(Math.max(0, params.customWeeklyPriceUsd))
        : prev.customWeeklyPriceUsd);

  if (params.action === 'demo_1_day') {
    if (prev.initialMonthActivated) {
      return {
        ok: false,
        error: 'Esta cuenta ya tiene su Membresía Principal activa; usa extensiones semanales.',
      };
    }
    const demoDays = Math.max(1, Number(s.demoDays) || 1);
    const newExpiresIso = new Date(baseMs + demoDays * 86400000).toISOString();
    const entry = {
      id: `mem-${now}-${Math.random().toString(36).slice(2, 7)}`,
      action: 'demo_1_day',
      daysAdded: demoDays,
      previousExpiresAt: prev.expiresAt || null,
      newExpiresAt: newExpiresIso,
      amountPaid: 0,
      ...(resolvedAgents ? { licensedAgents: resolvedAgents } : {}),
      paymentMethod: 'demo',
      reference: params.reference || 'DEMO',
      notes: params.notes || `Demo de Prueba (${demoDays} ${demoDays === 1 ? 'Día' : 'Días'})`,
      performedBy,
      timestamp: nowIso,
    };
    return {
      ok: true,
      membership: {
        ...prev,
        status: 'active',
        initialMonthActivated: false,
        isDemo: true,
        demoUsed: true,
        demoActivatedAt: nowIso,
        expiresAt: newExpiresIso,
        lastRenewedAt: nowIso,
        totalWeeksAdded: Number(prev.totalWeeksAdded) || 0,
        planCategory: scope === 'tenant' ? 'call_center' : 'individual',
        ...(resolvedAgents ? { licensedAgents: resolvedAgents } : {}),
        history: [entry, ...prevHistory].slice(0, 60),
      },
    };
  }

  if (params.action === 'initial_month') {
    const daysToAdd = s.initialMonthDays;
    const newExpiresIso = new Date(baseMs + daysToAdd * 86400000).toISOString();
    const suggested = calculateSuggestedMembershipPrice(scope, 'initial_month', prev, s, 1, resolvedAgents);
    const chargedAmount =
      typeof params.amountPaid === 'number' && Number.isFinite(params.amountPaid)
        ? roundUsd(Math.max(0, params.amountPaid))
        : suggested;
    const prevTotal =
      typeof prev.totalPaidUsd === 'number' && Number.isFinite(prev.totalPaidUsd)
        ? prev.totalPaidUsd
        : prevHistory
            .filter((h) => typeof h?.amountPaid === 'number' && h.action !== 'demo_1_day')
            .reduce((acc, h) => acc + Math.max(0, Number(h.amountPaid) || 0), 0);
    const nextTotalPaid = roundUsd(prevTotal + chargedAmount);

    const entry = {
      id: `mem-${now}-${Math.random().toString(36).slice(2, 7)}`,
      action: params.requestApproved ? 'request_approved' : 'initial_month',
      daysAdded: daysToAdd,
      previousExpiresAt: prev.expiresAt || null,
      newExpiresAt: newExpiresIso,
      amountPaid: chargedAmount,
      ...(resolvedAgents ? { licensedAgents: resolvedAgents } : {}),
      paymentMethod: params.paymentMethod || 'admin',
      reference: params.reference || '',
      notes:
        params.notes ||
        (scope === 'tenant' && resolvedAgents
          ? `Activación Plan Call Center (${resolvedAgents} agentes, ${daysToAdd} días) — $${chargedAmount} USD`
          : `Activación Membresía Principal de 1 Mes (${daysToAdd} días) — $${chargedAmount} USD`),
      performedBy,
      timestamp: nowIso,
    };
    const nextMembership: any = {
      ...prev,
      status: 'active',
      initialMonthActivated: true,
      isDemo: false,
      initialActivatedAt: prev.initialActivatedAt || nowIso,
      expiresAt: newExpiresIso,
      lastRenewedAt: nowIso,
      totalWeeksAdded: Number(prev.totalWeeksAdded) || 0,
      planCategory: scope === 'tenant' ? 'call_center' : 'individual',
      initialActivationPriceUsd: chargedAmount,
      lastPaidAmountUsd: chargedAmount,
      totalPaidUsd: nextTotalPaid,
      history: [entry, ...prevHistory].slice(0, 60),
    };
    if (resolvedAgents) nextMembership.licensedAgents = resolvedAgents;
    if (nextCustomMonth !== undefined) nextMembership.customMonthPriceUsd = nextCustomMonth;
    else delete nextMembership.customMonthPriceUsd;
    if (nextCustomWeekly !== undefined) nextMembership.customWeeklyPriceUsd = nextCustomWeekly;
    else delete nextMembership.customWeeklyPriceUsd;
    return {
      ok: true,
      membership: nextMembership,
    };
  }

  if (params.action === 'weekly_extension') {
    if (!prev.initialMonthActivated) {
      return {
        ok: false,
        error: 'Primera activación obligatoria: primero debes activar la Membresía Principal de 1 Mes (30 días) antes de activar semanas.',
      };
    }
    const weeks = Math.floor(Number(params.weeksCount) || 0);
    if (!Number.isFinite(weeks) || weeks < 1 || weeks > 104) {
      return {
        ok: false,
        error: 'La cantidad de semanas debe ser un número entero entre 1 y 104.',
      };
    }
    const daysToAdd = weeks * s.weekDays;
    const newExpiresIso = new Date(baseMs + daysToAdd * 86400000).toISOString();
    const suggested = calculateSuggestedMembershipPrice(scope, 'weekly_extension', prev, s, weeks, resolvedAgents);
    const chargedAmount =
      typeof params.amountPaid === 'number' && Number.isFinite(params.amountPaid)
        ? roundUsd(Math.max(0, params.amountPaid))
        : suggested;
    const prevTotal =
      typeof prev.totalPaidUsd === 'number' && Number.isFinite(prev.totalPaidUsd)
        ? prev.totalPaidUsd
        : prevHistory
            .filter((h) => typeof h?.amountPaid === 'number' && h.action !== 'demo_1_day')
            .reduce((acc, h) => acc + Math.max(0, Number(h.amountPaid) || 0), 0);
    const nextTotalPaid = roundUsd(prevTotal + chargedAmount);

    const entry = {
      id: `mem-${now}-${Math.random().toString(36).slice(2, 7)}`,
      action: params.requestApproved ? 'request_approved' : 'weekly_extension',
      weeksAdded: weeks,
      daysAdded: daysToAdd,
      previousExpiresAt: prev.expiresAt || null,
      newExpiresAt: newExpiresIso,
      amountPaid: chargedAmount,
      ...(resolvedAgents ? { licensedAgents: resolvedAgents } : {}),
      paymentMethod: params.paymentMethod || 'admin',
      reference: params.reference || '',
      notes:
        params.notes ||
        (scope === 'tenant' && resolvedAgents
          ? `Extensión Call Center +${weeks} ${weeks === 1 ? 'sem' : 'sems'} (${resolvedAgents} agentes, ${daysToAdd}d) — $${chargedAmount} USD`
          : `Extensión de +${weeks} ${weeks === 1 ? 'semana' : 'semanas'} (${daysToAdd} días) — $${chargedAmount} USD`),
      performedBy,
      timestamp: nowIso,
    };
    const nextMembership: any = {
      ...prev,
      status: 'active',
      initialMonthActivated: true,
      isDemo: false,
      expiresAt: newExpiresIso,
      lastRenewedAt: nowIso,
      totalWeeksAdded: (Number(prev.totalWeeksAdded) || 0) + weeks,
      planCategory: scope === 'tenant' ? 'call_center' : 'individual',
      lastPaidAmountUsd: chargedAmount,
      totalPaidUsd: nextTotalPaid,
      history: [entry, ...prevHistory].slice(0, 60),
    };
    if (resolvedAgents) nextMembership.licensedAgents = resolvedAgents;
    if (nextCustomMonth !== undefined) nextMembership.customMonthPriceUsd = nextCustomMonth;
    else delete nextMembership.customMonthPriceUsd;
    if (nextCustomWeekly !== undefined) nextMembership.customWeeklyPriceUsd = nextCustomWeekly;
    else delete nextMembership.customWeeklyPriceUsd;
    return {
      ok: true,
      membership: nextMembership,
    };
  }

  if (params.action === 'plan_update') {
    const descParts: string[] = [];
    if (scope === 'tenant' && resolvedAgents) descParts.push(`${resolvedAgents} agentes`);
    if (nextCustomMonth !== undefined) descParts.push(`1er Mes $${nextCustomMonth} USD`);
    if (nextCustomWeekly !== undefined) descParts.push(`Semanal $${nextCustomWeekly} USD`);
    if (params.clearCustomPrices) descParts.push('Tarifas personalizadas restablecidas a estándar');
    const entry = {
      id: `mem-${now}-${Math.random().toString(36).slice(2, 7)}`,
      action: 'plan_update',
      daysAdded: 0,
      previousExpiresAt: prev.expiresAt || null,
      newExpiresAt: prev.expiresAt || nowIso,
      ...(resolvedAgents ? { licensedAgents: resolvedAgents } : {}),
      notes: params.notes || `Actualización de plan/precios (${descParts.join(' · ') || 'Configuración'})`,
      performedBy,
      timestamp: nowIso,
    };
    const nextMembership: any = {
      ...prev,
      planCategory: scope === 'tenant' ? 'call_center' : 'individual',
      history: [entry, ...prevHistory].slice(0, 60),
    };
    if (resolvedAgents) nextMembership.licensedAgents = resolvedAgents;
    if (nextCustomMonth !== undefined) nextMembership.customMonthPriceUsd = nextCustomMonth;
    else delete nextMembership.customMonthPriceUsd;
    if (nextCustomWeekly !== undefined) nextMembership.customWeeklyPriceUsd = nextCustomWeekly;
    else delete nextMembership.customWeeklyPriceUsd;
    return {
      ok: true,
      membership: nextMembership,
    };
  }

  if (params.action === 'suspend') {
    const entry = {
      id: `mem-${now}-${Math.random().toString(36).slice(2, 7)}`,
      action: 'suspended',
      daysAdded: 0,
      previousExpiresAt: prev.expiresAt || null,
      newExpiresAt: prev.expiresAt || nowIso,
      notes: params.notes || 'Membresía suspendida por el Administrador',
      performedBy,
      timestamp: nowIso,
    };
    return {
      ok: true,
      membership: {
        ...prev,
        status: 'suspended',
        history: [entry, ...prevHistory].slice(0, 60),
      },
    };
  }

  if (params.action === 'reactivate') {
    if (!prev.initialMonthActivated && !prev.demoUsed) {
      return {
        ok: false,
        error: 'No se puede reactivar: esta cuenta aún no tiene activado un Demo ni su Membresía Principal de 1 Mes.',
      };
    }
    const stillValid = !isNaN(prevExpiresMs) && prevExpiresMs > now;
    const entry = {
      id: `mem-${now}-${Math.random().toString(36).slice(2, 7)}`,
      action: 'reactivated',
      daysAdded: 0,
      previousExpiresAt: prev.expiresAt || null,
      newExpiresAt: prev.expiresAt || nowIso,
      notes: params.notes || 'Membresía reactivada por el Administrador',
      performedBy,
      timestamp: nowIso,
    };
    return {
      ok: true,
      membership: {
        ...prev,
        status: stillValid ? 'active' : 'expired',
        history: [entry, ...prevHistory].slice(0, 60),
      },
    };
  }

  if (params.action === 'reset') {
    const entry = {
      id: `mem-${now}-${Math.random().toString(36).slice(2, 7)}`,
      action: 'reset',
      daysAdded: 0,
      previousExpiresAt: prev.expiresAt || null,
      newExpiresAt: nowIso,
      notes: params.notes || 'Membresía reiniciada (requiere 1er Mes nuevamente)',
      performedBy,
      timestamp: nowIso,
    };
    return {
      ok: true,
      membership: {
        status: 'unactivated',
        initialMonthActivated: false,
        isDemo: false,
        demoUsed: false,
        totalWeeksAdded: 0,
        planCategory: scope === 'tenant' ? 'call_center' : 'individual',
        ...(resolvedAgents ? { licensedAgents: resolvedAgents } : {}),
        ...(typeof prev.totalPaidUsd === 'number' ? { totalPaidUsd: prev.totalPaidUsd } : {}),
        history: [entry, ...prevHistory].slice(0, 60),
      },
    };
  }

  return { ok: false, error: 'Acción de membresía no válida.' };
}

function syncMembershipToAstDb(targetType: 'user' | 'tenant', targetId: string, membership: any) {
  if (!hasLocalAsterisk || !targetId) return;
  const cleanId = String(targetId).replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!cleanId) return;
  const statusVal = String(membership?.status || 'unactivated');
  const expiresVal = String(membership?.expiresAt || '');
  executeAsteriskCommand(`database put membership_${targetType} ${cleanId} "${statusVal}"`).catch(() => {});
  if (expiresVal) {
    executeAsteriskCommand(`database put membership_${targetType}_exp ${cleanId} "${expiresVal}"`).catch(() => {});
  }
}

function sanitizeUserForClient(u: any) {
  if (!u || typeof u !== 'object') return u;
  const { password: _p, passwordHash: _ph, sipSecret: _ss, ...rest } = u;
  try {
    rest.effectiveMembership = resolveEffectiveMembershipForUser(u);
  } catch (_) {}
  return rest;
}

function buildRemoteAuthHeaders(req?: express.Request, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'x-governor-fwd': 'true',
    ...extra,
  };
  const reqAuth = req?.headers?.authorization ? String(req.headers.authorization) : '';
  const envToken = String(process.env.REMOTE_ASTERISK_TOKEN || '').trim();
  if (reqAuth) {
    headers['Authorization'] = reqAuth;
  } else if (envToken) {
    headers['Authorization'] = envToken.startsWith('Bearer ') ? envToken : `Bearer ${envToken}`;
  }
  return headers;
}

function extractTokenFromRequest(req: express.Request): string {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  const queryToken = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
  return queryToken;
}

function resolveAuthenticatedUser(req: express.Request): any | null {
  const token = extractTokenFromRequest(req);
  const payload = verifyAuthToken(token);
  if (!payload) return null;
  const users = loadStoredUsers();
  const matched = users.find(
    (u: any) =>
      u &&
      (String(u.id) === String(payload.sub) ||
        String(u.username || '').toLowerCase() === String(payload.username || '').toLowerCase())
  );
  if (matched) {
    if (matched.status === 'inactive') return null;
    return matched;
  }
  return {
    id: payload.sub,
    username: payload.username,
    role: payload.role,
    tenantId: payload.tenantId,
    assignedExtensions: payload.assignedExtensions || [],
    status: 'active',
  };
}

function isGlobalAdminUser(user: any): boolean {
  return Boolean(user && user.role === 'admin' && !user.tenantId);
}

function isAdminUser(user: any): boolean {
  return Boolean(user && (user.role === 'admin' || user.role === 'supervisor'));
}

function requireApiAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = resolveAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Sesión requerida o expirada. Inicia sesión nuevamente.' });
  }
  (req as any).authUser = user;
  next();
}

function requireAdminRole(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = (req as any).authUser || resolveAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Autenticación requerida.' });
  }
  if (!isAdminUser(user)) {
    return res.status(403).json({ success: false, error: 'Permisos insuficientes (requiere Administrador o Supervisor).' });
  }
  next();
}

function requireGlobalAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = (req as any).authUser || resolveAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Autenticación requerida.' });
  }
  if (!isGlobalAdminUser(user)) {
    return res.status(403).json({ success: false, error: 'Acceso restringido al Super Administrador global.' });
  }
  next();
}

function requireInternalOrGlobalAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (isInternalAsteriskWebhook(req) || isGlobalAdminUser((req as any).authUser)) {
    return next();
  }
  return res.status(403).json({ success: false, error: 'Endpoint interno restringido a webhooks de Asterisk o Super Administrador Global.' });
}

function requireActiveMembership(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (isInternalAsteriskWebhook(req)) {
    return next();
  }
  const authUser = (req as any).authUser || resolveAuthenticatedUser(req);
  if (!authUser) {
    return res.status(401).json({ success: false, error: 'Autenticación requerida.' });
  }
  if (isGlobalAdminUser(authUser)) {
    return next();
  }
  const effective = resolveEffectiveMembershipForUser(authUser);
  if (effective.exempt || effective.isActive) {
    return next();
  }
  const reasonMsg =
    effective.status === 'suspended'
      ? 'Tu membresía se encuentra suspendida por el Administrador.'
      : effective.status === 'expired'
      ? 'Tu membresía ha vencido. Activa una extensión por semanas en el módulo Mi Membresía para continuar operando.'
      : 'Debes activar tu Membresía Principal de 1 Mes (30 días) para comenzar a operar en el sistema.';
  return res.status(403).json({
    success: false,
    code: 'MEMBERSHIP_REQUIRED',
    error: reasonMsg,
    membership: effective,
  });
}

// Native AMI Action: Hangup directly to Asterisk socket
export function amiHangupChannel(channelName: string, host = AMI_HOST, port = AMI_PORT, user = AMI_USER, secret = AMI_SECRET): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    let loggedIn = false;
    let hangupSent = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { socket.destroy(); } catch (_) {}
        resolve(false);
      }
    }, 2800);

    socket.connect(port, host, () => {
      socket.write(`Action: Login\r\nUsername: ${user}\r\nSecret: ${secret}\r\nActionID: hup_login\r\nEvents: off\r\n\r\n`);
    });

    let buf = '';
    socket.on('data', (d) => {
      buf += d.toString();

      // Step 1: Wait for login success
      if (!loggedIn && (buf.includes('ActionID: hup_login') || buf.includes('Authentication accepted'))) {
        loggedIn = true;
        hangupSent = true;
        buf = ''; // Clear buffer so login success does not trigger hangup check
        socket.write(`Action: Hangup\r\nChannel: ${channelName}\r\nCause: 16\r\nActionID: hup_cmd\r\n\r\n`);
        return;
      }

      // Step 2: Wait for hangup response
      if (hangupSent && (buf.includes('ActionID: hup_cmd') || buf.includes('Response: Success') || buf.includes('Response: Error') || buf.includes('Message: Channel hung up') || buf.includes('No such channel'))) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          try {
            socket.write('Action: Logoff\r\n\r\n');
            setTimeout(() => {
              try { socket.destroy(); } catch (_) {}
            }, 60);
          } catch (_) {}
          resolve(true);
        }
      }
    });

    socket.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(false);
      }
    });
  });
}

// High-speed memory cache for Asterisk CLI queries to prevent socket flooding, CPU spikes, and Asterisk lockup
interface CliCacheEntry {
  output: string;
  timestamp: number;
}
const cliCommandCache = new Map<string, CliCacheEntry>();
const inFlightCliCommands = new Map<string, Promise<string>>();
let isLocalCliRunning = false;

interface JsonFileCacheEntry {
  mtimeMs: number;
  data: any;
}
const jsonFileMemCache = new Map<string, JsonFileCacheEntry>();

function getFileMtimeMsSafe(filePath: string): number {
  try {
    if (filePath && fs.existsSync(filePath)) {
      return fs.statSync(filePath).mtimeMs || 0;
    }
  } catch (_) {}
  return 0;
}

function getMaxMtimeMs(paths: string[]): number {
  let max = 0;
  for (const p of paths) {
    const m = getFileMtimeMsSafe(p);
    if (m > max) max = m;
  }
  return max;
}

function readJsonFileCached<T = any>(filePath: string): T | null {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      jsonFileMemCache.delete(filePath);
      return null;
    }
    const mtimeMs = fs.statSync(filePath).mtimeMs || 0;
    const cached = jsonFileMemCache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.data as T;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    jsonFileMemCache.set(filePath, { mtimeMs, data: parsed });
    return parsed as T;
  } catch (_) {
    return null;
  }
}

function invalidateJsonFileCache(filePath: string, nextData?: any) {
  if (!filePath) return;
  if (nextData !== undefined) {
    try {
      if (fs.existsSync(filePath)) {
        const mtimeMs = fs.statSync(filePath).mtimeMs || Date.now();
        jsonFileMemCache.set(filePath, { mtimeMs, data: nextData });
        return;
      }
    } catch (_) {}
  }
  jsonFileMemCache.delete(filePath);
}

// ==============================================================================
// SERVER TELEMETRY & EXPONENTIAL BACKOFF FOR AMI
// ==============================================================================

export interface ServerTelemetryLog {
  id: string;
  timestamp: string;
  type: 'AMI' | 'ARI' | 'CLI' | 'SYSTEM' | 'PJSIP';
  message: string;
  payload?: string;
  status: 'success' | 'warning' | 'error';
}

const serverTelemetryLogs: ServerTelemetryLog[] = [
  {
    id: `log-init-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString(),
    type: 'SYSTEM',
    message: 'Sistema Asterisk 20 con control de concurrencia y Backoff Exponencial AMI activo.',
    payload: 'Diagnóstico: Bucle de "Remote UNIX connection" neutralizado con caché de lectura y control de reconexión.',
    status: 'success',
  },
];

export function addServerTelemetryLog(
  type: 'AMI' | 'ARI' | 'CLI' | 'SYSTEM' | 'PJSIP',
  message: string,
  payload?: string,
  status: 'success' | 'warning' | 'error' = 'success'
) {
  const entry: ServerTelemetryLog = {
    id: `srv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toLocaleTimeString(),
    type,
    message,
    payload,
    status,
  };
  serverTelemetryLogs.unshift(entry);
  if (serverTelemetryLogs.length > 250) {
    serverTelemetryLogs.length = 250;
  }
}

// Circuit Breaker & Exponential Backoff State for AMI
export interface AmiHealthState {
  consecutiveFailures: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  nextAllowedAttemptTime: number;
  currentDelayMs: number;
  lastError: string;
  isCircuitOpen: boolean;
  totalAttempts: number;
  successfulAttempts: number;
}

const amiHealthState: AmiHealthState = {
  consecutiveFailures: 0,
  lastFailureTime: 0,
  lastSuccessTime: 0,
  nextAllowedAttemptTime: 0,
  currentDelayMs: 1000,
  lastError: '',
  isCircuitOpen: false,
  totalAttempts: 0,
  successfulAttempts: 0,
};

const AMI_BASE_BACKOFF_MS = 1000;  // 1s base delay
const AMI_MAX_BACKOFF_MS = 32000;  // 32s max delay cap
const AMI_TIMEOUT_MS = 3000;       // 3s socket connection timeout

function recordAmiSuccess() {
  amiHealthState.successfulAttempts += 1;
  if (amiHealthState.consecutiveFailures > 0 || amiHealthState.isCircuitOpen) {
    addServerTelemetryLog(
      'AMI',
      `[AMI RESTABLECIDO] Conexión TCP :5038 recuperada exitosamente tras ${amiHealthState.consecutiveFailures} reintentos. Circuito CERRADO.`,
      undefined,
      'success'
    );
  }
  amiHealthState.consecutiveFailures = 0;
  amiHealthState.currentDelayMs = AMI_BASE_BACKOFF_MS;
  amiHealthState.nextAllowedAttemptTime = 0;
  amiHealthState.isCircuitOpen = false;
  amiHealthState.lastSuccessTime = Date.now();
  amiHealthState.lastError = '';
}

function recordAmiFailure(errMsg: string) {
  const now = Date.now();
  amiHealthState.consecutiveFailures += 1;
  amiHealthState.lastFailureTime = now;
  amiHealthState.lastError = errMsg;

  // Exponential backoff: min(MAX, BASE * 2^(failures - 1)) + jitter
  const exponent = Math.min(amiHealthState.consecutiveFailures - 1, 5);
  const calculatedDelay = Math.min(
    AMI_MAX_BACKOFF_MS,
    AMI_BASE_BACKOFF_MS * Math.pow(2, exponent)
  );
  // Add 10-15% jitter to prevent thundering herd
  const jitter = Math.floor(Math.random() * (calculatedDelay * 0.15));
  amiHealthState.currentDelayMs = calculatedDelay + jitter;
  amiHealthState.nextAllowedAttemptTime = now + amiHealthState.currentDelayMs;
  amiHealthState.isCircuitOpen = true;

  const cooldownSec = Math.round(amiHealthState.currentDelayMs / 1000);
  addServerTelemetryLog(
    'AMI',
    `[AMI BACKOFF EXPONENCIAL] Fallo #${amiHealthState.consecutiveFailures} en socket 5038: "${errMsg}". Cooldown de reconexión: ${cooldownSec}s`,
    `Fórmula: min(${AMI_MAX_BACKOFF_MS}ms, ${AMI_BASE_BACKOFF_MS}ms * 2^${exponent}) + jitter => ${amiHealthState.currentDelayMs}ms. Siguiente intento permitido: ${new Date(amiHealthState.nextAllowedAttemptTime).toLocaleTimeString()}`,
    'warning'
  );
}

export function resetAmiBackoff() {
  amiHealthState.consecutiveFailures = 0;
  amiHealthState.currentDelayMs = AMI_BASE_BACKOFF_MS;
  amiHealthState.nextAllowedAttemptTime = 0;
  amiHealthState.isCircuitOpen = false;
  amiHealthState.lastError = '';
  addServerTelemetryLog(
    'AMI',
    `[AMI BACKOFF RESET] Circuito restablecido manualmente por operador. Listo para reconectar.`,
    undefined,
    'success'
  );
}

// Helper to invalidate CLI cache when write actions occur
export function invalidateCliCache(pattern?: string) {
  if (!pattern) {
    cliCommandCache.clear();
  } else {
    for (const key of Array.from(cliCommandCache.keys())) {
      if (key.includes(pattern)) {
        cliCommandCache.delete(key);
      }
    }
  }
}

function hasAnyLiveCallInStore(now = Date.now()): boolean {
  try {
    for (const call of callStatusStore.values()) {
      if (call.status !== 'ended' && call.status !== 'machine' && now - call.timestamp < 1800000) {
        return true;
      }
    }
  } catch (_) {}
  return false;
}

export async function executeAsteriskCommand(cmd: string): Promise<string> {
  const cleanCmd = String(cmd || '').trim();
  if (!cleanCmd || /^\s*!/.test(cleanCmd) || /[\r\n\0`]|;\s*!/.test(cleanCmd)) {
    return '';
  }

  const isChannelsCheck = cleanCmd.includes('core show channels');
  const isReadOnly =
    cleanCmd.startsWith('show') ||
    cleanCmd.startsWith('core show') ||
    cleanCmd.startsWith('pjsip show') ||
    cleanCmd.startsWith('database show') ||
    cleanCmd.startsWith('moh show') ||
    cleanCmd.startsWith('manager show') ||
    cleanCmd.startsWith('ari show') ||
    cleanCmd.includes('show channels');
  const now = Date.now();

  // Dynamic TTL based on query type and whether any call is currently active
  const ttl = isChannelsCheck
    ? (hasAnyLiveCallInStore(now) ? 4500 : 8000)
    : (cleanCmd.startsWith('pjsip show')
      ? 10000
      : (cleanCmd.startsWith('database show') ? 15000 : 6000));

  // 0. Return cached read-only result immediately (0ms) if within TTL
  if (isReadOnly) {
    const cached = cliCommandCache.get(cleanCmd);
    if (cached && (now - cached.timestamp < ttl)) {
      return cached.output;
    }
    // Deduplicate concurrent identical read-only queries so we never spawn duplicate subprocesses
    const existingPromise = inFlightCliCommands.get(cleanCmd);
    if (existingPromise) {
      return existingPromise;
    }
  }

  const runCommandInternal = async (): Promise<string> => {
    // 1. Try local CLI ONLY if asterisk daemon is running
    if (hasLocalAsterisk) {
      // If Asterisk daemon socket does not exist, Asterisk is stopped - do NOT spawn useless failing subprocesses
      if (!fs.existsSync('/var/run/asterisk/asterisk.ctl')) {
        return isReadOnly ? (cliCommandCache.get(cleanCmd)?.output || '') : '';
      }

      // If local CLI is currently busy running a command and this is a read request, return cached
      // to strictly prevent concurrent UNIX socket collisions that choke Asterisk PJSIP
      if (isLocalCliRunning && isReadOnly) {
        const existing = cliCommandCache.get(cleanCmd);
        if (existing) return existing.output;
      }

      try {
        isLocalCliRunning = true;
        const bin = getAsteriskBinary();
        const localExec = await new Promise<{ output: string; ok: boolean }>((resolve) => {
          execFile(bin, ['-rx', cleanCmd], { timeout: 2500 }, (err, stdout) => {
            if (!err && stdout !== undefined && stdout !== null) {
              resolve({ output: String(stdout).trim(), ok: true });
            } else {
              resolve({ output: '', ok: false });
            }
          });
        });

        // Cache ONLY valid (ok === true) read results; never cache failed/timed-out CLI calls
        if (localExec.ok) {
          if (isReadOnly) {
            cliCommandCache.set(cleanCmd, { output: localExec.output, timestamp: Date.now() });
          } else {
            invalidateCliCache();
            addServerTelemetryLog('CLI', `[CLI MUTACIÓN] ${cleanCmd}`, localExec.output ? `Salida: ${localExec.output.substring(0, 100)}` : undefined, 'success');
          }
          return localExec.output;
        }
      } catch (_) {}
      finally {
        isLocalCliRunning = false;
      }

      // CRITICAL: If local Asterisk daemon socket exists, local CLI is authoritative.
      if (isReadOnly) {
        return cliCommandCache.get(cleanCmd)?.output || '';
      }
    }

    // 2. Try remote VPS HTTP bridge with Circuit Breaker
    const isCircuitOpen = remoteConsecutiveFailures >= 2 && (Date.now() - remoteLastFailureTime < 25000);

    // If remote VPS is down/timing out, skip read-only requests immediately so UI never hangs
    if (isCircuitOpen && isReadOnly) {
      return cliCommandCache.get(cleanCmd)?.output || '';
    }

    if (REMOTE_ASTERISK_HTTP) {
      try {
        const controller = new AbortController();
        const timeoutMs = isCircuitOpen ? 800 : (isReadOnly ? 1200 : 2500);
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const resp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/ami/test`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...buildRemoteAuthHeaders(undefined, { 'x-internal-webhook-key': INTERNAL_WEBHOOK_KEY }),
          },
          body: JSON.stringify({ command: cleanCmd }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (resp.ok) {
          const data = (await resp.json()) as any;
          if (data && data.output !== undefined) {
            remoteConsecutiveFailures = 0;
            remoteLastSuccessTime = Date.now();
            if (isReadOnly) {
              cliCommandCache.set(cleanCmd, { output: data.output, timestamp: Date.now() });
            }
            return data.output;
          }
        } else {
          remoteConsecutiveFailures++;
          remoteLastFailureTime = Date.now();
        }
      } catch (_) {
        remoteConsecutiveFailures++;
        remoteLastFailureTime = Date.now();
      }
    }

    // 3. Fallback to raw local AMI socket only if local Asterisk might exist and local ctl wasn't reachable
    if (hasLocalAsterisk && !fs.existsSync('/var/run/asterisk/asterisk.ctl')) {
      try {
        const amiRes = await sendAmiAction('127.0.0.1', AMI_PORT, AMI_USER, AMI_SECRET, [cleanCmd]);
        if (amiRes && !amiRes.startsWith('AMI Error') && !amiRes.startsWith('AMI Backoff')) {
          if (isReadOnly) {
            cliCommandCache.set(cleanCmd, { output: amiRes, timestamp: Date.now() });
          }
          return amiRes;
        }
      } catch (_) {}
    }

    return cliCommandCache.get(cleanCmd)?.output || '';
  };

  if (isReadOnly) {
    const promise = runCommandInternal().finally(() => {
      inFlightCliCommands.delete(cleanCmd);
    });
    inFlightCliCommands.set(cleanCmd, promise);
    return promise;
  }

  return runCommandInternal();
}

const amiQueryCache = new Map<string, { output: string; timestamp: number }>();

function sendAmiAction(host = AMI_HOST, port = AMI_PORT, user = AMI_USER, secret = AMI_SECRET, commands: string[]): Promise<string> {
  const isChannelsCheck = commands.length === 1 && commands[0].includes('core show channels');
  const isReadOnly = commands.length === 1 && (
    commands[0].startsWith('core show') ||
    commands[0].startsWith('pjsip show') ||
    commands[0].startsWith('database show')
  );
  const now = Date.now();

  // If it's a routine channel poll and we have a fresh response from < 8s ago, reuse cache to avoid spamming CLI
  if (isChannelsCheck && amiCachedResult && (now - amiCachedResult.timestamp) < 8000) {
    return Promise.resolve(amiCachedResult.data);
  }

  if (isReadOnly) {
    const cachedAmi = amiQueryCache.get(commands[0]);
    if (cachedAmi && now - cachedAmi.timestamp < 5000) {
      return Promise.resolve(cachedAmi.output);
    }
  }

  // If another query is already in flight, return cached if available or wait
  if (isAmiExecuting && amiCachedResult) {
    return Promise.resolve(amiCachedResult.data);
  }

  // 1. Backoff Check: If circuit is open and we haven't reached nextAllowedAttemptTime, reject immediately!
  // This prevents freezing the Node.js event loop and socket descriptor exhaustion
  if (amiHealthState.isCircuitOpen && now < amiHealthState.nextAllowedAttemptTime) {
    const remainingSec = Math.max(1, Math.ceil((amiHealthState.nextAllowedAttemptTime - now) / 1000));
    const backoffNotice = `AMI Backoff activo (${remainingSec}s restantes) tras fallo: ${amiHealthState.lastError || 'Conexión rechazada'}`;
    return Promise.resolve(amiCachedResult?.data || `AMI Error: ${backoffNotice}`);
  }

  amiHealthState.totalAttempts += 1;
  isAmiExecuting = true;

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buffer = '';
    let loggedIn = false;
    let isSettled = false;

    const finalize = (output: string, isErr = false, errDetail = '') => {
      if (isSettled) return;
      isSettled = true;
      isAmiExecuting = false;
      try { socket.destroy(); } catch (_) {}
      if (isErr) {
        recordAmiFailure(errDetail || 'Error desconocido en socket AMI');
      }
      resolve(output);
    };

    const timeout = setTimeout(() => {
      finalize(
        buffer || amiCachedResult?.data || 'Timeout AMI (3s)',
        true,
        `Timeout de respuesta (${AMI_TIMEOUT_MS}ms) en ${host}:${port}`
      );
    }, AMI_TIMEOUT_MS);

    socket.connect(port, host, () => {
      const loginPayload = `Action: Login\r\nUsername: ${user}\r\nSecret: ${secret}\r\nEvents: off\r\n\r\n`;
      socket.write(loginPayload);
    });

    socket.on('data', (data) => {
      const text = data.toString();
      buffer += text;

      if ((buffer.includes('Message: Authentication accepted') || buffer.includes('Response: Success')) && !loggedIn) {
        loggedIn = true;
        recordAmiSuccess();
        for (const cmd of commands) {
          socket.write(`Action: Command\r\nCommand: ${cmd}\r\n\r\n`);
        }
        setTimeout(() => {
          try { socket.write(`Action: Logoff\r\n\r\n`); } catch (_) {}
        }, 1200);
      }

      if (buffer.includes('Message: Authentication failed')) {
        clearTimeout(timeout);
        finalize(buffer, true, `Autenticación fallida para usuario '${user}'`);
        return;
      }

      if (loggedIn && (buffer.includes('--END COMMAND--') || buffer.includes('Response: Error'))) {
        setTimeout(() => {
          try { socket.write(`Action: Logoff\r\n\r\n`); } catch (_) {}
        }, 50);
      }

      if (buffer.includes('Response: Goodbye')) {
        clearTimeout(timeout);
        if (isChannelsCheck) {
          amiCachedResult = { data: buffer, timestamp: Date.now() };
        }
        finalize(buffer, false);
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      finalize(
        amiCachedResult?.data || `AMI Error: ${err.message}`,
        true,
        `${err.message} en ${host}:${port}`
      );
    });

    socket.on('close', () => {
      clearTimeout(timeout);
      if (isChannelsCheck && buffer) {
        amiCachedResult = { data: buffer, timestamp: Date.now() };
      }
      if (!loggedIn && !isSettled) {
        finalize(
          buffer || 'AMI Socket cerrado sin autenticación',
          true,
          `Conexión cerrada prematuramente en ${host}:${port}`
        );
      } else {
        finalize(buffer || amiCachedResult?.data || '', false);
      }
    });
  });
}

// ==========================================
// REAL-TIME CALL STATE & FAST AMI ORIGINATE
// ==========================================

export interface CallState {
  number: string;
  channel?: string;
  bridgedChannel?: string;
  status: 'dialing' | 'ringing' | 'in_ivr' | 'talking' | 'talking_agent' | 'on_hold' | 'pressed_1' | 'asking_cancel_code' | 'asking_otp' | 'otp_captured' | 'otp_valid' | 'otp_invalid' | 'cancel_valid' | 'cancel_invalid' | 'playing_audio' | 'audio_completed' | 'machine' | 'machine_detected' | 'retrying' | 'ended' | 'transferred';
  digit?: string;
  cause?: string;
  agent?: string;
  agentName?: string;
  clientName?: string;
  entityName?: string;
  entityId?: string;
  holdMusic?: string;
  holdMusicName?: string;
  trunk?: string;
  callerId?: string;
  tenantId?: string;
  userId?: string;
  isOnHold?: boolean;
  holdStartedAt?: number;
  mode?: string;
  capturedOtp?: string;
  otpStatus?: 'pending' | 'valid' | 'invalid';
  cancelDecision?: 'valid' | 'invalid' | 'pending';
  timestamp: number;
  startTime?: number;
  answeredAt?: number;
  pressed1At?: number;
  duration?: number;
}

const callStatusStore = new Map<string, CallState>();

// Helper to ensure /etc/asterisk/musiconhold.conf exists for reliable Music on Hold
function ensureMusiconholdConfExists(useCustomDir = false) {
  const mohPath = '/etc/asterisk/musiconhold.conf';
  const targetDir = useCustomDir ? '/var/lib/asterisk/moh_custom' : '/var/lib/asterisk/moh';
  const mohContent = `; ========================================================
; Asterisk Music on Hold Configuration (MOH)
; ========================================================
[general]

[default]
mode=files
directory=${targetDir}
sort=alpha

[custom]
mode=files
directory=${targetDir}
sort=alpha

[moh_bank]
mode=files
directory=${targetDir}
sort=alpha

[moh_corporate]
mode=files
directory=${targetDir}
sort=alpha

[moh_digital]
mode=files
directory=${targetDir}
sort=alpha
`;
  try {
    const existingMoh = fs.existsSync(mohPath) ? fs.readFileSync(mohPath, 'utf8') : '';
    if (existingMoh.trim() !== mohContent.trim()) {
      writeAsteriskConfigFile(mohPath, mohContent);
    }
    try {
      fs.writeFileSync(path.join(process.cwd(), 'musiconhold.conf'), mohContent, 'utf8');
    } catch (_) {}
  } catch (_) {}
}

// Helper to ensure /etc/asterisk/amd.conf exists and stays tuned for balanced Answering Machine Detection
function ensureAmdConfExists() {
  const amdPath = '/etc/asterisk/amd.conf';
  const localAmdPath = path.join(process.cwd(), 'amd.conf');
  const amdContent = `; ========================================================
; Asterisk Answering Machine Detection Configuration (AMD)
; Balanceado para detectar humanos rapido (~1.0-1.5s) sin cortar saludos reales
; y filtrar contestadores / buzones de voz cortos en EE. UU.
; ========================================================
[general]
initial_silence = 2000
greeting = 1500
after_greeting_silence = 800
total_analysis_time = 4500
min_word_length = 100
between_words_silence = 50
maximum_number_of_words = 4
silence_threshold = 256
maximum_word_length = 5000
`;
  try {
    let shouldWrite = !fs.existsSync(amdPath);
    if (!shouldWrite) {
      const current = fs.readFileSync(amdPath, 'utf8');
      if (
        current.includes('total_analysis_time = 3500') ||
        current.includes('total_analysis_time = 2400') ||
        current.includes('total_analysis_time = 2000') ||
        current.includes('total_analysis_time = 5000') ||
        current.includes('total_analysis_time = 5500') ||
        current.includes('greeting = 1100') ||
        current.includes('greeting = 2200') ||
        current.includes('maximum_number_of_words = 3') ||
        current.includes('maximum_number_of_words = 7') ||
        current.includes('initial_silence = 2500') ||
        current.includes('initial_silence = 3200') ||
        current.includes('initial_silence = 3500') ||
        current.includes('silence_threshold = 384') ||
        current.includes('maximum_on_length') ||
        !current.includes('total_analysis_time = 4500') ||
        !current.includes('initial_silence = 2000') ||
        !current.includes('greeting = 1500') ||
        !current.includes('maximum_number_of_words = 4')
      ) {
        shouldWrite = true;
      }
    }
    if (shouldWrite) {
      writeAsteriskConfigFile(amdPath, amdContent);
      console.log('✓ Configuración /etc/asterisk/amd.conf optimizada (AMD EE. UU.: initial=2000, greeting=1500, max_words=4, total=4500, silence=256)');
      if (hasLocalAsterisk) {
        const bin = getAsteriskBinary();
        exec(`"${bin}" -rx "module load app_amd.so" 2>/dev/null; "${bin}" -rx "module reload app_amd.so" 2>/dev/null`, () => {});
      }
    }
    fs.writeFileSync(localAmdPath, amdContent, 'utf8');
  } catch (_) {}
}

// Helper to ensure Asterisk codecs.conf, asterisk.conf timing options, rtp.conf, and manager.conf exist for crystal-clear bidirectional audio
function ensureAsteriskCoreOptionsConf() {
  const asteriskConfPath = '/etc/asterisk/asterisk.conf';
  if (!fs.existsSync(asteriskConfPath)) return;
  try {
    let raw = fs.readFileSync(asteriskConfPath, 'utf8');
    let changed = false;

    const ensureOption = (sectionBody: string, key: string, value: string): string => {
      const commentedOrSetRe = new RegExp(`^[;#\\s]*${key}\\s*=.*$`, 'mi');
      const desiredLine = `${key} = ${value}`;
      if (commentedOrSetRe.test(sectionBody)) {
        const next = sectionBody.replace(commentedOrSetRe, desiredLine);
        if (next !== sectionBody) changed = true;
        return next;
      }
      changed = true;
      return `${sectionBody.trimEnd()}\n${desiredLine}\n`;
    };

    const optionsHeaderRe = /^\[options\]\s*$/im;
    if (optionsHeaderRe.test(raw)) {
      const match = raw.match(/^\[options\][^\n]*(?:\r?\n([\s\S]*?))?(?=^[ \t]*\[[^\]]+\]|(?![\s\S]))/im);
      if (match && typeof match.index === 'number') {
        const fullSec = match[0];
        const nlIdx = fullSec.indexOf('\n');
        const headerLine = nlIdx >= 0 ? fullSec.slice(0, nlIdx + 1) : `${fullSec}\n`;
        let body = nlIdx >= 0 ? fullSec.slice(nlIdx + 1) : '';
        body = ensureOption(body, 'internal_timing', 'yes');
        body = ensureOption(body, 'transmit_silence', 'yes');
        body = ensureOption(body, 'highpriority', 'yes');
        const rebuilt = headerLine + body;
        if (rebuilt !== fullSec) {
          raw = raw.slice(0, match.index) + rebuilt + raw.slice(match.index + fullSec.length);
        }
      }
    } else {
      raw = `${raw.trimEnd()}\n\n[options]\ninternal_timing = yes\ntransmit_silence = yes\nhighpriority = yes\n`;
      changed = true;
    }

    if (changed) {
      writeAsteriskConfigFile(asteriskConfPath, raw);
      console.log('✓ Configuración /etc/asterisk/asterisk.conf optimizada (internal_timing=yes, transmit_silence=yes, highpriority=yes)');
    }
  } catch (_) {}
}

function ensureAudioCodecsAndRtpConfExists() {
  const codecsPath = '/etc/asterisk/codecs.conf';
  const codecsContent = `; ========================================================
; Asterisk Voice Codecs & Zero-Transcode Audio Stability
; ========================================================
[plc]
genericplc = true
genericplc_on_equal_codecs = false

[opus]
type=opus
max_playback_rate=16000
max_bandwidth=wideband
cbr=yes
fec=no
dtx=no

[speex]
type=speex
quality=8
complexity=2
enhancement=false
vad=false
vbr=false
`;

  const rtpPath = '/etc/asterisk/rtp.conf';
  const rtpContent = `; ========================================================
; Asterisk Real-time Transport Protocol (RTP) Configuration
; ========================================================
[general]
rtpstart=10000
rtpend=20000
rtpchecksums=no
strictrtp=no
probation=0
icesupport=no
`;

  try {
    let codecsUpdated = false;
    const existingCodecs = fs.existsSync(codecsPath) ? fs.readFileSync(codecsPath, 'utf8') : '';
    if (!existingCodecs || existingCodecs.trim() !== codecsContent.trim()) {
      writeAsteriskConfigFile(codecsPath, codecsContent);
      codecsUpdated = true;
      console.log('✓ Configuración /etc/asterisk/codecs.conf optimizada (PLC nativo sin distorsión y sin VBR robótico)');
    }
    ensureAsteriskCoreOptionsConf();
    if (hasLocalAsterisk && codecsUpdated) {
      exec('asterisk -rx "module load res_timing_timerfd.so" 2>/dev/null; asterisk -rx "module reload codec_opus.so" 2>/dev/null; asterisk -rx "module reload codec_speex.so" 2>/dev/null', () => {});
    } else if (hasLocalAsterisk) {
      exec('asterisk -rx "module load res_timing_timerfd.so" 2>/dev/null', () => {});
    }
    const existingRtp = fs.existsSync(rtpPath) ? fs.readFileSync(rtpPath, 'utf8') : '';
    const rtpUpdated = !existingRtp || existingRtp.trim() !== rtpContent.trim();
    if (rtpUpdated) {
      writeAsteriskConfigFile(rtpPath, rtpContent);
      console.log('✓ Configuración /etc/asterisk/rtp.conf actualizada para audio inmediato');
    }
    if (hasLocalAsterisk && rtpUpdated) {
      exec('asterisk -rx "module reload res_rtp_asterisk.so" 2>/dev/null || true', () => {});
    }
    try { fs.writeFileSync(path.join(process.cwd(), 'rtp.conf'), rtpContent, 'utf8'); } catch (_) {}
    const mgrPath = '/etc/asterisk/manager.conf';
    const mgrContent = `[general]\nenabled = yes\nport = ${AMI_PORT}\nbindaddr = 127.0.0.1\n\n[${AMI_USER}]\nsecret = ${AMI_SECRET}\nread = all\nwrite = all\n\n[admin]\nsecret = ${AMI_ADMIN_SECRET}\nread = all\nwrite = all\n`;
    let shouldWriteMgr = !fs.existsSync(mgrPath);
    if (!shouldWriteMgr) {
      try {
        const curMgr = fs.readFileSync(mgrPath, 'utf8');
        const hasExpectedUser = new RegExp(`^\\[${AMI_USER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'm').test(curMgr);
        const hasExpectedSecret =
          curMgr.includes(`secret = ${AMI_SECRET}`) || curMgr.includes(`secret=${AMI_SECRET}`);
        if (
          !hasExpectedUser ||
          !hasExpectedSecret ||
          curMgr.includes('bindaddr = 0.0.0.0') ||
          curMgr.includes('bindaddr=0.0.0.0') ||
          curMgr.includes('mysecretpass')
        ) {
          shouldWriteMgr = true;
        }
      } catch (_) {}
    }
    if (shouldWriteMgr) {
      writeAsteriskConfigFile(mgrPath, mgrContent);
      console.log('✓ Configuración /etc/asterisk/manager.conf asegurada en 127.0.0.1 para AMI');
      if (hasLocalAsterisk) {
        exec('asterisk -rx "manager reload"', () => {});
      }
    }
  } catch (_) {}
}

function isPublicIpv4(ip: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const parts = ip.split('.').map(Number);
  if (parts.some((n) => isNaN(n) || n < 0 || n > 255)) return false;
  if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return false;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
  if (parts[0] === 192 && parts[1] === 168) return false;
  if (parts[0] === 169 && parts[1] === 254) return false;
  return true;
}

function getLocalPublicIpv4Sync(): string {
  const envIp = String(process.env.EXTERNAL_IP || process.env.PUBLIC_IP || '').trim();
  if (isPublicIpv4(envIp)) return envIp;
  try {
    const ifaces = os.networkInterfaces();
    for (const entries of Object.values(ifaces)) {
      if (!entries) continue;
      for (const iface of entries) {
        if (iface.family === 'IPv4' && !iface.internal && isPublicIpv4(iface.address)) {
          return iface.address;
        }
      }
    }
  } catch (_) {}
  return '';
}

let detectedExternalIp: string = getLocalPublicIpv4Sync();

async function resolvePublicIpv4Async(): Promise<string> {
  if (isPublicIpv4(detectedExternalIp)) return detectedExternalIp;
  const freshSync = getLocalPublicIpv4Sync();
  if (isPublicIpv4(freshSync)) {
    detectedExternalIp = freshSync;
    return detectedExternalIp;
  }
  const providers = [
    'https://api.ipify.org',
    'https://ifconfig.me/ip',
    'https://icanhazip.com',
    'https://checkip.amazonaws.com',
  ];
  for (const url of providers) {
    const ip = await new Promise<string>((resolve) => {
      try {
        const req = https.get(url, { timeout: 1800, headers: { 'User-Agent': 'curl/8.0' } }, (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => {
            const candidate = body.trim();
            resolve(isPublicIpv4(candidate) ? candidate : '');
          });
        });
        req.on('error', () => resolve(''));
        req.on('timeout', () => { try { req.destroy(); } catch (_) {} resolve(''); });
      } catch (_) {
        resolve('');
      }
    });
    if (ip) {
      detectedExternalIp = ip;
      return ip;
    }
  }
  return '';
}

function prioritizeZeroTranscodeCodecs(raw: string, isCarrierTrunk = false, isWebRtc = false): string {
  const rawList = raw
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  // Enforce pure G.711 (ulaw,alaw) across UDP/TCP extensions & trunks to guarantee ZERO CPU resampling/transcoding
  // against 8kHz IVR prompts and PSTN carriers (eliminating robotic/choppy Opus/G.722 resampling).
  // Allow Opus only for WebRTC (transport-wss).
  const blocked = (isCarrierTrunk || !isWebRtc)
    ? new Set(['g729', 'opus', 'g722', 'speex', 'ilbc', 'gsm'])
    : new Set(['g729', 'g722', 'speex', 'ilbc', 'gsm']);
  const list = rawList.filter((c) => !blocked.has(c));
  if (list.length === 0) return isWebRtc ? 'opus,ulaw,alaw' : 'ulaw,alaw';
  const ordered: string[] = [];
  if (list.includes('ulaw')) ordered.push('ulaw');
  if (list.includes('alaw')) ordered.push('alaw');
  for (const c of list) {
    if (!ordered.includes(c)) ordered.push(c);
  }
  return ordered.join(',');
}

// High-speed AMI Originate using direct asynchronous socket (under 20ms launch time)
function amiFastOriginate(
  channel: string,
  context: string,
  exten: string,
  callerId: string,
  variables: Record<string, string> = {}
): Promise<{ success: boolean; message: string }> {
  const now = Date.now();
  // Fail fast in 0ms when AMI circuit breaker is open so fallback spooler (.call) launches immediately
  if (amiHealthState.isCircuitOpen && now < amiHealthState.nextAllowedAttemptTime) {
    return Promise.resolve({
      success: false,
      message: `AMI Backoff activo (${amiHealthState.lastError || 'usando spooler .call'})`,
    });
  }

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    let originateSent = false;

    const finish = (result: { success: boolean; message: string }) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      try {
        socket.destroy();
      } catch (_) {}
      resolve(result);
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        if (originateSent) {
          recordAmiSuccess();
          finish({ success: true, message: 'AMI Originate enviado asíncronamente' });
        } else {
          recordAmiFailure('AMI Originate timeout');
          finish({ success: false, message: 'AMI Originate timeout' });
        }
      }
    }, 2000);

    socket.connect(AMI_PORT, AMI_HOST, () => {
      const loginPayload = `Action: Login\r\nUsername: ${AMI_USER}\r\nSecret: ${AMI_SECRET}\r\nEvents: off\r\n\r\n`;
      socket.write(loginPayload);
    });

    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString();

      // Fail-fast on authentication failure instead of burning the 2s timeout
      if (!originateSent && (buffer.includes('Message: Authentication failed') || buffer.includes('Response: Error'))) {
        recordAmiFailure('AMI Authentication failed (verificar manager.conf vs AMI_SECRET)');
        try {
          socket.write('Action: Logoff\r\n\r\n');
          socket.end();
        } catch (_) {}
        finish({ success: false, message: 'AMI Authentication failed' });
        return;
      }

      if (!originateSent && (buffer.includes('Message: Authentication accepted') || buffer.includes('Response: Success'))) {
        originateSent = true;
        let varLines = '';
        for (const [k, v] of Object.entries(variables)) {
          if (v !== undefined && v !== null && v !== '') {
            varLines += `Variable: ${k}=${v}\r\n`;
          }
        }
        const cleanCallerId = String(callerId || '').trim();
        const callerIdLine = cleanCallerId && cleanCallerId !== '"" <>' && !cleanCallerId.includes('5550199')
          ? `CallerID: ${cleanCallerId}\r\n`
          : '';
        const codecsLine = channel.startsWith('Local/') ? `Codecs: ulaw,alaw\r\n` : '';
        const originatePayload =
          `Action: Originate\r\n` +
          `Channel: ${channel}\r\n` +
          `Context: ${context}\r\n` +
          `Exten: ${exten}\r\n` +
          `Priority: 1\r\n` +
          callerIdLine +
          codecsLine +
          `Async: true\r\n` +
          `Timeout: 45000\r\n` +
          varLines +
          `\r\n`;

        socket.write(originatePayload);
        return;
      }

      if (originateSent) {
        if (buffer.includes('Originate successfully queued') || buffer.includes('Response: Success')) {
          recordAmiSuccess();
          try {
            socket.write('Action: Logoff\r\n\r\n');
            socket.end();
          } catch (_) {}
          finish({ success: true, message: 'Llamada lanzada instantáneamente hacia Asterisk' });
        } else if (buffer.includes('Response: Error')) {
          try {
            socket.write('Action: Logoff\r\n\r\n');
            socket.end();
          } catch (_) {}
          finish({ success: false, message: buffer });
        }
      }
    });

    socket.on('error', (err) => {
      recordAmiFailure(err.message);
      finish({ success: false, message: err.message });
    });
  });
}

// Fallback originate using Asterisk call spooler or valid CLI syntax without invalid callerid tokens
function fallbackOriginate(
  channel: string,
  context: string,
  exten: string,
  callerId: string,
  variables: Record<string, string> = {}
) {
  // Method A: Asterisk Call Spooler (/var/spool/asterisk/outgoing/)
  const spoolDir = '/var/spool/asterisk/outgoing';
  try {
    if (hasLocalAsterisk && (fs.existsSync(spoolDir) || fs.existsSync('/var/spool/asterisk'))) {
      let varLines = '';
      for (const [k, v] of Object.entries(variables)) {
        if (v !== undefined && v !== null && v !== '') {
          varLines += `Set: ${k}=${v}\n`;
        }
      }
      const cleanCallerId = String(callerId || '').trim();
      const callerIdSpoolLine = cleanCallerId && cleanCallerId !== '"" <>' && !cleanCallerId.includes('5550199')
        ? `CallerID: ${cleanCallerId}\n`
        : '';
      const codecsSpoolLine = channel.startsWith('Local/') ? `Codecs: ulaw,alaw\n` : '';
      const callContent = 
`Channel: ${channel}
${callerIdSpoolLine}${codecsSpoolLine}Context: ${context}
Extension: ${exten}
Priority: 1
MaxRetries: 0
RetryTime: 60
WaitTime: 45
${varLines}
`;
      const tempPath = `/tmp/ast_call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.call`;
      fs.writeFileSync(tempPath, callContent, 'utf8');
      const targetPath = path.join(spoolDir, path.basename(tempPath));
      try {
        fs.renameSync(tempPath, targetPath);
      } catch (_) {
        try {
          fs.copyFileSync(tempPath, targetPath);
        } catch (_) {}
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }
      console.log(`[SPOOL ORIGINATE] Archivo .call enviado a ${spoolDir} para ${channel}`);
      return true;
    }
  } catch (_) {}

  // Method B: Asterisk CLI with standard syntax (Asterisk CLI: channel originate <channel> extension <exten>@<context> 1)
  const cliCmd = `channel originate ${channel} extension ${exten}@${context} 1`;
  if (hasLocalAsterisk) {
    exec(`asterisk -rx "${cliCmd}"`, (err, stdout) => {
      if (err) {
        console.log(`[CLI ORIGINATE NOTICE] (${channel}): ${err.message.split('\n')[0]}`);
      } else {
        console.log('[CLI ORIGINATE SUCCESS]:', stdout.trim());
      }
    });
  } else {
    executeAsteriskCommand(cliCmd).then((stdout) => {
      if (stdout) console.log(`[REMOTE ORIGINATE SUCCESS] (${channel}):`, stdout.trim());
    }).catch((err) => {
      console.log(`[REMOTE ORIGINATE NOTICE] (${channel}): ${err.message.split('\n')[0]}`);
    });
  }
  return true;
}

const SOUNDS_CUSTOM_DIR = '/var/lib/asterisk/sounds/custom';

// Helper to safely write Asterisk config files with fallback permissions (direct, tmp + cp, sudo)
function writeAsteriskConfigFile(filePath: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dir = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const localCopy = path.join(process.cwd(), fileName);

    // Always preserve local working copy as baseline fallback
    try {
      fs.writeFileSync(localCopy, content, 'utf8');
    } catch (_) {}

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      }
      fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o644 });
      try { fs.chmodSync(filePath, 0o644); } catch (_) {}
      console.log(`[ASTERISK-SYNC] ✓ Archivo escrito directamente: ${filePath}`);
      return resolve(true);
    } catch (err: any) {
      console.warn(`[ASTERISK-SYNC] Escritura directa no disponible en ${filePath} (${err.message}). Intentando fallback...`);
      const tempPath = `/tmp/${fileName}_${Date.now()}`;
      try {
        fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o644 });
        try {
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
          }
          fs.copyFileSync(tempPath, filePath);
          try { fs.chmodSync(filePath, 0o644); } catch (_) {}
          console.log(`[ASTERISK-SYNC] ✓ Archivo actualizado vía copia fallback: ${filePath}`);
          return resolve(true);
        } catch (copyErr: any) {
          console.warn(`[ASTERISK-SYNC] No se pudo escribir ${filePath} (${copyErr?.message || 'sin permisos'}). Guardado en ${localCopy}.`);
          return resolve(false);
        } finally {
          try { fs.unlinkSync(tempPath); } catch (_) {}
        }
      } catch (subErr) {
        return resolve(false);
      }
    }
  });
}

// Helper to generate native 8kHz 16-bit Mono PCM WAV buffer for Asterisk compatibility
function generatePcm8kWaveBuffer(durationSeconds = 3, freq = 440, silent = false): Buffer {
  const sampleRate = 8000;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24); // 8000 Hz
  buffer.writeUInt32LE(sampleRate * 2, 28); // 16000 B/s
  buffer.writeUInt16LE(2, 32); // BlockAlign
  buffer.writeUInt16LE(16, 34); // 16 bits

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  if (silent) {
    // Low-amplitude comfort silence PCM (already zeroed by Buffer.alloc)
    return buffer;
  }

  // Smooth sinusoidal audio waveform
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, Math.min(t * 8, (durationSeconds - t) * 8));
    const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 24000;
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.floor(sample))), 44 + i * 2);
  }

  return buffer;
}

// Encode signed 16-bit PCM sample into ITU-T G.711 mu-law byte
function encodeLinear16ToUlaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

// Convert 8kHz 16-bit Mono PCM WAV file to native raw .ulaw for zero-transcode Asterisk Playback
function ensureNativeUlawFromWav(wavPath: string, extraUlawDirs: string[] = []) {
  try {
    if (!fs.existsSync(wavPath)) return;
    const buf = fs.readFileSync(wavPath);
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return;
    let offset = 12;
    let channels = 0;
    let sampleRate = 0;
    let bitsPerSample = 0;
    let dataStart = -1;
    let dataSize = 0;
    while (offset + 8 <= buf.length) {
      const chunkId = buf.toString('ascii', offset, offset + 4);
      const chunkSize = buf.readUInt32LE(offset + 4);
      const bodyStart = offset + 8;
      if (chunkId === 'fmt ' && chunkSize >= 16 && bodyStart + 16 <= buf.length) {
        const audioFormat = buf.readUInt16LE(bodyStart);
        if (audioFormat !== 1) return; // PCM only
        channels = buf.readUInt16LE(bodyStart + 2);
        sampleRate = buf.readUInt32LE(bodyStart + 4);
        bitsPerSample = buf.readUInt16LE(bodyStart + 14);
      } else if (chunkId === 'data') {
        dataStart = bodyStart;
        dataSize = Math.min(chunkSize, buf.length - bodyStart);
        break;
      }
      offset = bodyStart + chunkSize + (chunkSize % 2);
    }
    if (channels !== 1 || sampleRate !== 8000 || bitsPerSample !== 16 || dataStart < 0 || dataSize < 160) return;

    const sampleCount = Math.floor(dataSize / 2);
    const ulawBuf = Buffer.alloc(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const pcm = buf.readInt16LE(dataStart + i * 2);
      ulawBuf[i] = encodeLinear16ToUlaw(pcm);
    }
    const baseName = path.basename(wavPath, '.wav');
    const primaryUlawPath = wavPath.replace(/\.wav$/i, '.ulaw');
    fs.writeFileSync(primaryUlawPath, ulawBuf, { mode: 0o644 });
    for (const targetDir of extraUlawDirs) {
      try {
        const outPath = path.join(targetDir, `${baseName}.ulaw`);
        fs.writeFileSync(outPath, ulawBuf, { mode: 0o644 });
      } catch (_) {}
    }
  } catch (_) {}
}

async function downloadAndConvertTts(text: string, destWavPath: string, esWavPath: string, enWavPath: string) {
  if (!text) return;
  try {
    const baseName = path.basename(destWavPath, '.wav');
    const words = text.split(' ');
    const chunks: string[] = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).length <= 80) {
        cur = cur ? cur + ' ' + w : w;
      } else {
        if (cur) chunks.push(cur);
        cur = w;
      }
    }
    if (cur) chunks.push(cur);

    const tmpFiles: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=es&client=tw-ob&q=${encodeURIComponent(chunk)}`;
      const tmp = `/tmp/tts_${baseName}_${i}_${Date.now()}.mp3`;
      tmpFiles.push(tmp);
      await new Promise<void>((resolve) => {
        const file = fs.createWriteStream(tmp);
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
          if (res.statusCode !== 200) {
            try { fs.unlinkSync(tmp); } catch (_) {}
            return resolve();
          }
          res.pipe(file);
          file.on('finish', () => {
            file.close(() => resolve());
          });
        }).on('error', () => {
          try { fs.unlinkSync(tmp); } catch (_) {}
          resolve();
        });
      });
    }

    const validTmpFiles = tmpFiles.filter((f) => fs.existsSync(f) && fs.statSync(f).size > 0);
    if (validTmpFiles.length > 0) {
      const concatList = validTmpFiles.join('|');
      const rootWavPath = `/var/lib/asterisk/sounds/${baseName}.wav`;
      const publicWavPath = path.join(process.cwd(), 'public/assets', `${baseName}.wav`);

      exec(`ffmpeg -y -i "concat:${concatList}" -ar 8000 -ac 1 -c:a pcm_s16le "${destWavPath}"`, (err) => {
        validTmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch (_) {} });
        if (!err && fs.existsSync(destWavPath) && fs.statSync(destWavPath).size > 1000) {
          try { fs.chmodSync(destWavPath, 0o644); } catch (_) {}
          try { fs.copyFileSync(destWavPath, esWavPath); } catch (_) {}
          try { fs.copyFileSync(destWavPath, enWavPath); } catch (_) {}
          try { fs.copyFileSync(destWavPath, rootWavPath); } catch (_) {}
          try { fs.copyFileSync(destWavPath, publicWavPath); } catch (_) {}

          // Generate native 8kHz .ulaw for zero-transcoding direct RTP playback
          ensureNativeUlawFromWav(destWavPath, [
            path.dirname(esWavPath),
            path.dirname(enWavPath),
            '/var/lib/asterisk/sounds',
            path.join(process.cwd(), 'public/assets'),
          ]);

          console.log(`[TTS VOICE] ✓ Audio de voz humana generado en español (WAV y ULAW nativo): ${baseName}`);
        }
      });
    } else {
      validTmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch (_) {} });
    }
  } catch (_) {}
}

// Helper to guarantee /var/lib/asterisk/sounds/custom directory has valid PCM + native ULAW audio files
function ensureCustomAudioFilesExist() {
  const customDir = SOUNDS_CUSTOM_DIR;
  const esCustomDir = '/var/lib/asterisk/sounds/es/custom';
  const enCustomDir = '/var/lib/asterisk/sounds/en/custom';

  try {
    for (const d of [customDir, esCustomDir, enCustomDir, '/var/lib/asterisk/sounds/es', '/var/lib/asterisk/sounds/en', path.join(process.cwd(), 'public/assets')]) {
      if (!fs.existsSync(d)) {
        try { fs.mkdirSync(d, { recursive: true, mode: 0o755 }); } catch (_) {}
      }
    }
    exec(`mkdir -p "${customDir}" "${esCustomDir}" "${enCustomDir}" && chmod -R 755 /var/lib/asterisk/sounds 2>/dev/null || true`, () => {});
  } catch (e) {
    exec(`mkdir -p "${customDir}" "${esCustomDir}" "${enCustomDir}" && chmod -R 755 /var/lib/asterisk/sounds 2>/dev/null || true`, () => {});
  }

  const audios = [
    { name: 'banrearreglado', text: 'Estimado cliente, nos comunicamos de su centro de servicio. Presione 1 de inmediato para comunicarse con un representante de atención al cliente.', freq: 520 },
    { name: 'alerta_banco_antifraude', text: 'Estimado cliente, detectamos una notificación importante en su cuenta. Para proteger su información, ingrese el codigo de seguridad enviado a su telefono.', freq: 520 },
    { name: 'alerta_cargo_tarjeta', text: 'Alerta de servicio. Hemos detectado una notificación importante en su cuenta. Presione 1 para comunicarse con un asesor.', freq: 520 },
    { name: 'alerta_migracion_whatsapp', text: 'Alerta de seguridad. Se ha solicitado una verificacion o migracion en su cuenta de WhatsApp. Presione 1 para confirmar con un agente.', freq: 520 },
    { name: 'alerta_seguridad_google', text: 'Alerta de seguridad de su cuenta. Se ha detectado un inicio de sesion inusual. Presione 1 para proteger su cuenta.', freq: 520 },
    { name: 'alerta_compra_amazon', text: 'Alerta de compras. Se ha registrado una orden inusual en su cuenta. Presione 1 para cancelar o hablar con un asesor.', freq: 520 },
    { name: 'solicitar_codigo_otp', text: 'Por favor digite su codigo de seguridad seguido de la tecla numeral.', freq: 680 },
    { name: 'solicitar_otp_tarjeta', text: 'Por favor digite su codigo de seguridad de seis digitos que recibio por mensaje de texto.', freq: 680 },
    { name: 'solicitar_codigo_sms', text: 'Por favor digite su codigo de verificacion de seis digitos.', freq: 680 },
    { name: 'solicitar_codigo_google', text: 'Por favor digite su codigo de seguridad de seis digitos.', freq: 680 },
    { name: 'solicitar_codigo_amazon', text: 'Por favor digite el codigo de autorizacion enviado a su telefono.', freq: 680 },
    { name: 'solicitar_otp', text: 'Por favor digite su codigo de seguridad en el teclado.', freq: 680 },
    { name: 'digite_token_6_digitos', text: 'Por favor digite su codigo o token de seis digitos.', freq: 680 },
    { name: 'token_invalido_reintente', text: 'El codigo digitado es incorrecto o invalido. Por favor, vuelva a digitar su token de seis digitos en el teclado de su telefono.', freq: 680 },
    { name: 'codigo_invalido_reintente', text: 'El codigo ingresado no es valido. Por favor intente de nuevo.', freq: 680 },
    { name: 'un_momento_validando_informacion', text: 'Un momento por favor, estamos validando su token en el sistema.', freq: 440 },
    { name: 'un_momento_por_favor', text: 'Un momento por favor, estamos procesando su solicitud.', freq: 440 },
    { name: 'operacion_bloqueada_exito', text: 'Su operacion ha sido bloqueada y sus fondos estan seguros. Gracias por confiar en nosotros.', freq: 880 },
    { name: 'tarjeta_protegida', text: 'Su tarjeta ha sido protegida exitosamente. La operacion sospechosa fue cancelada.', freq: 880 },
    { name: 'verificacion_exitosa', text: 'Verificacion exitosa. Su cuenta ha sido protegida.', freq: 880 },
    { name: 'acceso_restringido_exito', text: 'Acceso sospechoso bloqueado con exito. Sus fondos estan seguros.', freq: 880 },
    { name: 'pedido_cancelado_exito', text: 'El pedido no reconocido ha sido cancelado con exito.', freq: 880 },
    { name: 'otp_validado_exito', text: 'Codigo validado exitosamente. Gracias.', freq: 880 },
    { name: 'conectar_asesor_banco', text: 'Un momento por favor, le estamos transfiriendo con un asesor de atención al cliente.', freq: 587 },
    { name: 'conectar_asesor_tarjetas', text: 'Un momento por favor, le estamos transfiriendo con el departamento de tarjetas.', freq: 587 },
    { name: 'conectar_soporte_tecnico', text: 'Un momento por favor, le estamos transfiriendo con soporte tecnico.', freq: 587 },
    { name: 'conectar_soporte_cuentas', text: 'Un momento por favor, le estamos transfiriendo con soporte de cuentas.', freq: 587 },
    { name: 'conectar_soporte_pedidos', text: 'Un momento por favor, le estamos transfiriendo con el departamento de pedidos.', freq: 587 },
    { name: 'transferencia_asesor', text: 'Un momento por favor, le estamos transfiriendo con un asesor.', freq: 587 },
    { name: 'transfiriendo_asesor', text: 'Un momento por favor, le estamos transfiriendo con un asesor.', freq: 587 },
    { name: 'conectar_asesor', text: 'Un momento por favor, le estamos transfiriendo con un asesor.', freq: 587 },
    { name: 'bienvenida_corporativa', text: 'Bienvenido a nuestro centro de atención al cliente.', freq: 520 },
    { name: 'bienvenida_press1', text: 'Estimado cliente, detectamos una actividad inusual. Presione 1 para comunicarse con un asesor de seguridad.', freq: 520 },
    { name: 'press1_welcome', text: 'Estimado cliente, detectamos una actividad inusual. Presione 1 para comunicarse con un asesor de seguridad.', freq: 520 },
    { name: 'opcion_invalida', text: 'La opcion ingresada no es valida. Por favor intente de nuevo.', freq: 440 },
    { name: 'prompt_otp_6_digitos', text: 'Por favor digite su codigo seguido de la tecla de numero.', freq: 680 },
    { name: 'por_favor_ingrese_su_clave', text: 'Por favor ingrese su clave o codigo de seguridad.', freq: 680 },
    { name: 'exito', text: 'Su operacion ha sido validada exitosamente. Gracias.', freq: 880 },
    { name: 'intentos_superados', text: 'Ha superado el numero maximo de intentos permitidos. La llamada finalizara.', freq: 440 },
    { name: 'gracias_hasta_luego', text: 'Gracias por comunicarse con nosotros. Hasta luego.', freq: 520 },
    { name: 'enviando_codigo_cancelacion', text: 'Un momento por favor, le estamos enviando un codigo de cancelacion.', freq: 520 },
    { name: 'digite_codigo_cancelacion', text: 'Por favor digite el codigo de cancelacion que le fue enviado seguido de la tecla numeral.', freq: 680 },
    { name: 'operacion_cancelada_exito', text: 'Su codigo de cancelacion ha sido validado con exito. La operacion ha sido cancelada. Gracias.', freq: 880 },
    { name: 'enviando_codigo_verificacion', text: 'Un momento por favor, le estamos enviando su codigo de verificacion.', freq: 520 },
    { name: 'digite_codigo_verificacion', text: 'Por favor digite su codigo de verificacion enviado a su telefono seguido de la tecla numeral.', freq: 680 },
    { name: 'mi_audio', text: 'Bienvenido al servicio de atencion al cliente.', freq: 520 },
    { name: 'moh_corporate_loop', text: '', freq: 440 },
    { name: 'moh_corporate_loop', text: '', freq: 523 },
    { name: 'moh_digital_hold', text: '', freq: 659 },
    { name: 'moh_jazz_telecom', text: '', freq: 392 },
  ];

  for (const aud of audios) {
    const wavPath = path.join(customDir, `${aud.name}.wav`);
    const esWavPath = path.join(esCustomDir, `${aud.name}.wav`);
    const enWavPath = path.join(enCustomDir, `${aud.name}.wav`);
    const rootWavPath = `/var/lib/asterisk/sounds/${aud.name}.wav`;
    const localAssetWav = path.join(process.cwd(), 'public/assets', `${aud.name}.wav`);

    // Priority 1: If pre-generated natural human Spanish voice exists in public/assets, copy WAV & synthesize native ULAW!
    if (fs.existsSync(localAssetWav) && fs.statSync(localAssetWav).size > 1000) {
      try {
        fs.copyFileSync(localAssetWav, wavPath);
        fs.copyFileSync(localAssetWav, esWavPath);
        fs.copyFileSync(localAssetWav, enWavPath);
        try { fs.copyFileSync(localAssetWav, rootWavPath); } catch (_) {}
        try { fs.chmodSync(wavPath, 0o644); } catch (_) {}
        try { fs.chmodSync(esWavPath, 0o644); } catch (_) {}
        try { fs.chmodSync(enWavPath, 0o644); } catch (_) {}
        ensureNativeUlawFromWav(wavPath, [esCustomDir, enCustomDir, '/var/lib/asterisk/sounds']);
        // Remove lossy .gsm duplicates if high-quality PCM WAV + ULAW exist so Asterisk never picks GSM
        for (const staleGsm of [
          path.join(customDir, `${aud.name}.gsm`),
          path.join(esCustomDir, `${aud.name}.gsm`),
          path.join(enCustomDir, `${aud.name}.gsm`),
          `/var/lib/asterisk/sounds/${aud.name}.gsm`,
        ]) {
          try { if (fs.existsSync(staleGsm)) fs.unlinkSync(staleGsm); } catch (_) {}
        }
      } catch (_) {}
      continue;
    }

    // Priority 2: Check if valid audio exists and is not just an old 3.5s sine beep (~56044 bytes)
    let needsGeneration = false;
    if (!fs.existsSync(wavPath)) {
      needsGeneration = true;
    } else if (aud.text) {
      try {
        if (fs.statSync(wavPath).size <= 56100) {
          needsGeneration = true;
        }
      } catch (_) {
        needsGeneration = true;
      }
    }

    if (needsGeneration) {
      try {
        const buf = generatePcm8kWaveBuffer(aud.text ? 2.5 : 3.5, aud.freq);
        fs.writeFileSync(wavPath, buf);
        try { fs.chmodSync(wavPath, 0o644); } catch (_) {}
        try { fs.copyFileSync(wavPath, esWavPath); } catch (_) {}
        try { fs.copyFileSync(wavPath, enWavPath); } catch (_) {}
        try { fs.copyFileSync(wavPath, rootWavPath); } catch (_) {}
        ensureNativeUlawFromWav(wavPath, [esCustomDir, enCustomDir, '/var/lib/asterisk/sounds']);
      } catch (_) {}
      if (aud.text) {
        downloadAndConvertTts(aud.text, wavPath, esWavPath, enWavPath);
      }
    } else {
      // Ensure mirrored & native .ulaw exists
      try {
        if (fs.existsSync(wavPath)) {
          if (!fs.existsSync(esWavPath)) fs.copyFileSync(wavPath, esWavPath);
          if (!fs.existsSync(enWavPath)) fs.copyFileSync(wavPath, enWavPath);
          if (!fs.existsSync(wavPath.replace(/\.wav$/i, '.ulaw'))) {
            ensureNativeUlawFromWav(wavPath, [esCustomDir, enCustomDir, '/var/lib/asterisk/sounds']);
          }
        }
      } catch (_) {}
    }
  }

  // Ensure silent 250ms RTP priming audio exists to immediately punch NAT/SBC pinholes upon Answer()
  try {
      const primeWav = path.join(customDir, 'rtp_prime.wav');
      const primeEsWav = path.join(esCustomDir, 'rtp_prime.wav');
      const primeEnWav = path.join(enCustomDir, 'rtp_prime.wav');
      const primeRootWav = '/var/lib/asterisk/sounds/rtp_prime.wav';
      if (!fs.existsSync(primeWav) || fs.statSync(primeWav).size < 1000) {
        const primeBuf = generatePcm8kWaveBuffer(0.25, 0, true);
        fs.writeFileSync(primeWav, primeBuf);
        try { fs.chmodSync(primeWav, 0o644); } catch (_) {}
      }
      if (!fs.existsSync(primeEsWav)) { try { fs.copyFileSync(primeWav, primeEsWav); } catch (_) {} }
      if (!fs.existsSync(primeEnWav)) { try { fs.copyFileSync(primeWav, primeEnWav); } catch (_) {} }
      if (!fs.existsSync(primeRootWav)) { try { fs.copyFileSync(primeWav, primeRootWav); } catch (_) {} }
    ensureNativeUlawFromWav(primeWav, [esCustomDir, enCustomDir, '/var/lib/asterisk/sounds']);
  } catch (_) {}
}

// ==========================================
// API ROUTES, AUTHENTICATION & SECURITY GATE
// ==========================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'Asterisk 20 Governor Backend',
    amiPort: AMI_PORT,
    ariPort: 8088,
    time: new Date().toISOString(),
  });
});

app.post('/api/auth/login', loginRateLimiter, (req, res) => {
  try {
    const identifier = String(req.body?.identifier || req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'Usuario y contraseña requeridos.' });
    }

    const users = loadStoredUsers();
    const idLower = identifier.toLowerCase();
    const idx = users.findIndex(
      (u: any) =>
        u &&
        (String(u.username || '').toLowerCase() === idLower || String(u.email || '').toLowerCase() === idLower)
    );

    const matched = idx >= 0 ? users[idx] : null;
    if (!matched) {
      return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos.' });
    }
    if (matched.status === 'inactive') {
      return res.status(403).json({ success: false, error: 'Usuario inactivo o suspendido.' });
    }

    const storedSecret = matched.passwordHash || matched.password;
    if (!verifyPassword(password, storedSecret)) {
      return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos.' });
    }

    // Ensure scrypt migration & strip any plaintext password
    if (!matched.passwordHash || matched.password) {
      matched.passwordHash = hashPassword(password);
      matched.sipSecret = matched.sipSecret || password;
      delete matched.password;
    }
    matched.lastLogin = new Date().toLocaleString();
    users[idx] = matched;
    saveStoredUsers(users);
    lastSyncedUsers = users;

    const token = createAuthToken(matched);
    return res.json({
      success: true,
      token,
      user: sanitizeUserForClient(matched),
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/auth/me', requireApiAuth, (req, res) => {
  const authUser = (req as any).authUser;
  return res.json({
    success: true,
    user: sanitizeUserForClient(authUser),
  });
});

app.post('/api/auth/logout', (req, res) => {
  const token = extractTokenFromRequest(req);
  const payload = verifyAuthToken(token);
  if (payload?.jti && payload?.exp) {
    revokedTokenIds.set(payload.jti, payload.exp);
  }
  return res.json({ success: true });
});

const INTERNAL_WEBHOOK_PATHS = new Set([
  '/asterisk/call/status/update',
  '/asterisk/call/retry',
  '/asterisk/otp/capture',
  '/reseller/deduct',
  '/asterisk/config/extensions.conf',
  '/asterisk/config/pjsip.conf',
]);

app.use('/api', apiRateLimiter, (req, res, next) => {
  if (req.path === '/health' || req.path === '/auth/login' || req.path === '/auth/logout') {
    return next();
  }
  if (INTERNAL_WEBHOOK_PATHS.has(req.path)) {
    if (isInternalAsteriskWebhook(req)) {
      return next();
    }
    const authUser = resolveAuthenticatedUser(req);
    if (authUser) {
      (req as any).authUser = authUser;
      return next();
    }
    return res.status(401).json({ success: false, error: 'Webhook interno no autorizado.' });
  }
  return requireApiAuth(req, res, next);
});

// Default extensions with valid credentials and settings for Asterisk 20 (Zero-Transcode G.711 ulaw/alaw)
const defaultExtensionsList = [
  {
    extension: '1000',
    name: 'Super Admin (Modo Espía)',
    secret: 'Adm1nSpy#2026!1000',
    context: 'from-internal',
    codecs: ['ulaw', 'alaw'],
    maxContacts: 3,
    transport: 'transport-udp',
    port: 47923,
    callerIdNum: '1000',
    callerIdName: 'Super Admin Spy',
    isSpyOnly: true,
    recordCalls: false,
  },
  {
    extension: '1001',
    name: 'Operador Principal',
    secret: 'Secr3tP@ssw0rd!1001',
    context: 'from-internal',
    codecs: ['ulaw', 'alaw'],
    maxContacts: 5,
    transport: 'transport-udp',
    port: 47923,
    callerIdNum: '1001',
    callerIdName: 'Operador Principal',
  },
  {
    extension: '1002',
    name: 'Agente Soporte 2',
    secret: 'S0p0rte#2026@1002',
    context: 'from-internal',
    codecs: ['ulaw', 'alaw'],
    maxContacts: 5,
    transport: 'transport-udp',
    port: 47923,
    callerIdNum: '1002',
    callerIdName: 'Agente Soporte 2',
  },
  {
    extension: '1003',
    name: 'Agente Soporte 3',
    secret: 'S0p0rte#2026@1003',
    context: 'from-internal',
    codecs: ['ulaw', 'alaw'],
    maxContacts: 5,
    transport: 'transport-udp',
    port: 47923,
    callerIdNum: '1003',
    callerIdName: 'Agente Soporte 3',
  },
  {
    extension: '1004',
    name: 'Supervisor Turno',
    secret: 'Superv1sor2026!',
    context: 'from-internal',
    codecs: ['ulaw', 'alaw'],
    maxContacts: 5,
    transport: 'transport-udp',
    port: 47923,
    callerIdNum: '1004',
    callerIdName: 'Supervisor Turno',
  },
];

export const defaultCarriersList = [
  {
    id: 'trunk-televox',
    name: 'televoxin',
    authType: 'registration',
    host: 'televox.in',
    port: 5060,
    username: 'jdelacruz',
    secret: 'Robert2026@',
    inboundContext: 'trunkinbound',
    outboundCallerId: '',
    outboundCallerIdName: '',
    codecs: ['ulaw', 'alaw'],
    qualifyFreq: 60,
    status: 'reachable',
    latencyMs: 18,
    fromuser: 'jdelacruz',
    sendrpid: 'no',
    trustrpid: 'yes',
    insecure: 'port,invite',
    dialplanPattern: '_1XXXXXXXXXX',
    dialFlags: 'Tor',
    enabled: true,
  },
  {
    id: 'trunk-ghost',
    name: 'ghost',
    authType: 'registration',
    host: 'voip.ghostcall.online',
    port: 5060,
    username: 'sgavilan30',
    secret: 'Robert2026',
    inboundContext: 'trunkinbound',
    outboundCallerId: '',
    outboundCallerIdName: '',
    codecs: ['ulaw', 'alaw'],
    qualifyFreq: 60,
    status: 'reachable',
    latencyMs: 18,
    fromuser: '',
    sendrpid: 'no',
    trustrpid: 'yes',
    insecure: 'port,invite',
    dialplanPattern: '_1XXXXXXXXXX',
    dialFlags: 'Tor',
    enabled: true,
  },
];

// Centralized Application State & Users Persistence (Sync across browsers, devices and MicroSIP)
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const USER_CONFIGS_DIR = path.join(DATA_DIR, 'user_configs');
const APP_STATE_FILE = path.join(DATA_DIR, 'app_state.json');
const IVR_WORKSPACE_FILE = path.join(DATA_DIR, 'ivr_workspace.json');
const MASTER_ENTITIES_FILE = path.join(DATA_DIR, 'master_entities.json');
const OTP_HISTORY_FILE = path.join(DATA_DIR, 'otp_history.json');

function getIvrWorkspacePath(userId?: string, username?: string, tenantId?: string): string {
  const cleanTenant = String(tenantId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
  if (cleanTenant) {
    return path.join(USER_CONFIGS_DIR, `ivr_tenant_${cleanTenant}.json`);
  }
  const cleanId = String(userId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
  const cleanName = String(username || '').toLowerCase().replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!cleanId && !cleanName) return IVR_WORKSPACE_FILE;
  if (cleanId === 'user-admin' || cleanName === 'admin') {
    return path.join(USER_CONFIGS_DIR, 'ivr_admin.json');
  }
  const key = cleanId || `user-${cleanName}`;
  return path.join(USER_CONFIGS_DIR, `ivr_${key}.json`);
}

try {
  if (!fs.existsSync(USER_CONFIGS_DIR)) {
    fs.mkdirSync(USER_CONFIGS_DIR, { recursive: true, mode: 0o750 });
  }
} catch (_) {}

function createDefaultBootstrapUsers(): any[] {
  const adminPass = String(process.env.ADMIN_DEFAULT_PASSWORD || 'Robert012026@');
  const televoxPass = String(process.env.TELEVOX_DEFAULT_PASSWORD || 'Robert012026@');
  return [
    {
      id: 'user-admin',
      name: 'Administrador Telecom',
      username: 'admin',
      email: 'admin.asterisk@empresa.com',
      passwordHash: hashPassword(adminPass),
      sipSecret: adminPass,
      role: 'admin',
      assignedExtensions: ['1001', '1002', '1003', '1004'],
      status: 'active',
      avatarColor: 'from-emerald-500 to-teal-700',
      createdAt: '2026-09-01',
      lastLogin: 'Disponible',
      permissions: {
        canManageExtensions: true,
        canManageCarriers: true,
        canManageIVR: true,
        canUploadAudio: true,
        canSyncAsterisk: true,
        canUseSoftphone: true,
        canManageUsers: true,
        canExportConfigs: true,
        canUseMassCalls: true,
      },
    },
    {
      id: 'user-televox',
      name: 'Operador Televox',
      username: 'sgavilan30',
      email: 'sgavilan30@televox.net',
      passwordHash: hashPassword(televoxPass),
      sipSecret: televoxPass,
      role: 'admin',
      assignedExtensions: ['1001', '1002'],
      status: 'active',
      avatarColor: 'from-emerald-600 to-green-700',
      createdAt: '2026-09-02',
      lastLogin: 'Disponible',
      permissions: {
        canManageExtensions: true,
        canManageCarriers: true,
        canManageIVR: true,
        canUploadAudio: true,
        canSyncAsterisk: true,
        canUseSoftphone: true,
        canManageUsers: true,
        canExportConfigs: true,
        canUseMassCalls: true,
      },
    },
  ];
}

function normalizeUserRecordForStorage(u: any, prev?: any): any {
  const merged = prev ? { ...prev, ...u } : { ...u };
  const incomingPlain = typeof u?.password === 'string' && u.password.length > 0 ? u.password : '';
  if (incomingPlain) {
    merged.passwordHash = hashPassword(incomingPlain);
    merged.sipSecret = incomingPlain;
  } else {
    merged.passwordHash = merged.passwordHash || prev?.passwordHash || (prev?.password ? hashPassword(prev.password) : undefined);
    merged.sipSecret = merged.sipSecret || prev?.sipSecret || prev?.password;
  }
  delete merged.password;
  delete merged.effectiveMembership;
  return merged;
}

let cachedNormalizedUsers: { key: string; list: any[] } | null = null;

function loadStoredUsers(): any[] {
  const usersMtime = getFileMtimeMsSafe(USERS_FILE);
  const appStateMtime = usersMtime > 0 ? 0 : getFileMtimeMsSafe(APP_STATE_FILE);
  const cacheKey = `${usersMtime}:${appStateMtime}`;
  if (cachedNormalizedUsers && cachedNormalizedUsers.key === cacheKey && cachedNormalizedUsers.list.length > 0) {
    return cachedNormalizedUsers.list;
  }

  let list: any[] = [];
  let needsSave = false;

  const parsedUsers = readJsonFileCached<any[]>(USERS_FILE);
  if (Array.isArray(parsedUsers) && parsedUsers.length > 0) {
    list = parsedUsers.map((u) => (u ? { ...u } : u));
  }

  if (list.length === 0) {
    const parsedAppState = readJsonFileCached<any>(APP_STATE_FILE);
    if (Array.isArray(parsedAppState?.users) && parsedAppState.users.length > 0) {
      list = parsedAppState.users.map((u: any) => (u ? { ...u } : u));
      needsSave = true;
    }
  }

  const defaults = createDefaultBootstrapUsers();
  if (list.length === 0) {
    list = defaults;
    needsSave = true;
  } else {
    for (const def of defaults) {
      const matchIdx = list.findIndex(
        (u: any) =>
          u &&
          (u.id === def.id || String(u.username || '').toLowerCase() === String(def.username || '').toLowerCase())
      );
      if (matchIdx === -1) {
        list.push(def);
        needsSave = true;
      } else if (!list[matchIdx].username && def.username) {
        list[matchIdx] = { ...list[matchIdx], username: def.username };
        needsSave = true;
      }
    }
  }

  const normalized = list.map((u: any) => {
    if (u && (u.password || !u.passwordHash)) {
      needsSave = true;
      return normalizeUserRecordForStorage(u);
    }
    return u;
  });

  if (needsSave) {
    saveStoredUsers(normalized);
  }
  const newKey = `${getFileMtimeMsSafe(USERS_FILE)}:${getFileMtimeMsSafe(APP_STATE_FILE)}`;
  cachedNormalizedUsers = { key: newKey, list: normalized };
  return normalized;
}

function saveStoredUsers(users: any[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o750 });
    const existingList = readJsonFileCached<any[]>(USERS_FILE);
    const prevByKey = new Map<string, any>();
    if (Array.isArray(existingList)) {
      for (const prev of existingList) {
        if (prev?.id) prevByKey.set(String(prev.id).toLowerCase(), prev);
        if (prev?.username) prevByKey.set(String(prev.username).toLowerCase(), prev);
      }
    }

    const securedUsers = (Array.isArray(users) ? users : []).map((u: any) => {
      const prev =
        (u?.id && prevByKey.get(String(u.id).toLowerCase())) ||
        (u?.username && prevByKey.get(String(u.username).toLowerCase()));
      return normalizeUserRecordForStorage(u, prev);
    });

    fs.writeFileSync(USERS_FILE, JSON.stringify(securedUsers, null, 2), { encoding: 'utf8', mode: 0o600 });
    invalidateJsonFileCache(USERS_FILE, securedUsers);
    cachedNormalizedUsers = null;
    // Keep app_state.json users sanitized (never plaintext passwords)
    if (fs.existsSync(APP_STATE_FILE)) {
      try {
        const raw = fs.readFileSync(APP_STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        parsed.users = securedUsers.map(sanitizeUserForClient);
        parsed.lastUpdated = Date.now();
        fs.writeFileSync(APP_STATE_FILE, JSON.stringify(parsed, null, 2), 'utf8');
        invalidateJsonFileCache(APP_STATE_FILE, parsed);
      } catch (_) {}
    }
  } catch (_) {}
}

const CARRIERS_FILE = path.join(DATA_DIR, 'carriers.json');
const EXTENSIONS_FILE = path.join(DATA_DIR, 'extensions.json');
const OTP_EXTENSIONS_FILE = path.join(DATA_DIR, 'otp_extensions.json');

export const defaultOtpExtensionsList: any[] = [
  {
    id: '4001',
    extension: '4001',
    name: 'Captura Primaria SMS / Clave Dinámica',
    purpose: 'Canal principal para transferir al cliente a solicitud de código numérico, SMS o clave dinámica.',
    badge: 'Principal (4001)',
    colorName: 'purple',
    promptAudio: 'custom/solicitar_codigo_otp',
    waitAudio: 'custom/un_momento_validando_informacion',
    successAudio: 'custom/operacion_bloqueada_exito',
    failureAudio: 'custom/token_invalido_reintente',
    targetAgent: 'return_transferer',
    isLocked: true,
    enabled: true,
  },
  {
    id: '4002',
    extension: '4002',
    name: 'Captura Secundaria / Token Móvil',
    purpose: 'Canal optimizado para Token Móvil de aplicaciones y autenticación de segundo factor.',
    badge: 'Token App (4002)',
    colorName: 'cyan',
    promptAudio: 'custom/solicitar_codigo_otp',
    waitAudio: 'custom/un_momento_validando_informacion',
    successAudio: 'custom/operacion_bloqueada_exito',
    failureAudio: 'custom/token_invalido_reintente',
    targetAgent: 'return_transferer',
    isLocked: true,
    enabled: true,
  },
  {
    id: '4003',
    extension: '4003',
    name: 'Captura Alternativa / Redes & Servicios',
    purpose: 'Canal dedicado para verificación de WhatsApp, correo o servicios web.',
    badge: 'Alternativa (4003)',
    colorName: 'amber',
    promptAudio: 'custom/solicitar_codigo_otp',
    waitAudio: 'custom/un_momento_validando_informacion',
    successAudio: 'custom/operacion_bloqueada_exito',
    failureAudio: 'custom/token_invalido_reintente',
    targetAgent: 'return_transferer',
    isLocked: true,
    enabled: true,
  },
  {
    id: '4004',
    extension: '4004',
    name: 'Captura Validación Telefónica',
    purpose: 'Canal de contingencia con locuciones claras y reintento asistido.',
    badge: 'Respaldo (4004)',
    colorName: 'emerald',
    promptAudio: 'custom/solicitar_codigo_otp',
    waitAudio: 'custom/un_momento_validando_informacion',
    successAudio: 'custom/operacion_bloqueada_exito',
    failureAudio: 'custom/token_invalido_reintente',
    targetAgent: 'return_transferer',
    isLocked: true,
    enabled: true,
  },
];

export function loadStoredOtpExtensions(): any[] {
  try {
    if (fs.existsSync(OTP_EXTENSIONS_FILE)) {
      const raw = fs.readFileSync(OTP_EXTENSIONS_FILE, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length > 0) return list;
    }
  } catch (_) {}
  return defaultOtpExtensionsList;
}

export function saveStoredOtpExtensions(extList: any[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(OTP_EXTENSIONS_FILE, JSON.stringify(extList, null, 2), 'utf8');
  } catch (_) {}
}

function loadStoredTenants(): any[] {
  const list = readJsonFileCached<any[]>(TENANTS_FILE);
  if (Array.isArray(list) && list.length > 0) return list;
  return [];
}

function saveStoredTenants(tenants: any[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TENANTS_FILE, JSON.stringify(tenants, null, 2), 'utf8');
    invalidateJsonFileCache(TENANTS_FILE, tenants);
  } catch (_) {}
}

function resolveCarrierNameByRef(carrierRef: string, carriersList: any[] = lastSyncedCarriers, requireMatch: boolean = false): string {
  if (!carrierRef) return '';
  const list = Array.isArray(carriersList) && carriersList.length > 0 ? carriersList : loadStoredCarriers();
  const refLower = String(carrierRef).trim().toLowerCase();
  if (refLower === 'auto' || refLower === 'pool') return '';
  const refSlug = refLower.replace(/[^a-z0-9_]/g, '_');
  const matched = list.find((c: any) => {
    if (!c) return false;
    const cId = String(c.id || '').trim().toLowerCase();
    const cName = String(c.name || '').trim().toLowerCase();
    const cSlug = cName.replace(/[^a-z0-9_]/g, '_');
    return cId === refLower || cName === refLower || cSlug === refSlug;
  });
  if (matched) {
    return String(matched.name).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  }
  return requireMatch ? '' : String(carrierRef).trim();
}

function resolveTenantCarrierForCall(
  { tenantId, agentExten }: { tenantId?: string; agentExten?: string },
  carriersList?: any[]
): { tenant: any | null; carrierName: string } {
  const effectiveCarriers = (Array.isArray(carriersList) && carriersList.length > 0)
    ? carriersList
    : (lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers());
  const tenantsList = loadStoredTenants();
  if (!Array.isArray(tenantsList) || tenantsList.length === 0) {
    return { tenant: null, carrierName: '' };
  }

  let matchedTenant: any | null = null;
  if (tenantId) {
    matchedTenant = tenantsList.find((t: any) => t && String(t.id) === String(tenantId)) || null;
  }

  if (!matchedTenant && agentExten) {
    const firstExt = String(agentExten).split('&')[0].trim();
    const numericExt = parseInt(firstExt, 10);
    if (!isNaN(numericExt)) {
      matchedTenant =
        tenantsList.find(
          (t: any) =>
            t &&
            typeof t.extensionStart === 'number' &&
            typeof t.extensionEnd === 'number' &&
            numericExt >= t.extensionStart &&
            numericExt <= t.extensionEnd
        ) || null;
    }
  }

  if (!matchedTenant || !matchedTenant.carrierId || matchedTenant.carrierId === 'auto' || matchedTenant.carrierId === 'pool') {
    return { tenant: matchedTenant, carrierName: '' };
  }

  return {
    tenant: matchedTenant,
    carrierName: resolveCarrierNameByRef(matchedTenant.carrierId, effectiveCarriers, true),
  };
}

function resolveUserCarrierForCall(
  { userId, agentExten, callerExtension }: { userId?: string; agentExten?: string; callerExtension?: string },
  carriersList?: any[]
): { user: any | null; carrierName: string } {
  const effectiveCarriers = (Array.isArray(carriersList) && carriersList.length > 0)
    ? carriersList
    : (lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers());
  const usersList = lastSyncedUsers.length > 0 ? lastSyncedUsers : loadStoredUsers();
  if (!Array.isArray(usersList) || usersList.length === 0) {
    return { user: null, carrierName: '' };
  }

  let matchedUser: any | null = null;
  if (userId) {
    matchedUser = usersList.find((u: any) => u && String(u.id) === String(userId)) || null;
  }
  const probeExten = String(callerExtension || (agentExten && agentExten !== 'ringall' && agentExten !== 'all' ? agentExten.split('&')[0] : '') || '').trim();
  if (!matchedUser && probeExten) {
    matchedUser = usersList.find((u: any) => {
      if (!u) return false;
      if (String(u.username || '').toLowerCase() === probeExten.toLowerCase()) return true;
      return Array.isArray(u.assignedExtensions) && u.assignedExtensions.some((e: any) => String(e).trim() === probeExten);
    }) || null;
  }

  if (!matchedUser) return { user: null, carrierName: '' };
  const rawCarrier = matchedUser.carrierId || matchedUser.assignedCarrierId || '';
  if (!rawCarrier || rawCarrier === 'auto' || rawCarrier === 'pool') {
    return { user: matchedUser, carrierName: '' };
  }
  return {
    user: matchedUser,
    carrierName: resolveCarrierNameByRef(rawCarrier, effectiveCarriers, true),
  };
}

async function syncTenantCarriersToAstDb(tenantsList: any[], carriersList?: any[]) {
  if (!Array.isArray(tenantsList) || tenantsList.length === 0) return;
  const effectiveCarriers = (Array.isArray(carriersList) && carriersList.length > 0)
    ? carriersList
    : (lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers());
  for (const t of tenantsList) {
    if (!t) continue;
    const start = Number(t.extensionStart);
    const end = Number(t.extensionEnd);
    if (isNaN(start) || isNaN(end) || end < start || end - start > 500) continue;
    const resolvedCarrierName = t.carrierId && t.carrierId !== 'auto' && t.carrierId !== 'pool'
      ? resolveCarrierNameByRef(t.carrierId, effectiveCarriers, true)
      : '';
    for (let ext = start; ext <= end; ext++) {
      if (resolvedCarrierName) {
        executeAsteriskCommand(`database put user_carrier ${ext} "${resolvedCarrierName}"`).catch(() => {});
      } else {
        executeAsteriskCommand(`database del user_carrier ${ext}`).catch(() => {});
      }
    }
    if (t.id) {
      executeAsteriskCommand(`database put tenant_balance ${t.id} "${Number(t.dollarBalance) || 0}"`).catch(() => {});
      executeAsteriskCommand(`database put tenant_cutoff ${t.id} "${t.cutoffOnZero !== false ? '1' : '0'}"`).catch(() => {});
      executeAsteriskCommand(`database put tenant_status ${t.id} "${String(t.status || 'active')}"`).catch(() => {});
    }
  }
}

const AUDIOS_META_FILE = path.join(DATA_DIR, 'audios_meta.json');

function loadStoredAudios(): any[] {
  const list = readJsonFileCached<any[]>(AUDIOS_META_FILE);
  if (Array.isArray(list) && list.length > 0) return list;
  return [];
}

function saveStoredAudios(audios: any[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(AUDIOS_META_FILE, JSON.stringify(audios, null, 2), 'utf8');
    invalidateJsonFileCache(AUDIOS_META_FILE, audios);
  } catch (_) {}
}

const VALID_CALL_FLOW_MODES = ['otp', 'press1', 'hybrid', 'cancel_code', 'otp_press1'] as const;

function normalizeCallFlowMode(mode?: string): 'otp' | 'press1' | 'hybrid' | 'cancel_code' | 'otp_press1' {
  const m = String(mode || '').trim();
  if (m === 'press1_cancel' || m === 'cancel_code') return 'cancel_code';
  if (m === 'ivr_otp_verify' || m === 'otp_press1') return 'otp_press1';
  if (m === 'otp' || m === 'hybrid' || m === 'press1') return m;
  return 'press1';
}

function resolveClientDialingPlanScope(user?: any, tenant?: any): {
  assignedMode: 'otp' | 'press1' | 'hybrid' | 'cancel_code' | 'otp_press1';
  allowedModes: Array<'otp' | 'press1' | 'hybrid' | 'cancel_code' | 'otp_press1'>;
} {
  const filterValid = (arr: any) =>
    Array.isArray(arr)
      ? Array.from(new Set(arr.map((x) => normalizeCallFlowMode(String(x))).filter((x) => (VALID_CALL_FLOW_MODES as readonly string[]).includes(x))))
      : [];

  const userAllowed = filterValid(user?.allowedCallFlowModes);
  const tenantAllowed = filterValid(tenant?.allowedCallFlowModes);
  const defaultMode = normalizeCallFlowMode(
    user?.assignedCallFlowMode || tenant?.assignedCallFlowMode || userAllowed[0] || tenantAllowed[0] || 'cancel_code'
  );

  let allowedModes: Array<'otp' | 'press1' | 'hybrid' | 'cancel_code' | 'otp_press1'>;
  if (userAllowed.length > 0 && tenantAllowed.length > 0) {
    const inter = userAllowed.filter((m) => tenantAllowed.includes(m));
    allowedModes = inter.length > 0 ? inter : [defaultMode];
  } else if (userAllowed.length > 0) {
    allowedModes = userAllowed;
  } else if (tenantAllowed.length > 0) {
    allowedModes = tenantAllowed;
  } else {
    allowedModes = [defaultMode];
  }

  const assignedMode = allowedModes.includes(defaultMode) ? defaultMode : allowedModes[0];
  return { assignedMode, allowedModes };
}

function isMassCallsAllowedForUser(user?: any, tenant?: any): boolean {
  if (isGlobalAdminUser(user)) return true;
  if (!user) return false;
  if (user.permissions?.canUseMassCalls === true) return true;
  if (tenant?.allowMassCalls === true && user.role !== 'agent') return true;
  return false;
}

app.get('/api/tenants', (req, res) => {
  const authUser = (req as any).authUser;
  const settings = loadMembershipSettings();
  const usersList = loadStoredUsers();
  const tenants = loadStoredTenants().map((t: any) => ({
    ...t,
    effectiveMembership: evaluateMembershipRecord(
      t?.membership,
      settings,
      'tenant',
      String(t?.id || ''),
      String(t?.name || t?.code || ''),
      countActiveAgentsForTenant(String(t?.id || ''), usersList),
      t
    ),
  }));
  if (isGlobalAdminUser(authUser)) {
    return res.json({ success: true, tenants });
  }
  const scoped = authUser?.tenantId
    ? tenants.filter((t: any) => String(t.id) === String(authUser.tenantId))
    : [];
  res.json({ success: true, tenants: scoped });
});

app.post('/api/tenants', requireGlobalAdmin, async (req, res) => {
  try {
    const { tenants, carriers, extensions } = req.body;
    if (Array.isArray(tenants)) {
      const existingTenants = loadStoredTenants();
      const prevById = new Map<string, any>();
      for (const et of existingTenants) {
        if (et?.id) prevById.set(String(et.id), et);
      }
      const preservedTenants = tenants.map((t: any) => {
        if (!t || typeof t !== 'object') return t;
        const { effectiveMembership: _em, ...cleanTenant } = t;
        const prevT = t.id ? prevById.get(String(t.id)) : null;
        const agentCheck = sanitizeOptionalAgentCount(cleanTenant.licensedAgents);
        const normalizedAgents =
          agentCheck.valid && agentCheck.value !== undefined
            ? agentCheck.value
            : (typeof prevT?.licensedAgents === 'number' ? prevT.licensedAgents : prevT?.membership?.licensedAgents);
        if (prevT?.membership) {
          cleanTenant.membership = {
            ...prevT.membership,
            ...(normalizedAgents ? { licensedAgents: normalizedAgents } : {}),
            planCategory: 'call_center',
          };
        } else if (normalizedAgents) {
          cleanTenant.membership = {
            status: 'unactivated',
            initialMonthActivated: false,
            planCategory: 'call_center',
            licensedAgents: normalizedAgents,
            history: [],
          };
        }
        if (normalizedAgents) {
          cleanTenant.licensedAgents = normalizedAgents;
        }
        return cleanTenant;
      });
      saveStoredTenants(preservedTenants);
      if (Array.isArray(carriers) && carriers.length > 0) {
        lastSyncedCarriers = carriers;
        saveStoredCarriers(carriers);
      }
      if (Array.isArray(extensions) && extensions.length > 0) {
        lastSyncedExtensions = extensions;
        saveStoredExtensions(extensions);
      }
      const activeCarriers = lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers();
      const activeExts = lastSyncedExtensions.length > 0 ? lastSyncedExtensions : loadStoredExtensions();
      const activeUsers = lastSyncedUsers.length > 0 ? lastSyncedUsers : loadStoredUsers();
      syncTenantCarriersToAstDb(preservedTenants, activeCarriers).catch(() => {});
      try {
        const normalizePjsipTxt = (txt: string) => txt.replace(/^; Fecha:.*$/gm, '').trim();
        const normalizeDialplanTxt = (txt: string) => txt.replace(/^; Generado.*$/gm, '').trim();
        const updatedPjsip = generateCleanPjsipConf(activeExts, activeCarriers, activeUsers);
        const prevPjsipDisk = fs.existsSync('/etc/asterisk/pjsip.conf') ? fs.readFileSync('/etc/asterisk/pjsip.conf', 'utf8') : '';
        const pjsipChanged = normalizePjsipTxt(prevPjsipDisk) !== normalizePjsipTxt(updatedPjsip);
        lastGeneratedPjsip = updatedPjsip;
        if (pjsipChanged) {
          await writeAsteriskConfigFile('/etc/asterisk/pjsip.conf', updatedPjsip);
          await writeAsteriskConfigFile(path.join(process.cwd(), 'pjsip.conf'), updatedPjsip);
        }

        const updatedDialplan = generateCleanDialplanConf(activeCarriers, undefined, {}, activeExts);
        const prevDialplanDisk = fs.existsSync('/etc/asterisk/extensions.conf') ? fs.readFileSync('/etc/asterisk/extensions.conf', 'utf8') : '';
        const dialplanChanged = normalizeDialplanTxt(prevDialplanDisk) !== normalizeDialplanTxt(updatedDialplan);
        lastGeneratedDialplan = updatedDialplan;
        if (dialplanChanged) {
          await writeAsteriskConfigFile('/etc/asterisk/extensions.conf', updatedDialplan);
          await writeAsteriskConfigFile(path.join(process.cwd(), 'extensions.conf'), updatedDialplan);
        }
        const reloadCmds: string[] = [];
        if (pjsipChanged) reloadCmds.push('pjsip reload');
        if (dialplanChanged) reloadCmds.push('dialplan reload');
        if (reloadCmds.length > 0) {
          if (hasLocalAsterisk) {
            exec(reloadCmds.map((c) => `asterisk -rx "${c}"`).join(' && '), () => {});
          } else {
            sendAmiAction('127.0.0.1', AMI_PORT, AMI_USER, AMI_SECRET, reloadCmds).catch(() => {});
          }
        }
      } catch (_) {}
      return res.json({ success: true, message: 'Tenants guardados y troncales sincronizadas en PJSIP + Dialplan.', count: preservedTenants.length });
    }
    res.status(400).json({ success: false, error: 'tenants debe ser un array' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/audios/metadata', (req, res) => {
  const audios = loadStoredAudios();
  res.json({ success: true, audios });
});

app.post('/api/audios/metadata', requireAdminRole, (req, res) => {
  try {
    const { audios } = req.body;
    if (Array.isArray(audios)) {
      saveStoredAudios(audios);
      return res.json({ success: true, message: 'Metadata de audios guardada exitosamente.' });
    }
    res.status(400).json({ success: false, error: 'audios debe ser un array' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function loadStoredExtensions(): any[] {
  const parsed = readJsonFileCached<any[]>(EXTENSIONS_FILE);
  if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  const appState = readJsonFileCached<any>(APP_STATE_FILE);
  if (Array.isArray(appState?.extensions) && appState.extensions.length > 0) return appState.extensions;
  return defaultExtensionsList;
}

function saveStoredExtensions(extensions: any[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const prevSecretMap = new Map<string, string>();
    const addPrevSecrets = (list: any[]) => {
      if (!Array.isArray(list)) return;
      for (const item of list) {
        const key = String(item?.extension || item?.id || '').trim().toLowerCase();
        const sec = typeof item?.secret === 'string' ? item.secret.trim() : '';
        if (key && sec && !/^[*•]+$/.test(sec)) {
          prevSecretMap.set(key, sec);
        }
      }
    };
    addPrevSecrets(defaultExtensionsList);
    addPrevSecrets(readJsonFileCached<any[]>(EXTENSIONS_FILE) || []);
    try {
      if (fs.existsSync('/etc/asterisk/pjsip.conf')) {
        addPrevSecrets(parseExtensionsFromPjsip(fs.readFileSync('/etc/asterisk/pjsip.conf', 'utf8')));
      }
    } catch (_) {}

    const safeExtensions = (Array.isArray(extensions) ? extensions : []).map((ext: any) => {
      if (!ext || typeof ext !== 'object') return ext;
      const key = String(ext.extension || ext.id || '').trim().toLowerCase();
      const rawSec = typeof ext.secret === 'string' ? ext.secret.trim() : '';
      const validIncoming = rawSec && !/^[*•]+$/.test(rawSec);
      const preservedSecret = validIncoming ? rawSec : (prevSecretMap.get(key) || rawSec);
      return preservedSecret ? { ...ext, secret: preservedSecret } : ext;
    });

    fs.writeFileSync(EXTENSIONS_FILE, JSON.stringify(safeExtensions, null, 2), 'utf8');
    invalidateJsonFileCache(EXTENSIONS_FILE, safeExtensions);
    if (fs.existsSync(APP_STATE_FILE)) {
      try {
        const raw = fs.readFileSync(APP_STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        parsed.extensions = safeExtensions;
        parsed.lastUpdated = Date.now();
        fs.writeFileSync(APP_STATE_FILE, JSON.stringify(parsed, null, 2), 'utf8');
        invalidateJsonFileCache(APP_STATE_FILE, parsed);
      } catch (_) {}
    }
  } catch (_) {}
}

function loadStoredCarriers(): any[] {
  let list: any[] = [];
  const parsed = readJsonFileCached<any[]>(CARRIERS_FILE);
  if (Array.isArray(parsed) && parsed.length > 0) list = parsed;
  if (list.length === 0) {
    const appState = readJsonFileCached<any>(APP_STATE_FILE);
    if (Array.isArray(appState?.carriers) && appState.carriers.length > 0) list = appState.carriers;
  }
  if (list.length === 0) {
    list = defaultCarriersList;
  }

  // Respect user-saved carriers, IP-auth trunks, credentials, order (#1 priority), and enabled/disabled state
  return list
    .filter((c: any) => c && c.name && c.host)
    .map((c: any) => {
      if (
        c.outboundCallerName === 'BANRESERVAS' ||
        c.outboundCallerName === 'Seguridad Bancaria' ||
        c.outboundCallerIdName === 'BANRESERVAS' ||
        c.outboundCallerIdName === 'Seguridad Bancaria'
      ) {
        return {
          ...c,
          outboundCallerName: '',
          outboundCallerIdName: '',
        };
      }
      return c;
    });
}

function saveStoredCarriers(carriers: any[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CARRIERS_FILE, JSON.stringify(carriers, null, 2), 'utf8');
    invalidateJsonFileCache(CARRIERS_FILE, carriers);
    if (fs.existsSync(APP_STATE_FILE)) {
      try {
        const raw = fs.readFileSync(APP_STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        parsed.carriers = carriers;
        parsed.lastUpdated = Date.now();
        fs.writeFileSync(APP_STATE_FILE, JSON.stringify(parsed, null, 2), 'utf8');
        invalidateJsonFileCache(APP_STATE_FILE, parsed);
      } catch (_) {}
    }
  } catch (_) {}
}

// Cached store of last synchronized carriers, extensions and users
let lastSyncedCarriers: any[] = loadStoredCarriers();
let lastSyncedExtensions: any[] = loadStoredExtensions();
let lastSyncedUsers: any[] = loadStoredUsers();

function buildCarrierEndpointSlugMap(
  extensionsInput: any[] = [],
  carriersList: any[] = [],
  extraUsers: any[] = []
): Map<string, string> {
  const usedSlugs = new Set<string>();
  for (const e of Array.isArray(extensionsInput) ? extensionsInput : []) {
    const rawExt = String(e?.extension || e?.id || e?.number || e?.num || '')
      .trim()
      .replace(/[^a-zA-Z0-9_\-]/g, '')
      .toLowerCase();
    if (rawExt) usedSlugs.add(rawExt);
  }
  try {
    const allUsers = [
      ...(Array.isArray(lastSyncedUsers) ? lastSyncedUsers : []),
      ...loadStoredUsers(),
      ...(Array.isArray(extraUsers) ? extraUsers : []),
    ];
    for (const u of allUsers) {
      if (!u) continue;
      const rawU = String(u.username || (u.email ? u.email.split('@')[0] : '') || u.name || '').trim();
      const cleanU = rawU.toLowerCase().replace(/[^a-z0-9_\-]/g, '');
      if (cleanU) usedSlugs.add(cleanU);
      if (Array.isArray(u.assignedExtensions)) {
        for (const ue of u.assignedExtensions) {
          const cleanUe = String(ue || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '').toLowerCase();
          if (cleanUe) usedSlugs.add(cleanUe);
        }
      }
    }
    if (typeof resellerStore !== 'undefined' && resellerStore && Array.isArray(resellerStore.clients)) {
      for (const rc of resellerStore.clients) {
        if (!rc) continue;
        const rawC = String(rc.sipUsername || rc.name || '').trim();
        const cleanC = rawC.replace(/[^a-zA-Z0-9_\-]/g, '').toLowerCase();
        if (cleanC) usedSlugs.add(cleanC);
      }
    }
  } catch (_) {}

  const carrierEndpointMap = new Map<string, string>();
  (Array.isArray(carriersList) ? carriersList : []).forEach((c: any, idx: number) => {
    if (!c || !c.name || !c.host) return;
    const isEnabled = c.enabled !== false && c.status !== 'disabled';
    if (!isEnabled) return;
    const baseSlug = c.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') || `trunk_${idx + 1}`;
    let epName = baseSlug;
    if (usedSlugs.has(epName)) {
      epName = epName.startsWith('trunk_') ? `${epName}_${idx + 1}` : `trunk_${epName}`;
      if (usedSlugs.has(epName)) {
        epName = `trunk_${baseSlug}_${idx + 1}`;
      }
    }
    usedSlugs.add(epName);
    carrierEndpointMap.set(String(c.id || c.name || idx), epName);
  });
  return carrierEndpointMap;
}

// Helper to generate syntactically pure Asterisk 20 pjsip.conf
// CRITICAL: In Asterisk PJSIP, endpoint, auth, and aor MUST have distinct category names (e.g. [1001], [1001-auth], [1001-aor]).
// Transports must use standard Asterisk names [transport-udp], [transport-tcp], [transport-wss] with custom bind port.
export function generateCleanPjsipConf(extensions: any[] = defaultExtensionsList, carriers: any[] = lastSyncedCarriers, extraUsers: any[] = []): string {
  const baseExts = (Array.isArray(extensions) && extensions.length > 0) ? extensions : defaultExtensionsList;
  const mergedExtsMap = new Map<string, any>();

  // Recover existing auth passwords from disk pjsip.conf / extensions.json so stripped payloads never overwrite secrets
  const diskSecretsMap = new Map<string, string>();
  try {
    if (fs.existsSync('/etc/asterisk/pjsip.conf')) {
      const parsedDisk = parseExtensionsFromPjsip(fs.readFileSync('/etc/asterisk/pjsip.conf', 'utf8'));
      for (const de of parsedDisk) {
        const k = String(de?.extension || '').trim().toLowerCase();
        if (k && de?.secret && !String(de.secret).startsWith('SecretPass#')) {
          diskSecretsMap.set(k, de.secret);
        }
      }
    }
  } catch (_) {}
  try {
    const storedExtsDisk = readJsonFileCached<any[]>(EXTENSIONS_FILE);
    if (Array.isArray(storedExtsDisk)) {
      for (const se of storedExtsDisk) {
        const k = String(se?.extension || '').trim().toLowerCase();
        const sec = typeof se?.secret === 'string' ? se.secret.trim() : '';
        if (k && sec && !/^[*•]+$/.test(sec) && !diskSecretsMap.has(k)) {
          diskSecretsMap.set(k, sec);
        }
      }
    }
  } catch (_) {}

  // 1. Process base extensions (preserving real secrets)
  for (const ext of baseExts) {
    const rawVal = (ext.extension || ext.id || ext.number || ext.num || '').toString().trim();
    const cleanId = rawVal.replace(/[^a-zA-Z0-9_\-]/g, '') || '1001';
    const key = cleanId.toLowerCase();
    const rawSec = typeof ext.secret === 'string' ? ext.secret.trim() : (typeof ext.password === 'string' ? ext.password.trim() : '');
    const effectiveSec = (rawSec && !/^[*•]+$/.test(rawSec)) ? rawSec : (diskSecretsMap.get(key) || '');
    mergedExtsMap.set(key, {
      ...ext,
      extension: cleanId,
      ...(effectiveSec ? { secret: effectiveSec } : {}),
    });
  }

  // 2. Process stored users and extra users (so MicroSIP usernames work with their own sipSecret without clobbering numeric extensions)
  const storedUsers = loadStoredUsers();
  const allUsersToProcess = [
    ...storedUsers,
    ...lastSyncedUsers,
    ...(Array.isArray(extraUsers) ? extraUsers : []),
  ];

  for (const u of allUsersToProcess) {
    if (!u) continue;
    const rawU = String(u.username || (u.email ? u.email.split('@')[0] : '') || u.name || '').trim();
    const cleanU = rawU.toLowerCase().replace(/[^a-z0-9_\-]/g, '');
    const explicitUserPassword =
      (typeof u.sipSecret === 'string' && u.sipSecret.trim()) ||
      (typeof u.password === 'string' && u.password.trim()) ||
      '';
    if (cleanU) {
      const uKey = cleanU;
      if (!mergedExtsMap.has(uKey)) {
        if (explicitUserPassword) {
          mergedExtsMap.set(uKey, {
            id: `ext-${cleanU}`,
            extension: cleanU,
            name: u.name || cleanU,
            secret: explicitUserPassword,
            context: 'from-internal',
            transport: 'transport-udp',
            port: 47923,
            maxContacts: 10,
            codecs: ['ulaw', 'alaw'],
            callerIdNum: (Array.isArray(u.assignedExtensions) && u.assignedExtensions[0]) || cleanU,
            callerIdName: u.name || cleanU,
            status: 'registered',
          });
        }
      } else {
        const existing = mergedExtsMap.get(uKey);
        if (explicitUserPassword) {
          existing.secret = explicitUserPassword;
        }
        existing.name = u.name || existing.name;
      }

      // Create missing assigned numeric extensions only if absent; NEVER overwrite an existing numeric extension's password
      if (explicitUserPassword && Array.isArray(u.assignedExtensions)) {
        for (const assigned of u.assignedExtensions) {
          const cleanAssigned = String(assigned).replace(/[^a-zA-Z0-9_\-]/g, '');
          const cleanAssignedKey = cleanAssigned.toLowerCase();
          if (cleanAssigned && !mergedExtsMap.has(cleanAssignedKey)) {
            mergedExtsMap.set(cleanAssignedKey, {
              id: `ext-${cleanAssigned}`,
              extension: cleanAssigned,
              name: u.name || `Ext ${cleanAssigned}`,
              secret: diskSecretsMap.get(cleanAssignedKey) || explicitUserPassword,
              context: 'from-internal',
              transport: 'transport-udp',
              port: 47923,
              maxContacts: 5,
              codecs: ['ulaw', 'alaw'],
              callerIdNum: cleanAssigned,
              callerIdName: u.name || `Ext ${cleanAssigned}`,
              status: 'registered',
            });
          }
        }
      }
    }
  }

  // 3. Process resellerStore clients
  if (typeof resellerStore !== 'undefined' && resellerStore && Array.isArray(resellerStore.clients)) {
    for (const c of resellerStore.clients) {
      if (!c) continue;
      const rawC = String(c.sipUsername || c.name || '').trim();
      const cleanC = rawC.replace(/[^a-zA-Z0-9_\-]/g, '');
      if (cleanC && c.sipPassword) {
        const cKey = cleanC.toLowerCase();
        if (!mergedExtsMap.has(cKey)) {
          mergedExtsMap.set(cKey, {
            id: `ext-${cleanC}`,
            extension: cleanC,
            name: c.name || cleanC,
            secret: c.sipPassword,
            context: 'from-internal',
            transport: 'transport-udp',
            port: 47923,
            maxContacts: 10,
            codecs: ['ulaw', 'alaw'],
            callerIdNum: cleanC,
            callerIdName: c.name || cleanC,
            status: 'registered',
          });
        } else {
          const existing = mergedExtsMap.get(cKey);
          existing.secret = c.sipPassword;
        }
      }
    }
  }

  const extsToUse = Array.from(mergedExtsMap.values());

  // Determine active SIP transport port (default 47923 exclusively)
  let activePort = 47923;
  for (const ext of extsToUse) {
    const p = parseInt(ext.port, 10);
    if (!isNaN(p) && p > 0 && p <= 65535) {
      activePort = p;
      break;
    }
  }

  let pjsipContent = `; ========================================================\n`;
  pjsipContent += `; GENERADO AUTOMATICAMENTE POR ANONYMOUS OTP SYSTEM\n`;
  pjsipContent += `; Fecha: ${new Date().toISOString()}\n`;
  pjsipContent += `; Total Extensiones: ${extsToUse.length}\n`;
  pjsipContent += `; Puerto SIP de Transporte Activo: ${activePort}\n`;
  pjsipContent += `; Asterisk 20 Validated: Standard Native Transports (No Unknown Transport Errors)\n`;
  pjsipContent += `; ========================================================\n\n`;

  pjsipContent += `; --- TRANSPORTES SIP ---\n`;
  pjsipContent += `[transport-udp]\n`;
  pjsipContent += `type = transport\n`;
  pjsipContent += `protocol = udp\n`;
  pjsipContent += `bind = 0.0.0.0:${activePort}\n`;
  pjsipContent += `allow_reload = yes\n`;
  pjsipContent += `local_net = 127.0.0.0/8\n`;
  pjsipContent += `local_net = 10.0.0.0/8\n`;
  pjsipContent += `local_net = 172.16.0.0/12\n`;
  pjsipContent += `local_net = 192.168.0.0/16\n`;
  if (detectedExternalIp) {
    pjsipContent += `external_media_address = ${detectedExternalIp}\n`;
    pjsipContent += `external_signaling_address = ${detectedExternalIp}\n`;
  }
  pjsipContent += `\n`;

  if (activePort !== 5060) {
    pjsipContent += `; Transporte dedicado en puerto 5060 para interconexión estándar con Carriers mayoristas\n`;
    pjsipContent += `[transport-udp-5060]\n`;
    pjsipContent += `type = transport\n`;
    pjsipContent += `protocol = udp\n`;
    pjsipContent += `bind = 0.0.0.0:5060\n`;
    pjsipContent += `allow_reload = yes\n`;
    pjsipContent += `local_net = 127.0.0.0/8\n`;
    pjsipContent += `local_net = 10.0.0.0/8\n`;
    pjsipContent += `local_net = 172.16.0.0/12\n`;
    pjsipContent += `local_net = 192.168.0.0/16\n`;
    if (detectedExternalIp) {
      pjsipContent += `external_media_address = ${detectedExternalIp}\n`;
      pjsipContent += `external_signaling_address = ${detectedExternalIp}\n`;
    }
    pjsipContent += `\n`;
  }

  pjsipContent += `[transport-tcp]\n`;
  pjsipContent += `type = transport\n`;
  pjsipContent += `protocol = tcp\n`;
  pjsipContent += `bind = 0.0.0.0:${activePort}\n`;
  pjsipContent += `allow_reload = yes\n`;
  pjsipContent += `local_net = 127.0.0.0/8\n`;
  pjsipContent += `local_net = 10.0.0.0/8\n`;
  pjsipContent += `local_net = 172.16.0.0/12\n`;
  pjsipContent += `local_net = 192.168.0.0/16\n`;
  if (detectedExternalIp) {
    pjsipContent += `external_media_address = ${detectedExternalIp}\n`;
    pjsipContent += `external_signaling_address = ${detectedExternalIp}\n`;
  }
  pjsipContent += `\n`;

  pjsipContent += `[transport-wss]\n`;
  pjsipContent += `type = transport\n`;
  pjsipContent += `protocol = wss\n`;
  pjsipContent += `bind = 0.0.0.0:8089\n\n`;

  for (const ext of extsToUse) {
    const rawVal = (ext.extension || ext.id || ext.number || ext.num || '').toString().trim();
    // Permitir tanto números (1001) como nombres alfanuméricos para MicroSIP (ej. juan_perez, agente1)
    const num = rawVal.replace(/[^a-zA-Z0-9_\-]/g, '') || '1001';
    // Strip Asterisk .conf inline comment chars (;) and newlines from password so Asterisk never truncates it
    const rawPass = String(ext.secret || ext.password || 'Secr3tP@ssw0rd!1001').replace(/[\r\n;]/g, '').trim();
    const pass = rawPass || 'Secr3tP@ssw0rd!1001';
    let cleanCidName = ext.name || ext.callerIdName || `Extension ${num}`;
    if (cleanCidName === 'Seguridad Bancaria' || cleanCidName === 'BANRESERVAS' || cleanCidName === 'Atención al Cliente') {
      cleanCidName = ext.name || `Extension ${num}`;
    }
    const cleanCidNum = (ext.callerIdNum && !String(ext.callerIdNum).includes('5550199') && !String(ext.callerIdNum).includes('Asignado')) ? ext.callerIdNum : num;
    const callerId = `"${cleanCidName}" <${cleanCidNum}>`;
    const parsedExtPort = parseInt(ext.port, 10);
    const extPort = (!isNaN(parsedExtPort) && parsedExtPort > 0 && parsedExtPort <= 65535) ? parsedExtPort : activePort;

    let transport = 'transport-udp';
    if (ext.transport === 'transport-wss') {
      transport = 'transport-wss';
    } else if (ext.transport === 'transport-tcp') {
      transport = 'transport-tcp';
    } else if (ext.transport === 'transport-tls') {
      transport = 'transport-tls';
    } else if (extPort === 5060 && activePort !== 5060) {
      transport = 'transport-udp-5060';
    } else {
      transport = 'transport-udp';
    }

    const isWebRtcExt = transport === 'transport-wss';
    const rawCodecs = (ext.codecs && ext.codecs.length > 0) ? ext.codecs.join(',') : (isWebRtcExt ? 'opus,ulaw,alaw' : 'ulaw,alaw');
    const codecs = prioritizeZeroTranscodeCodecs(rawCodecs, false, isWebRtcExt);

    pjsipContent += `; --- EXTENSIÓN ${num} (${ext.name || 'Agente'} - Puerto SIP ${extPort}) ---\n`;
    pjsipContent += `[${num}]\n`;
    pjsipContent += `type = endpoint\n`;
    pjsipContent += `context = ${ext.context || 'from-internal'}\n`;
    pjsipContent += `disallow = all\n`;
    pjsipContent += `allow = ${codecs}\n`;
    pjsipContent += `incoming_call_offer_pref = local_first\n`;
    pjsipContent += `outgoing_call_offer_pref = local_first\n`;
    pjsipContent += `auth = ${num}-auth\n`;
    pjsipContent += `aors = ${num}\n`;
    pjsipContent += `callerid = ${callerId}\n`;
    pjsipContent += `transport = ${transport}\n`;
    pjsipContent += `direct_media = no\n`;
    pjsipContent += `rtp_symmetric = yes\n`;
    pjsipContent += `force_rport = yes\n`;
    pjsipContent += `rewrite_contact = yes\n`;
    pjsipContent += `send_pai = yes\n`;
    pjsipContent += `send_rpid = yes\n`;
    pjsipContent += `send_connected_line = yes\n`;
    pjsipContent += `trust_id_outbound = yes\n`;
    pjsipContent += `trust_id_inbound = yes\n`;
    pjsipContent += `identify_by = auth_username,username\n`;
    pjsipContent += `callerid_privacy = allowed\n`;
    pjsipContent += `dtmf_mode = rfc4733\n`;
    pjsipContent += `rtp_keepalive = 30\n`;
    pjsipContent += `rtp_timeout = 60\n`;
    pjsipContent += `rtp_timeout_hold = 300\n`;
    pjsipContent += `asymmetric_rtp_codec = no\n`;
    pjsipContent += `timers = no\n`;
    pjsipContent += `language = es\n`;
    pjsipContent += `moh_suggest = default\n\n`;

    pjsipContent += `[${num}-auth]\n`;
    pjsipContent += `type = auth\n`;
    pjsipContent += `auth_type = userpass\n`;
    pjsipContent += `username = ${num}\n`;
    pjsipContent += `password = ${pass}\n\n`;

    pjsipContent += `[${num}]\n`;
    pjsipContent += `type = aor\n`;
    pjsipContent += `max_contacts = ${ext.maxContacts || 10}\n`;
    pjsipContent += `remove_existing = yes\n`;
    pjsipContent += `qualify_frequency = 30\n`;
    pjsipContent += `authenticate_qualify = no\n\n`;
  }

  // Process carriers/trunks
  const rawCarriers = Array.isArray(carriers) ? carriers : (lastSyncedCarriers.length > 0 ? lastSyncedCarriers : defaultCarriersList);
  const carriersToProcess = [...rawCarriers];

  if (Array.isArray(carriersToProcess) && carriersToProcess.length > 0) {
    pjsipContent += `; ========================================================\n`;
    pjsipContent += `; TRONCALES / CARRIERS SIP (OUTBOUND & INBOUND)\n`;
    pjsipContent += `; ========================================================\n\n`;

    const processedHosts = new Set<string>();
    const carrierSlugMap = buildCarrierEndpointSlugMap(extsToUse, carriersToProcess, extraUsers);
    const usedCarrierSlugs = new Set<string>(extsToUse.map((e: any) => String(e.extension || '').toLowerCase()));
    const rawCarrierNamesSet = new Set<string>(
      carriersToProcess
        .filter((c: any) => c && c.name && c.enabled !== false && c.status !== 'disabled')
        .map((c: any) => c.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'))
    );

    for (let cIdx = 0; cIdx < carriersToProcess.length; cIdx++) {
      const carrier = carriersToProcess[cIdx];
      if (!carrier || !carrier.name || !carrier.host) continue;
      const isEnabled = carrier.enabled !== false && carrier.status !== 'disabled';
      const baseSlug = carrier.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') || `trunk_${cIdx + 1}`;
      const cName = isEnabled
        ? (carrierSlugMap.get(String(carrier.id || carrier.name || cIdx)) || baseSlug)
        : baseSlug;

      // Sanitización agresiva de host, puerto y parámetros contra comentarios ';' o saltos de línea
      let cHost = String(carrier.host || '')
        .replace(/[\r\n;]/g, '')
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/^sips?:/i, '')
        .replace(/^\/\//, '')
        .replace(/\/.*$/, '');
      let cPort = Number(carrier.port) || 5060;
      if (cHost.includes(':')) {
        const parts = cHost.split(':');
        cHost = parts[0].trim();
        cPort = Number(parts[1]) || cPort;
      }
      if (!cHost) continue;

      if (!isEnabled) {
        pjsipContent += `; --- CARRIER DESHABILITADO: ${cName} (${cHost}:${cPort}) ---\n`;
        pjsipContent += `; [ESTADO: SUSPENDIDO] Registro y endpoints omitidos para evitar intentos de conexión\n\n`;
        continue;
      }

      usedCarrierSlugs.add(cName);

      const cUser = String(carrier.username || cName).replace(/[\r\n;]/g, '').trim() || cName;
      const cSecret = String(carrier.secret || '').replace(/[\r\n;]/g, '').trim();
      const cContext = String(carrier.inboundContext || 'trunkinbound').replace(/[\r\n;\s]/g, '').trim() || 'trunkinbound';
      const rawTrunkCodecs = (carrier.codecs && carrier.codecs.length > 0) ? carrier.codecs.join(',') : 'ulaw,alaw';
      const cCodecs = prioritizeZeroTranscodeCodecs(rawTrunkCodecs, true);

      // effectiveFromUser asegura que el From SIP coincida con la cuenta SIP cuando se especifica o se registra
      const effectiveFromUser = String(carrier.fromuser || '').replace(/[\r\n;]/g, '').trim();
      const isRegTrunk = carrier.authType !== 'ip_auth' && !!cSecret;
      const trunkTransport = (activePort !== 5060 && cPort !== activePort && carrier.transport !== 'transport-udp')
        ? 'transport-udp-5060'
        : 'transport-udp';

      pjsipContent += `; --- CARRIER: ${cName} (${cHost}:${cPort}) [${isRegTrunk ? 'REGISTRATION' : 'IP_AUTH'}] ---\n`;

      if (isRegTrunk) {
        pjsipContent += `[reg_${cName}]\n`;
        pjsipContent += `type = registration\n`;
        pjsipContent += `outbound_auth = auth_${cName}\n`;
        pjsipContent += `server_uri = sip:${cHost}:${cPort}\n`;
        pjsipContent += `client_uri = sip:${cUser}@${cHost}:${cPort}\n`;
        pjsipContent += `contact_user = ${effectiveFromUser || cUser}\n`;
        pjsipContent += `retry_interval = 30\n`;
        pjsipContent += `forbidden_retry_interval = 30\n`;
        pjsipContent += `fatal_retry_interval = 30\n`;
        pjsipContent += `auth_rejection_permanent = false\n`;
        pjsipContent += `max_retries = 100\n`;
        pjsipContent += `expiration = 3600\n`;
        pjsipContent += `line = yes\n`;
        pjsipContent += `endpoint = ${cName}\n`;
        pjsipContent += `transport = ${trunkTransport}\n\n`;
      }

      if (cSecret && carrier.authType !== 'ip_auth') {
        // IMPORTANTE: No fijar "realm = asterisk" para aceptar cualquier realm SIP que envíe el carrier remoto (evita 401/403)
        pjsipContent += `[auth_${cName}]\n`;
        pjsipContent += `type = auth\n`;
        pjsipContent += `auth_type = userpass\n`;
        pjsipContent += `username = ${cUser}\n`;
        pjsipContent += `password = ${cSecret}\n\n`;
      }

      pjsipContent += `[${cName}_aor]\n`;
      pjsipContent += `type = aor\n`;
      pjsipContent += `contact = sip:${cHost}:${cPort}\n`;
      const qualifyVal = (carrier.qualifyFreq !== undefined && carrier.qualifyFreq !== null && carrier.qualifyFreq !== '')
        ? Math.max(0, Number(carrier.qualifyFreq) || 0)
        : 0;
      pjsipContent += `qualify_frequency = ${qualifyVal}\n`;
      if (qualifyVal > 0) {
        pjsipContent += `qualify_timeout = 3.0\n`;
      }
      pjsipContent += `\n`;

      pjsipContent += `[${cName}]\n`;
      pjsipContent += `type = endpoint\n`;
      pjsipContent += `context = ${cContext}\n`;
      pjsipContent += `disallow = all\n`;
      pjsipContent += `allow = ${cCodecs}\n`;
      pjsipContent += `aors = ${cName}_aor\n`;
      if (carrier.authType === 'ip_auth' || !cSecret) {
        pjsipContent += `identify_by = ip\n`;
      } else {
        pjsipContent += `outbound_auth = auth_${cName}\n`;
      }
      if (effectiveFromUser) {
        pjsipContent += `from_user = ${effectiveFromUser}\n`;
        pjsipContent += `contact_user = ${effectiveFromUser}\n`;
      } else if (isRegTrunk) {
        pjsipContent += `from_user = ${cUser}\n`;
        pjsipContent += `contact_user = ${cUser}\n`;
      }
      pjsipContent += `from_domain = ${cHost}\n`;
      pjsipContent += `direct_media = no\n`;
      pjsipContent += `rtp_symmetric = yes\n`;
      pjsipContent += `force_rport = yes\n`;
      pjsipContent += `rewrite_contact = yes\n`;
      pjsipContent += `rtp_timeout = 60\n`;
      pjsipContent += `rtp_timeout_hold = 300\n`;
      const rawExplicitOutCid = String(carrier.outboundCallerId || '').trim();
      const hasExplicitOutCid = Boolean(
        rawExplicitOutCid &&
        !rawExplicitOutCid.includes('5550199') &&
        !/asignado/i.test(rawExplicitOutCid)
      );
      if (isRegTrunk) {
        pjsipContent += `send_pai = ${carrier.sendrpid === 'yes' && hasExplicitOutCid ? 'yes' : 'no'}\n`;
        pjsipContent += `send_rpid = ${carrier.sendrpid === 'yes' && hasExplicitOutCid ? 'yes' : 'no'}\n`;
      } else {
        pjsipContent += `send_pai = ${hasExplicitOutCid || carrier.sendrpid === 'yes' ? 'yes' : 'no'}\n`;
        pjsipContent += `send_rpid = ${hasExplicitOutCid ? (carrier.sendrpid || 'yes') : (carrier.sendrpid === 'yes' ? 'yes' : 'no')}\n`;
      }
      pjsipContent += `trust_id_outbound = yes\n`;
      pjsipContent += `trust_id_inbound = ${carrier.trustrpid || 'yes'}\n`;
      pjsipContent += `callerid_privacy = allowed\n`;
      pjsipContent += `dtmf_mode = rfc4733\n`;
      pjsipContent += `rtp_keepalive = 5\n`;
      pjsipContent += `asymmetric_rtp_codec = no\n`;
      pjsipContent += `timers = no\n`;
      pjsipContent += `send_connected_line = no\n`;
      pjsipContent += `inband_progress = no\n`;
      pjsipContent += `language = es\n`;
      pjsipContent += `moh_suggest = default\n`;
      pjsipContent += `transport = ${trunkTransport}\n\n`;

      // Alias de compatibilidad bidireccional televox <-> televoxin (solo si el otro alias no existe ya en la lista)
      if (cName === 'televoxin' && !rawCarrierNamesSet.has('televox') && !usedCarrierSlugs.has('televox')) {
        usedCarrierSlugs.add('televox');
        pjsipContent += `; Alias de compatibilidad televox -> televoxin\n`;
        pjsipContent += `[televox]\n`;
        pjsipContent += `type = endpoint\n`;
        pjsipContent += `context = ${cContext}\n`;
        pjsipContent += `disallow = all\n`;
        pjsipContent += `allow = ${cCodecs}\n`;
        pjsipContent += `aors = televoxin_aor\n`;
        if (isRegTrunk) pjsipContent += `outbound_auth = auth_televoxin\n`;
        pjsipContent += `from_user = ${effectiveFromUser || cUser}\n`;
        pjsipContent += `from_domain = ${cHost}\n`;
        pjsipContent += `contact_user = ${effectiveFromUser || cUser}\n`;
        pjsipContent += `direct_media = no\n`;
        pjsipContent += `rtp_symmetric = yes\n`;
        pjsipContent += `force_rport = yes\n`;
        pjsipContent += `rewrite_contact = yes\n`;
        pjsipContent += `send_pai = no\n`;
        pjsipContent += `send_rpid = no\n`;
        pjsipContent += `trust_id_outbound = yes\n`;
        pjsipContent += `trust_id_inbound = yes\n`;
        pjsipContent += `callerid_privacy = allowed\n`;
        pjsipContent += `dtmf_mode = rfc4733\n`;
        pjsipContent += `rtp_keepalive = 5\n`;
        pjsipContent += `timers = no\n`;
        pjsipContent += `send_connected_line = no\n`;
        pjsipContent += `inband_progress = no\n`;
        pjsipContent += `language = es\n`;
        pjsipContent += `transport = ${trunkTransport}\n\n`;
      } else if (cName === 'televox' && !rawCarrierNamesSet.has('televoxin') && !usedCarrierSlugs.has('televoxin')) {
        usedCarrierSlugs.add('televoxin');
        pjsipContent += `; Alias de compatibilidad televoxin -> televox\n`;
        pjsipContent += `[televoxin]\n`;
        pjsipContent += `type = endpoint\n`;
        pjsipContent += `context = ${cContext}\n`;
        pjsipContent += `disallow = all\n`;
        pjsipContent += `allow = ${cCodecs}\n`;
        pjsipContent += `aors = televox_aor\n`;
        if (isRegTrunk) pjsipContent += `outbound_auth = auth_televox\n`;
        pjsipContent += `from_user = ${effectiveFromUser || cUser}\n`;
        pjsipContent += `from_domain = ${cHost}\n`;
        pjsipContent += `contact_user = ${effectiveFromUser || cUser}\n`;
        pjsipContent += `direct_media = no\n`;
        pjsipContent += `rtp_symmetric = yes\n`;
        pjsipContent += `force_rport = yes\n`;
        pjsipContent += `rewrite_contact = yes\n`;
        pjsipContent += `send_pai = no\n`;
        pjsipContent += `send_rpid = no\n`;
        pjsipContent += `trust_id_outbound = yes\n`;
        pjsipContent += `trust_id_inbound = yes\n`;
        pjsipContent += `callerid_privacy = allowed\n`;
        pjsipContent += `dtmf_mode = rfc4733\n`;
        pjsipContent += `rtp_keepalive = 5\n`;
        pjsipContent += `timers = no\n`;
        pjsipContent += `send_connected_line = no\n`;
        pjsipContent += `inband_progress = no\n`;
        pjsipContent += `language = es\n`;
        pjsipContent += `transport = ${trunkTransport}\n\n`;
      }

      // Identify section for IP auth or non-registration trunks
      if (!isRegTrunk) {
        if (!processedHosts.has(cHost)) {
          processedHosts.add(cHost);
          pjsipContent += `[${cName}-identify]\n`;
          pjsipContent += `type = identify\n`;
          pjsipContent += `endpoint = ${cName}\n`;
          pjsipContent += `match = ${cHost}\n\n`;
        }
      }
    }
  }

  return pjsipContent;
}

let cachedPjsipEndpoints: { raw: string; parsed: any[]; timestamp: number } | null = null;
let isQueryingEndpoints = false;

// Robust PJSIP endpoint and contact reader from Asterisk CLI or AMI with memory caching
async function queryAsteriskPjsipEndpoints(): Promise<{ raw: string; parsed: any[] }> {
  const now = Date.now();
  if (cachedPjsipEndpoints && (now - cachedPjsipEndpoints.timestamp < 5000)) {
    return cachedPjsipEndpoints;
  }
  if (isQueryingEndpoints && cachedPjsipEndpoints) {
    return cachedPjsipEndpoints;
  }

  isQueryingEndpoints = true;
  let output = '';
  try {
    output = await executeAsteriskCommand('pjsip show endpoints');
  } catch (_) {}
  finally {
    isQueryingEndpoints = false;
  }

  const lines = output.split('\n');
  const endpoints: any[] = [];
  let current: any = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const epMatch = trimmed.match(/Endpoint:\s*([0-9a-zA-Z_-]+)(?:\/([^\s]+))?\s+([A-Za-z ]+?)(?:\s+\d+\s+of\s+.*)?$/);
    if (epMatch) {
      if (current) endpoints.push(current);
      const extNum = epMatch[1];
      const state = (epMatch[3] || '').trim();
      const isRegistered = state.toLowerCase().includes('not in use') || state.toLowerCase().includes('in use');
      current = {
        extension: extNum,
        state: state || 'Unknown',
        status: isRegistered ? 'registered' : 'unavailable',
        contact: '',
        contactStatus: '',
        rtt: '',
        auth: '',
        aor: '',
      };
      continue;
    }

    if (current) {
      if (trimmed.startsWith('I/OAuth:') || trimmed.startsWith('InAuth:')) {
        const authMatch = trimmed.match(/(?:I\/OAuth|InAuth):\s*([^\s]+)/);
        if (authMatch) current.auth = authMatch[1];
      } else if (trimmed.startsWith('Aor:')) {
        const aorMatch = trimmed.match(/Aor:\s*([^\s]+)/);
        if (aorMatch) current.aor = aorMatch[1];
      } else if (trimmed.startsWith('Contact:')) {
        const contactMatch = trimmed.match(/Contact:\s*([^\s]+)\s+([0-9a-fA-F]+)?\s*([A-Za-z]+)?\s*([\d.]+)?/);
        if (contactMatch) {
          current.contact = contactMatch[1] || '';
          current.contactStatus = contactMatch[3] || '';
          current.rtt = contactMatch[4] ? `${contactMatch[4]}ms` : '';
          if (trimmed.includes('Avail')) {
            current.status = 'registered';
          }
        }
      }
    }
  }
  if (current) endpoints.push(current);

  return { raw: output, parsed: endpoints };
}

// Generate clean Asterisk extensions.conf (Dialplan) with complete routing, multi-carrier failover and IVR capture
export function generateCleanDialplanConf(
  carriersInput: any = defaultCarriersList,
  carrierHostFallback = 'voip.ghostcall.online',
  audios: { audioIntro?: string; audioPrompt?: string; audioWait?: string; audioSuccess?: string; audioAgent?: string } = {},
  extensionsInput: any[] = lastSyncedExtensions
): string {
  const carriersList: any[] = Array.isArray(carriersInput)
    ? carriersInput
    : (typeof carriersInput === 'string'
        ? [{ name: carriersInput, host: carrierHostFallback, enabled: true }]
        : lastSyncedCarriers);

  const enabledCarriers = carriersList.filter((c) => c && c.name && c.enabled !== false && c.status !== 'disabled');
  const primaryCarrier = enabledCarriers[0] || carriersList[0] || { name: 'carrier_default', host: carrierHostFallback };
  const carrierHost = primaryCarrier.host || carrierHostFallback;
  const rawPrimaryCid = String(primaryCarrier.outboundCallerId || '').trim();
  const defaultCidNum = (rawPrimaryCid && !rawPrimaryCid.includes('5550199') && !/asignado/i.test(rawPrimaryCid))
    ? rawPrimaryCid.replace(/[^0-9+]/g, '')
    : '';
  const defaultCidName = (defaultCidNum && primaryCarrier.outboundCallerIdName)
    ? String(primaryCarrier.outboundCallerIdName).trim()
    : '';
  const storedTenantsForDialplan = loadStoredTenants();

  // Generación dinámica de la cadena Ring-All para todas las extensiones activas (ej: PJSIP/1001&PJSIP/1002...)
  // Quien descuelga primero gana la llamada y los demás canales dejan de timbrar inmediatamente
  const extsList = (Array.isArray(extensionsInput) && extensionsInput.length > 0) ? extensionsInput : lastSyncedExtensions;
  const ringAllSet = new Set<string>();
  for (const e of extsList) {
    if (!e || e.enabled === false || e.isSpyOnly === true) continue;
    const rawExt = (e.extension || e.id || '').toString().trim();
    if (rawExt === '1000' || /^4\d{3}$/.test(rawExt) || rawExt === '8888' || rawExt === '8880') continue; // Excluir espía 1000 y motor OTP/prueba
    if (rawExt && /^[0-9]{2,6}$/.test(rawExt)) {
      ringAllSet.add(`PJSIP/${rawExt}`);
    }
  }
  try {
    const storedUsersForRing = loadStoredUsers();
    for (const u of storedUsersForRing) {
      if (u && Array.isArray(u.assignedExtensions)) {
        for (const ue of u.assignedExtensions) {
          const cleanUe = String(ue || '').trim();
          if (cleanUe && cleanUe !== '1000' && !/^4\d{3}$/.test(cleanUe) && cleanUe !== '8888' && cleanUe !== '8880' && /^[0-9]{2,6}$/.test(cleanUe)) {
            ringAllSet.add(`PJSIP/${cleanUe}`);
          }
        }
      }
    }
  } catch (_) {}
  const ringAllList = Array.from(ringAllSet);
  const ringAllDialString = ringAllList.length > 0 ? ringAllList.join('&') : 'PJSIP/1001&PJSIP/1002';

  let dialplanContent = `; ========================================================\n`;
  dialplanContent += `; DIALPLAN DE LLAMADAS INTERNAS Y SALIENTES VIA PJSIP\n`;
  dialplanContent += `; Auto-generado por Black Hat Dialer Asterisk Platform\n`;
  dialplanContent += `; Troncales Habilitadas: ${enabledCarriers.length} (${enabledCarriers.map((c) => c.name).join(', ') || 'Ninguna'})\n`;
  dialplanContent += `; Extensiones Ring-All: ${ringAllList.length} (${ringAllDialString})\n`;
  dialplanContent += `; ========================================================\n\n`;
  dialplanContent += `[general]\nstatic=yes\nwriteprotect=no\n\n`;

  const chosenIntro = audios.audioIntro || 'custom/bienvenida_corporativa';
  const chosenPrompt = audios.audioPrompt || 'custom/solicitar_codigo_otp';
  const chosenWait = audios.audioWait || 'custom/un_momento_validando_informacion';
  const chosenSuccess = audios.audioSuccess || 'custom/operacion_bloqueada_exito';
  const chosenAgent = audios.audioAgent || 'custom/conectar_asesor';

  dialplanContent += `[globals]\n`;
  dialplanContent += `GLOBAL_CARRIER_HOST=${carrierHost}\n`;
  dialplanContent += `GLOBAL_DEFAULT_CID_NUM=${defaultCidNum}\n`;
  dialplanContent += `GLOBAL_DEFAULT_CID_NAME=${defaultCidName}\n`;
  dialplanContent += `GLOBAL_DEFAULT_INTRO=${chosenIntro}\n`;
  dialplanContent += `GLOBAL_DEFAULT_PROMPT=${chosenPrompt}\n`;
  dialplanContent += `GLOBAL_DEFAULT_WAIT=${chosenWait}\n`;
  dialplanContent += `GLOBAL_DEFAULT_SUCCESS=${chosenSuccess}\n`;
  dialplanContent += `GLOBAL_DEFAULT_AGENT=${chosenAgent}\n`;
  dialplanContent += `GLOBAL_RINGALL_EXTENSIONS=${ringAllDialString}\n\n`;

  dialplanContent += `; Subrutina Pre-Dial para preparacion de audio en canal saliente real (CallerID asignado por el proveedor SIP)\n`;
  dialplanContent += `[sub-pjsip-outbound]\n`;
  dialplanContent += `exten => s,1,NoOp(=== [OUTBOUND PRE-DIAL] Canal: \${CHANNEL} | CID Carrier=\${ARG1} | TrunkUser=\${ARG2} ===)\n`;
  dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(name-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,GotoIf($["\${ARG1}" != ""]?set_explicit_carrier_cid:provider_assigned_cid)\n`;
  dialplanContent += ` same => n(set_explicit_carrier_cid),Set(CALLERID(num)=\${ARG1})\n`;
  dialplanContent += ` same => n,ExecIf($["\${ARG2}" != ""]?Set(CALLERID(name)=\${ARG2}))\n`;
  dialplanContent += ` same => n,Return()\n`;
  dialplanContent += ` same => n(provider_assigned_cid),Set(CALLERID(name)=)\n`;
  dialplanContent += ` same => n,ExecIf($["\${ARG2}" != "" & \${REGEX("^[+]?[0-9]{7,}$" \${ARG2})} = 1 & $["\${CALLERID(num)}" = "" | "\${CALLERID(num)}" = "18005550199" | "\${CALLERID(num)}" = "+18005550199" | \${LEN(\${CALLERID(num)})} < 7 | "\${CALLERID(num)}" = "\${TARGET_NUM}" | "\${CALLERID(num)}" = "\${CALL_DEST}"]]?Set(CALLERID(num)=\${ARG2}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${ARG2}" = "" | \${REGEX("^[+]?[0-9]{7,}$" \${ARG2})} = 0] & $["\${CALLERID(num)}" = "18005550199" | "\${CALLERID(num)}" = "+18005550199" | \${LEN(\${CALLERID(num)})} < 7 | "\${CALLERID(num)}" = "\${TARGET_NUM}" | "\${CALLERID(num)}" = "\${CALL_DEST}"]]?Set(CALLERID(num)=))\n`;
  dialplanContent += ` same => n,NoOp(=== [OUTBOUND CARRIER] CallerID asignado directamente por el proveedor SIP (num=\${CALLERID(num)}) ===)\n`;
  dialplanContent += ` same => n,Return()\n\n`;

  dialplanContent += `[sub-pjsip-headers]\n`;
  dialplanContent += `exten => s,1,Goto(sub-pjsip-outbound,s,1)\n\n`;

  dialplanContent += `; Subrutina Pre-Dial para mostrar el número exacto del cliente en MicroSIP al timbrar y al recoger la llamada\n`;
  dialplanContent += `[sub-audio-quality]\n`;
  dialplanContent += `exten => s,1,NoOp(=== [AUDIO-HD-BIDIRECCIONAL] Mostrando Cliente en MicroSIP: ARG1=\${ARG1} | TARGET_NUM=\${TARGET_NUM} | Canal=\${CHANNEL} ===)\n`;
  dialplanContent += ` same => n,StopMusicOnHold()\n`;
  dialplanContent += ` same => n,Set(TARGET_DISPLAY=\${IF($["\${ARG1}" != ""]?\${ARG1}:\${IF($["\${TARGET_NUM}" != ""]?\${TARGET_NUM}:\${IF($["\${CUSTOMER_NUM}" != ""]?\${CUSTOMER_NUM}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${IF($["\${DEST_NUM}" != ""]?\${DEST_NUM}:\${CALLERID(num)})})})})})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${TARGET_DISPLAY}" = ""]?Set(TARGET_DISPLAY=SistemaWeb))\n`;
  dialplanContent += ` same => n,NoOp(=== [SETTING-CLIENT-CID-MICROSIP] Asignando número de cliente a MicroSIP: \${TARGET_DISPLAY} ===)\n`;
  dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(name-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,ExecIf($["\${TARGET_DISPLAY}" != ""]?Set(CALLERID(num)=\${TARGET_DISPLAY}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${TARGET_DISPLAY}" != ""]?Set(CALLERID(name)=\${TARGET_DISPLAY}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${TARGET_DISPLAY}" != ""]?Set(CALLERID(all)="\${TARGET_DISPLAY}" <\${TARGET_DISPLAY}>))\n`;
  dialplanContent += ` same => n,ExecIf($["\${TARGET_DISPLAY}" != ""]?Set(CONNECTEDLINE(num,i)=\${TARGET_DISPLAY}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${TARGET_DISPLAY}" != ""]?Set(CONNECTEDLINE(name,i)=\${TARGET_DISPLAY}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${TARGET_DISPLAY}" != ""]?Set(CONNECTEDLINE(all,i)="\${TARGET_DISPLAY}" <\${TARGET_DISPLAY}>))\n`;
  dialplanContent += ` same => n,Return()\n\n`;

  dialplanContent += `; Subrutina Pre-Bridge (U) ejecutada en el canal que atiende (Ring-All o Directo) para registrar la extension exacta y fijar el numero del cliente en MicroSIP\n`;
  dialplanContent += `[sub-record-picked-agent]\n`;
  dialplanContent += `exten => s,1,NoOp(=== [AGENT-ANSWERED] Canal que descolgo la llamada: \${CHANNEL} | Endpoint: \${CHANNEL(endpoint)} | Cliente: \${ARG1} ===)\n`;
  dialplanContent += ` same => n,Set(PICKED_EXTEN=\${CHANNEL(endpoint)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${PICKED_EXTEN}" = ""]?Set(PICKED_EXTEN=\${CUT(CUT(CHANNEL,-,1),/,2)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PICKED_EXTEN}" = ""]?Set(PICKED_EXTEN=\${DIALEDPEERNUMBER}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PICKED_EXTEN}" = ""]?Set(PICKED_EXTEN=\${CALLERID(num)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PICKED_EXTEN}" = ""]?Set(PICKED_EXTEN=1001))\n`;
  dialplanContent += ` same => n,NoOp(=== [STICKY-AGENT-SAVED] Extension \${PICKED_EXTEN} registrada como asesor exclusivo de la llamada ===)\n`;
  dialplanContent += ` same => n,Set(DB(last_picked_agent/\${ARG1})=\${PICKED_EXTEN})\n`;
  dialplanContent += ` same => n,Set(DB(last_picked_agent/\${ARG2})=\${PICKED_EXTEN})\n`;
  dialplanContent += ` same => n,Set(DB(last_picked_agent/global)=\${PICKED_EXTEN})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${ARG1})=\${PICKED_EXTEN})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${ARG2})=\${PICKED_EXTEN})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${PICKED_EXTEN})\n`;
  dialplanContent += ` same => n,Set(DB(ivr_vars/\${ARG1}_agent_exten)=\${PICKED_EXTEN})\n`;
  dialplanContent += ` same => n,Set(DB(ivr_vars/\${ARG2}_agent_exten)=\${PICKED_EXTEN})\n`;
  dialplanContent += ` same => n,ExecIf($["\${ARG1}" != ""]?Set(CALLERID(pres)=allowed_not_screened))\n`;
  dialplanContent += ` same => n,ExecIf($["\${ARG1}" != ""]?Set(CALLERID(all)="\${ARG1}" <\${ARG1}>))\n`;
  dialplanContent += ` same => n,ExecIf($["\${ARG1}" != ""]?Set(CONNECTEDLINE(num,i)=\${ARG1}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${ARG1}" != ""]?Set(CONNECTEDLINE(name,i)=\${ARG1}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${ARG1}" != ""]?Set(CONNECTEDLINE(all,i)="\${ARG1}" <\${ARG1}>))\n`;
  dialplanContent += ` same => n,ExecIf($["\${ARG1}" != ""]?Set(MASTER_CHANNEL(CALLERID(pres))=allowed_not_screened))\n`;
  dialplanContent += ` same => n,ExecIf($["\${ARG1}" != ""]?Set(MASTER_CHANNEL(CALLERID(num))=\${ARG1}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${ARG1}" != ""]?Set(MASTER_CHANNEL(CALLERID(name))=\${ARG1}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${ARG1}" != ""]?Set(MASTER_CHANNEL(CALLERID(all))="\${ARG1}" <\${ARG1}>))\n`;
  dialplanContent += ` same => n,Set(SHARED(PICKED_AGENT,\${MASTER_CHANNEL})=\${PICKED_EXTEN})\n`;
  dialplanContent += ` same => n,Set(__LAST_AGENT=\${PICKED_EXTEN})\n`;
  dialplanContent += ` same => n,Set(__FINAL_AGENT=\${PICKED_EXTEN})\n`;
  dialplanContent += ` same => n,Set(__CALLING_AGENT=\${PICKED_EXTEN})\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${ARG1})}&status=talking&agent=\${URIENCODE(\${PICKED_EXTEN})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,Set(REC_IN_FILE=\${IF($["\${DB(record_ext/\${PICKED_EXTEN})}" = "1"]?/var/spool/asterisk/monitor/\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)}_IN_\${PICKED_EXTEN}_from_\${FILTER(0-9,\${ARG1})}_\${UNIQUEID}.wav:)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${REC_IN_FILE}" != ""]?NoOp(=== [MIXMONITOR IN] Grabando llamada de extension \${PICKED_EXTEN}: \${REC_IN_FILE} ===))\n`;
  dialplanContent += ` same => n,ExecIf($["\${REC_IN_FILE}" != ""]?MixMonitor(\${REC_IN_FILE}))\n`;
  dialplanContent += ` same => n,Return()\n\n`;

  dialplanContent += `[from-internal]\n`;
  dialplanContent += `; 0. Códigos de Modo Espía / Supervisión ChanSpy (*55, *56, *57) - Reservado para Ext 1000 (Super Admin) y Supervisores autorizados\n`;
  dialplanContent += `exten => *55,1,NoOp(=== [CHANSPY ESCANEO] \${CALLERID(num)} iniciando escucha general ===)\n`;
  dialplanContent += ` same => n,Set(SPY_CALLER=\${IF($["\${CHANNEL(channeltype)}" = "PJSIP"]?\${CHANNEL(endpoint)}:\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${SPY_CALLER}" = "1000" | "\${DB(spy_allowed/\${SPY_CALLER})}" = "1"]?allow_spy_all)\n`;
  dialplanContent += ` same => n,NoOp(=== [CHANSPY BLOQUEADO] Extension \${SPY_CALLER} no autorizada ===)\n`;
  dialplanContent += ` same => n,Congestion(21)\n`;
  dialplanContent += ` same => n,Hangup()\n`;
  dialplanContent += ` same => n(allow_spy_all),Answer()\n`;
  dialplanContent += ` same => n,Wait(0.3)\n`;
  dialplanContent += ` same => n,ChanSpy(PJSIP,q)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `exten => _*55X.,1,NoOp(=== [CHANSPY SILENCIOSO] \${CALLERID(num)} espiando extension \${EXTEN:3} ===)\n`;
  dialplanContent += ` same => n,Set(SPY_CALLER=\${IF($["\${CHANNEL(channeltype)}" = "PJSIP"]?\${CHANNEL(endpoint)}:\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${SPY_CALLER}" = "1000" | "\${DB(spy_allowed/\${SPY_CALLER})}" = "1"]?allow_spy_ext)\n`;
  dialplanContent += ` same => n,NoOp(=== [CHANSPY BLOQUEADO] Extension \${SPY_CALLER} no autorizada ===)\n`;
  dialplanContent += ` same => n,Congestion(21)\n`;
  dialplanContent += ` same => n,Hangup()\n`;
  dialplanContent += ` same => n(allow_spy_ext),Answer()\n`;
  dialplanContent += ` same => n,Wait(0.3)\n`;
  dialplanContent += ` same => n,ChanSpy(PJSIP/\${EXTEN:3},q)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `exten => _*56X.,1,NoOp(=== [CHANSPY SUSURRO] \${CALLERID(num)} susurrando a \${EXTEN:3} ===)\n`;
  dialplanContent += ` same => n,Set(SPY_CALLER=\${IF($["\${CHANNEL(channeltype)}" = "PJSIP"]?\${CHANNEL(endpoint)}:\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${SPY_CALLER}" = "1000" | "\${DB(spy_allowed/\${SPY_CALLER})}" = "1"]?allow_whisper_ext)\n`;
  dialplanContent += ` same => n,Congestion(21)\n`;
  dialplanContent += ` same => n,Hangup()\n`;
  dialplanContent += ` same => n(allow_whisper_ext),Answer()\n`;
  dialplanContent += ` same => n,Wait(0.3)\n`;
  dialplanContent += ` same => n,ChanSpy(PJSIP/\${EXTEN:3},qw)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `exten => _*57X.,1,NoOp(=== [CHANSPY BARGE] \${CALLERID(num)} interviniendo en \${EXTEN:3} ===)\n`;
  dialplanContent += ` same => n,Set(SPY_CALLER=\${IF($["\${CHANNEL(channeltype)}" = "PJSIP"]?\${CHANNEL(endpoint)}:\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${SPY_CALLER}" = "1000" | "\${DB(spy_allowed/\${SPY_CALLER})}" = "1"]?allow_barge_ext)\n`;
  dialplanContent += ` same => n,Congestion(21)\n`;
  dialplanContent += ` same => n,Hangup()\n`;
  dialplanContent += ` same => n(allow_barge_ext),Answer()\n`;
  dialplanContent += ` same => n,Wait(0.3)\n`;
  dialplanContent += ` same => n,ChanSpy(PJSIP/\${EXTEN:3},qB)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `; 1. Llamadas internas exactas para todas las extensiones configuradas (2-6 digitos o nombre) desde MicroSIP\n`;
  const seenInternalExts = new Set<string>();
  for (const ext of extsList) {
    const extNum = String(ext?.extension || ext?.id || ext?.number || ext?.num || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!extNum || seenInternalExts.has(extNum.toLowerCase())) continue;
    if (/^4\d{3}$/.test(extNum) || extNum === '8888' || extNum === '8880') continue;
    seenInternalExts.add(extNum.toLowerCase());
    dialplanContent += `exten => ${extNum},1,NoOp(Llamada interna directa a extension ${extNum} desde MicroSIP)\n`;
    dialplanContent += ` same => n,StopMusicOnHold()\n`;
    dialplanContent += ` same => n,Set(CHANNEL(musicclass)=default)\n`;
    dialplanContent += ` same => n,Set(INT_CALLER=\${IF($["\${CHANNEL(channeltype)}" = "PJSIP"]?\${CHANNEL(endpoint)}:\${IF($["\${CALLERID(num)}" != ""]?\${CALLERID(num)}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:SistemaWeb)})})})\n`;
    dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_not_screened)\n`;
    dialplanContent += ` same => n,Set(CALLERID(num-pres)=allowed_not_screened)\n`;
    dialplanContent += ` same => n,Set(CALLERID(name-pres)=allowed_not_screened)\n`;
    dialplanContent += ` same => n,ExecIf($["\${CALLERID(num)}" = ""]?Set(CALLERID(all)="\${INT_CALLER}" <\${INT_CALLER}>))\n`;
    dialplanContent += ` same => n,ExecIf($["\${DB(record_ext/\${INT_CALLER})}" = "1" | "\${DB(record_ext/${extNum})}" = "1"]?MixMonitor(/var/spool/asterisk/monitor/\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)}_INT_\${INT_CALLER}_to_${extNum}_\${UNIQUEID}.wav,b))\n`;
    dialplanContent += ` same => n,Dial(PJSIP/${extNum},30,Ttb(sub-audio-quality^s^1(\${INT_CALLER})))\n`;
    dialplanContent += ` same => n,Hangup()\n\n`;
  }

  dialplanContent += `; 1a. Llamadas internas entre extensiones de todos los Call Centers (1XXX, 2XXX, 3XXX, 5XXX-9XXX; 4XXX reservado para OTP) con Audio nativo limpio\n`;
  dialplanContent += `exten => _[12356789]XXX,1,NoOp(Llamada interna a extension \${EXTEN} con audio nativo limpio)\n`;
  dialplanContent += ` same => n,StopMusicOnHold()\n`;
  dialplanContent += ` same => n,Set(CHANNEL(musicclass)=default)\n`;
  dialplanContent += ` same => n,Set(INT_CALLER=\${IF($["\${CHANNEL(channeltype)}" = "PJSIP"]?\${CHANNEL(endpoint)}:\${IF($["\${CALLERID(num)}" != ""]?\${CALLERID(num)}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:SistemaWeb)})})})\n`;
  dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(name-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLERID(num)}" = ""]?Set(CALLERID(all)="\${INT_CALLER}" <\${INT_CALLER}>))\n`;
  dialplanContent += ` same => n,ExecIf($["\${DB(record_ext/\${INT_CALLER})}" = "1" | "\${DB(record_ext/\${EXTEN})}" = "1"]?MixMonitor(/var/spool/asterisk/monitor/\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)}_INT_\${INT_CALLER}_to_\${EXTEN}_\${UNIQUEID}.wav,b))\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${EXTEN},30,Ttb(sub-audio-quality^s^1(\${INT_CALLER})))\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `; 1b. Llamadas directas a extensiones por nombre para MicroSIP (ej: juan_perez, agente1)\n`;
  dialplanContent += `exten => _[a-zA-Z].,1,NoOp(Llamada directa a extension por nombre \${EXTEN} con audio nativo limpio)\n`;
  dialplanContent += ` same => n,StopMusicOnHold()\n`;
  dialplanContent += ` same => n,Set(CHANNEL(musicclass)=default)\n`;
  dialplanContent += ` same => n,Set(INT_CALLER=\${IF($["\${CHANNEL(channeltype)}" = "PJSIP"]?\${CHANNEL(endpoint)}:\${IF($["\${CALLERID(num)}" != ""]?\${CALLERID(num)}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:SistemaWeb)})})})\n`;
  dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(name-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLERID(num)}" = ""]?Set(CALLERID(all)="\${INT_CALLER}" <\${INT_CALLER}>))\n`;
  dialplanContent += ` same => n,ExecIf($["\${DB(record_ext/\${INT_CALLER})}" = "1" | "\${DB(record_ext/\${EXTEN})}" = "1"]?MixMonitor(/var/spool/asterisk/monitor/\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)}_INT_\${INT_CALLER}_to_\${EXTEN}_\${UNIQUEID}.wav,b))\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${EXTEN},30,Ttb(sub-audio-quality^s^1(\${INT_CALLER})))\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  // 2a. Extensiones Dinámicas de Captura OTP (desde 4001 en adelante _4XXX)
  dialplanContent += `; 2a. Extensiones Dinamicas de Captura OTP creadas desde la web (_4XXX >= 4001)\n`;
  dialplanContent += `exten => _4XXX,1,NoOp(=== TRANSFERENCIA A CAPTURA EN VIVO EXTENSION DINAMICA \${EXTEN} ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(0.5)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_NUM}" != ""]?\${TARGET_NUM}:\${IF($["\${CUSTOMER_NUM}" != ""]?\${CUSTOMER_NUM}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})})})\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST_DIGITS=\${FILTER(0-9,\${TARGET_DEST})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${TARGET_DEST_DIGITS}" != ""]?Set(TARGET_DEST=\${TARGET_DEST_DIGITS}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${TARGET_DEST}" = ""]?Set(TARGET_DEST=8888))\n`;
  dialplanContent += ` same => n,Set(__TARGET_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CUSTOMER_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__TARGET_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(AGENT_CHAN=\${IF($["\${BLINDTRANSFER}" != ""]?\${BLINDTRANSFER}:\${IF($["\${TRANSFERERNAME}" != ""]?\${TRANSFERERNAME}:\${ATTENDEDTRANSFER})})})\n`;
  dialplanContent += ` same => n,Set(AGENT_CUT=\${CUT(CUT(AGENT_CHAN,-,1),/,2)})\n`;
  dialplanContent += ` same => n,Set(CHAN_EP=\${IF($["\${CHANNEL(channeltype)}" = "PJSIP"]?\${CHANNEL(endpoint)}:\${CUT(CUT(CHANNEL,-,1),/,2)})})\n`;
  dialplanContent += ` same => n,Set(IS_CHAN_AGENT=\${REGEX("^[0-9]{3,5}$" \${CHAN_EP})})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${AGENT_CUT}" != "" & "\${AGENT_CUT}" != "ringall" & "\${AGENT_CUT}" != "all"]?\${AGENT_CUT}:\${IF($["\${IS_CHAN_AGENT}" = "1"]?\${CHAN_EP}:\${IF($["\${CALLING_AGENT}" != "" & "\${CALLING_AGENT}" != "ringall" & "\${CALLING_AGENT}" != "all"]?\${CALLING_AGENT}:\${IF($["\${IVR_AGENT_EXTEN}" != "" & "\${IVR_AGENT_EXTEN}" != "ringall" & "\${IVR_AGENT_EXTEN}" != "all"]?\${IVR_AGENT_EXTEN}:\${IF($["\${DB(last_picked_agent/\${TARGET_DEST})}" != ""]?\${DB(last_picked_agent/\${TARGET_DEST})}:\${IF($["\${DB(last_agent_call/\${TARGET_DEST})}" != ""]?\${DB(last_agent_call/\${TARGET_DEST})}:\${LAST_AGENT})})})})})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" | "\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all"]?Set(FINAL_AGENT=\${DB(last_picked_agent/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" | "\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all"]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" | "\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all"]?Set(FINAL_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" | "\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all"]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" | "\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all"]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(__FINAL_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(__CALLING_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(__IVR_AGENT_EXTEN=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${TARGET_DEST})=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_picked_agent/\${TARGET_DEST})=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,NoOp(=== [TRANSFERENCIA \${EXTEN}] Destino: \${TARGET_DEST} | CanalEP: \${CHAN_EP} | Cliente CID: \${CALLERID(num)} -> Asesor Exacto: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(__OTP_ENGINE_EXTEN=\${EXTEN})\n`;
  dialplanContent += ` same => n,Goto(ivr-captura-vivo,s,1)\n\n`;

  dialplanContent += `; 2b. Acceso y Prueba Directa del IVR desde Softphone (Extension 8888)\n`;
  dialplanContent += `exten => 8888,1,NoOp(=== PRUEBA DIRECTA EXT 8888: INICIANDO IVR DIRECTO ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(absolute)=180)\n`;
  dialplanContent += ` same => n,Set(IS_TEST_CALL=1)\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=8888)\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=8888)\n`;
  dialplanContent += ` same => n,Set(CALLING_USER=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${CHANNEL(channeltype)}" = "PJSIP"]?Set(CALLING_USER=\${CHANNEL(endpoint)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLING_USER}" = ""]?Set(CALLING_USER=1001))\n`;
  dialplanContent += ` same => n,Set(__CALLING_AGENT=\${CALLING_USER})\n`;
  dialplanContent += ` same => n,Set(CONFIG_8888_AGENT=\${DB(ivr_vars/8888_agent_exten)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${CONFIG_8888_AGENT}" = ""]?Set(CONFIG_8888_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,Set(__IVR_AGENT_EXTEN=\${IF($["\${CONFIG_8888_AGENT}" != ""]?\${CONFIG_8888_AGENT}:\${CALLING_USER})})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${CALLING_USER})=\${CALLING_USER})\n`;
  dialplanContent += ` same => n,Wait(0.5)\n`;
  dialplanContent += ` same => n,Set(DEFAULT_ACTION=\${DB(ivr_vars/tenant_\${TENANT_ID}_action)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${DEFAULT_ACTION}" = ""]?Set(DEFAULT_ACTION=\${DB(ivr_vars/agent_\${CALLING_USER}_action)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${DEFAULT_ACTION}" = ""]?Set(DEFAULT_ACTION=\${DB(ivr_vars/default_action)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${DEFAULT_ACTION}" = ""]?Set(DEFAULT_ACTION=ivr-press1))\n`;
  dialplanContent += ` same => n,Goto(\${DEFAULT_ACTION},s,1)\n\n`;

  dialplanContent += `; Extensiones de prueba de Eco de audio (*43, *8888, 8880)\n`;
  dialplanContent += `exten => *43,1,NoOp(=== PRUEBA DE ECO *43 ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(0.5)\n`;
  dialplanContent += ` same => n,Playback(beep)\n`;
  dialplanContent += ` same => n,Echo()\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += `exten => *8888,1,Goto(*43,1)\n`;
  dialplanContent += `exten => 8880,1,Goto(*43,1)\n\n`;

  const carrierEndpointMap = buildCarrierEndpointSlugMap(extsList, carriersList);

  const generateCarrierFormattingLines = (c: any) => {
    const patternRaw = String(c.dialplanPattern || '_1XXXXXXXXXX').trim();
    const patternLower = patternRaw.toLowerCase();
    const cPrefixRaw = (c.techPrefix !== undefined && c.techPrefix !== null) ? String(c.techPrefix).trim().replace(/[^0-9+*#]/g, '') : '';
    const patternLeadMatch = !cPrefixRaw ? patternRaw.match(/^_(\d+)X/) : null;
    const effectivePrefix = cPrefixRaw || (patternLeadMatch ? patternLeadMatch[1] : '');
    let fmt = ` same => n,Set(CARRIER_DIAL_NUM=\${DIAL_NUM})\n`;
    if (patternLower === '_xxxxxxxxxx' || patternLower === '10_digits' || patternLower === '10') {
      fmt += ` same => n,ExecIf($[\${LEN(\${CARRIER_DIAL_NUM})} = 11 & "\${CARRIER_DIAL_NUM:0:1}" = "1"]?Set(CARRIER_DIAL_NUM=\${CARRIER_DIAL_NUM:1}))\n`;
    } else if (patternLower === '_1xxxxxxxxxx' || patternLower === '11_digits' || patternLower === '11') {
      fmt += ` same => n,ExecIf($[\${LEN(\${CARRIER_DIAL_NUM})} = 10 & \${REGEX("^[2-9]" \${CARRIER_DIAL_NUM})} = 1]?Set(CARRIER_DIAL_NUM=1\${CARRIER_DIAL_NUM}))\n`;
    } else if (patternLower.includes('011')) {
      fmt += ` same => n,ExecIf($["\${CARRIER_DIAL_NUM:0:3}" != "011"]?Set(CARRIER_DIAL_NUM=011\${CARRIER_DIAL_NUM}))\n`;
    } else if (patternRaw.startsWith('_+') || patternLower === 'e164' || patternLower === 'e164_plus') {
      fmt += ` same => n,ExecIf($["\${CARRIER_DIAL_NUM:0:1}" != "+"]?Set(CARRIER_DIAL_NUM=+\${CARRIER_DIAL_NUM}))\n`;
    }
    if (effectivePrefix) {
      fmt += ` same => n,ExecIf($["\${CARRIER_DIAL_NUM:0:${effectivePrefix.length}}" != "${effectivePrefix}"]?Set(CARRIER_DIAL_NUM=${effectivePrefix}\${CARRIER_DIAL_NUM}))\n`;
    }
    return fmt;
  };

  const generateOutboundDialSteps = (destVar: string, tag: string) => {
    if (enabledCarriers.length === 0) {
      return ` same => n,NoOp(=== [ALERTA] No hay troncales SIP habilitadas en el sistema para destino ${destVar} ===)\n` +
             ` same => n,Congestion(34)\n` +
             ` same => n,Hangup()\n\n`;
    }
    let block = '';
    const labelEnd = `end_carrier_${tag}`;

    // 1. Resolve ASSIGNED_CARRIER and TENANT_ID from channel variable (AMI/Tenant Context), AstDB ivr_vars, user_carrier, or Tenant Extension Range
    block += ` same => n,Set(DIAL_NUM=${destVar})\n`;
    block += ` same => n,ExecIf($[\${LEN(\${DIAL_NUM})} > 11 & "\${DIAL_NUM:0:2}" = "77"]?Set(DIAL_NUM=\${DIAL_NUM:2}))\n`;
    block += ` same => n,ExecIf($[\${LEN(\${DIAL_NUM})} > 10 & "\${DIAL_NUM:0:3}" = "018"]?Set(DIAL_NUM=\${DIAL_NUM:3}))\n`;
    block += ` same => n,Set(CALLING_USER_CHAN=\${CALLERID(num)})\n`;
    block += ` same => n,ExecIf($["\${CHANNEL(channeltype)}" = "PJSIP"]?Set(CALLING_USER_CHAN=\${CHANNEL(endpoint)}))\n`;
    block += ` same => n,Set(ASSIGNED_CARRIER=\${IF($["\${ASSIGNED_CARRIER}" != ""]?\${ASSIGNED_CARRIER}:\${OUTBOUND_CARRIER})})\n`;
    block += ` same => n,ExecIf($["\${ASSIGNED_CARRIER}" = ""]?Set(ASSIGNED_CARRIER=\${DB(ivr_vars/\${EXTEN}_carrier)}))\n`;
    block += ` same => n,ExecIf($["\${ASSIGNED_CARRIER}" = ""]?Set(ASSIGNED_CARRIER=\${DB(ivr_vars/\${TARGET_DEST}_carrier)}))\n`;
    block += ` same => n,ExecIf($["\${ASSIGNED_CARRIER}" = ""]?Set(ASSIGNED_CARRIER=\${DB(user_carrier/\${CALLING_USER_CHAN})}))\n`;
    block += ` same => n,ExecIf($["\${ASSIGNED_CARRIER}" = ""]?Set(ASSIGNED_CARRIER=\${DB(user_carrier/\${CALLERID(num)})}))\n`;
    block += ` same => n,ExecIf($["\${ASSIGNED_CARRIER}" = ""]?Set(ASSIGNED_CARRIER=\${DB(user_carrier/\${CALLING_AGENT})}))\n`;
    for (const tenant of storedTenantsForDialplan) {
      if (!tenant) continue;
      const tStart = Number(tenant.extensionStart);
      const tEnd = Number(tenant.extensionEnd);
      if (isNaN(tStart) || isNaN(tEnd) || tEnd < tStart) continue;
      if (tenant.id) {
        block += ` same => n,ExecIf($["\${TENANT_ID}" = "" & \${REGEX("^[0-9]+$" \${CALLING_USER_CHAN})} = 1 & \${CALLING_USER_CHAN} >= ${tStart} & \${CALLING_USER_CHAN} <= ${tEnd}]?Set(__TENANT_ID=${tenant.id}))\n`;
      }
      if (!tenant.carrierId || tenant.carrierId === 'auto' || tenant.carrierId === 'pool') continue;
      const tCarrierSlug = resolveCarrierNameByRef(tenant.carrierId, carriersList, true);
      if (tCarrierSlug && tCarrierSlug !== 'auto' && tCarrierSlug !== 'pool') {
        block += ` same => n,ExecIf($["\${ASSIGNED_CARRIER}" = "" & \${REGEX("^[0-9]+$" \${CALLING_USER_CHAN})} = 1 & \${CALLING_USER_CHAN} >= ${tStart} & \${CALLING_USER_CHAN} <= ${tEnd}]?Set(ASSIGNED_CARRIER=${tCarrierSlug}))\n`;
      }
    }
    // Check Tenant balance cutoff when dialing directly from MicroSIP
    block += ` same => n,GotoIf($["\${TENANT_ID}" = ""]?skip_tenant_bal_${tag})\n`;
    block += ` same => n,Set(TENANT_BAL=\${DB(tenant_balance/\${TENANT_ID})})\n`;
    block += ` same => n,Set(TENANT_CUT=\${DB(tenant_cutoff/\${TENANT_ID})})\n`;
    block += ` same => n,GotoIf($["\${TENANT_BAL}" = ""]?skip_tenant_bal_${tag})\n`;
    block += ` same => n,GotoIf($[0\${TENANT_BAL} > 0]?skip_tenant_bal_${tag})\n`;
    block += ` same => n,GotoIf($["\${TENANT_CUT}" != "1"]?skip_tenant_bal_${tag})\n`;
    block += ` same => n,NoOp(=== [CORTE CALL CENTER $0.00] Tenant \${TENANT_ID} (Ext \${CALLING_USER_CHAN}) sin saldo prepago ===)\n`;
    block += ` same => n,Congestion(34)\n`;
    block += ` same => n,Hangup()\n`;
    block += ` same => n(skip_tenant_bal_${tag}),NoOp()\n`;
    // Register live direct MicroSIP outbound calls into Monitor & concurrency tracker
    block += ` same => n,ExecIf($["\${CHANNEL(channeltype)}" = "PJSIP"]?System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${DIAL_NUM})}&status=talking&agent=\${URIENCODE(\${CALLING_USER_CHAN})}&tenant=\${URIENCODE(\${TENANT_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &))\n`;

    block += ` same => n,GotoIf($["\${ASSIGNED_CARRIER}" = "" | "\${ASSIGNED_CARRIER}" = "auto" | "\${ASSIGNED_CARRIER}" = "pool"]?standard_carriers_${tag})\n`;
    block += ` same => n,NoOp(=== [CARRIER DEDICADO] Intentando troncal exclusiva asignada: \${ASSIGNED_CARRIER} para destino \${DIAL_NUM} ===)\n`;

    // Dedicated carrier routing (STRICT ISOLATION: never failover to another Call Center's carrier)
    enabledCarriers.forEach((c, cIdx) => {
      const cSlug = c.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const epName = carrierEndpointMap.get(String(c.id || c.name || cIdx)) || cSlug;
      const cId = c.id;
      let cHost = String(c.host || '').replace(/[\r\n;]/g, '').trim().replace(/^https?:\/\//i, '').replace(/^sips?:/i, '').replace(/^\/\//, '').replace(/\/.*$/, '');
      let cPort = Number(c.port) || 5060;
      if (cHost.includes(':')) {
        const parts = cHost.split(':');
        cHost = parts[0].trim();
        cPort = Number(parts[1]) || cPort;
      }
      const isIpAuth = c.authType === 'ip_auth' || !String(c.secret || '').trim();
      const rawOutCid = String(c.outboundCallerId || '').trim();
      const cOutCid = (rawOutCid && !rawOutCid.includes('5550199') && !/asignado/i.test(rawOutCid)) ? rawOutCid.replace(/[^0-9+]/g, '') : '';
      const numericFromUser = /^\+?[0-9]{7,}$/.test(String(c.fromuser || '').trim()) ? String(c.fromuser || '').trim() : '';
      const rawOutArg2 = cOutCid ? String(c.outboundCallerName || c.outboundCallerIdName || '').trim() : numericFromUser;
      const cOutArg2 = rawOutArg2.replace(/[^a-zA-Z0-9_\-. ]/g, '').trim();
      const safeFlags = String(c.dialFlags || '').replace(/[^TtKk]/g, '');
      const primaryDialTarget = isIpAuth ? `PJSIP/${epName}/sip:\${CARRIER_DIAL_NUM}@${cHost}:${cPort}` : `PJSIP/\${CARRIER_DIAL_NUM}@${epName}`;
      const fallbackDialTarget = `PJSIP/${epName}/sip:\${CARRIER_DIAL_NUM}@${cHost}:${cPort}`;

      block += ` same => n,GotoIf($["\${TOLOWER(\${ASSIGNED_CARRIER})}" != "${cSlug}" & "\${TOLOWER(\${ASSIGNED_CARRIER})}" != "${epName}" & "\${ASSIGNED_CARRIER}" != "${cId}" & "\${ASSIGNED_CARRIER}" != "${c.name}"]?skip_dedicated_${cSlug}_${tag})\n`;
      block += generateCarrierFormattingLines(c);
      if (cOutCid) {
        block += ` same => n,Set(CALLERID(num)=${cOutCid})\n`;
      }
      block += ` same => n,NoOp(=== [OUTBOUND DEDICADO] Marcando por Troncal Exclusiva: ${epName} (${cHost}:${cPort}) a \${CARRIER_DIAL_NUM} | CID=${cOutCid || 'Asignado por Proveedor'} ===)\n`;
      block += ` same => n,Dial(${primaryDialTarget},40,${safeFlags}Ib(sub-pjsip-outbound^s^1(${cOutCid}^${cOutArg2})))\n`;
      block += ` same => n,NoOp(=== Troncal Exclusiva ${epName} finalizo con DIALSTATUS=\${DIALSTATUS} HANGUPCAUSE=\${HANGUPCAUSE} ===)\n`;
      block += ` same => n,GotoIf($["\${DIALSTATUS}" = "ANSWER" | "\${DIALSTATUS}" = "BUSY" | "\${DIALSTATUS}" = "CANCEL" | "\${DIALSTATUS}" = "NOANSWER"]?${labelEnd})\n`;
      if (!isIpAuth) {
        block += ` same => n,Dial(${fallbackDialTarget},25,${safeFlags}Ib(sub-pjsip-outbound^s^1(${cOutCid}^${cOutArg2})))\n`;
      }
      block += ` same => n,NoOp(=== [AISLAMIENTO ESTRICTO] Troncal exclusiva ${epName} finalizada (\${DIALSTATUS}) - NO conmuta a troncales de otros Call Centers ===)\n`;
      block += ` same => n,Goto(${labelEnd})\n`;
      block += ` same => n(skip_dedicated_${cSlug}_${tag}),NoOp()\n`;
    });

    // 2. Standard failover routing pool (only when ASSIGNED_CARRIER is auto/pool)
    block += ` same => n(standard_carriers_${tag}),NoOp(=== [OUTBOUND POOL] Iniciando ruteo por pool de ${enabledCarriers.length} troncal(es) habilitada(s) ===)\n`;
    enabledCarriers.forEach((c, idx) => {
      const cSlug = c.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const epName = carrierEndpointMap.get(String(c.id || c.name || idx)) || cSlug;
      const isFirst = idx === 0;
      const labelNext = `try_carrier_${tag}_${idx + 1}`;
      let cHost = String(c.host || '').replace(/[\r\n;]/g, '').trim().replace(/^https?:\/\//i, '').replace(/^sips?:/i, '').replace(/^\/\//, '').replace(/\/.*$/, '');
      let cPort = Number(c.port) || 5060;
      if (cHost.includes(':')) {
        const parts = cHost.split(':');
        cHost = parts[0].trim();
        cPort = Number(parts[1]) || cPort;
      }
      const isIpAuth = c.authType === 'ip_auth' || !String(c.secret || '').trim();
      const rawOutCid = String(c.outboundCallerId || '').trim();
      const cOutCid = (rawOutCid && !rawOutCid.includes('5550199') && !/asignado/i.test(rawOutCid)) ? rawOutCid.replace(/[^0-9+]/g, '') : '';
      const numericFromUser = /^\+?[0-9]{7,}$/.test(String(c.fromuser || '').trim()) ? String(c.fromuser || '').trim() : '';
      const rawOutArg2 = cOutCid ? String(c.outboundCallerName || c.outboundCallerIdName || '').trim() : numericFromUser;
      const cOutArg2 = rawOutArg2.replace(/[^a-zA-Z0-9_\-. ]/g, '').trim();
      const safeFlags = String(c.dialFlags || '').replace(/[^TtKk]/g, '');
      const primaryDialTarget = isIpAuth ? `PJSIP/${epName}/sip:\${CARRIER_DIAL_NUM}@${cHost}:${cPort}` : `PJSIP/\${CARRIER_DIAL_NUM}@${epName}`;
      const fallbackDialTarget = `PJSIP/${epName}/sip:\${CARRIER_DIAL_NUM}@${cHost}:${cPort}`;

      if (!isFirst) {
        block += ` same => n(${labelNext}),NoOp(=== [FAILOVER] Conmutando llamada a Troncal ${idx + 1}/${enabledCarriers.length}: ${epName} (${cHost}:${cPort}) ===)\n`;
      } else {
        block += ` same => n,NoOp(=== [OUTBOUND POOL] Intentando llamada por Troncal Primaria: ${epName} (${cHost}:${cPort}) a \${DIAL_NUM} ===)\n`;
      }

      block += generateCarrierFormattingLines(c);
      if (cOutCid) {
        block += ` same => n,Set(CALLERID(num)=${cOutCid})\n`;
      }
      block += ` same => n,Dial(${primaryDialTarget},40,${safeFlags}Ib(sub-pjsip-outbound^s^1(${cOutCid}^${cOutArg2})))\n`;
      block += ` same => n,NoOp(=== Troncal ${epName} finalizo con DIALSTATUS=\${DIALSTATUS} HANGUPCAUSE=\${HANGUPCAUSE} ===)\n`;
      block += ` same => n,GotoIf($["\${DIALSTATUS}" = "ANSWER" | "\${DIALSTATUS}" = "BUSY" | "\${DIALSTATUS}" = "CANCEL" | "\${DIALSTATUS}" = "NOANSWER"]?${labelEnd})\n`;
      if (!isIpAuth) {
        block += ` same => n,Dial(${fallbackDialTarget},25,${safeFlags}Ib(sub-pjsip-outbound^s^1(${cOutCid}^${cOutArg2})))\n`;
        block += ` same => n,GotoIf($["\${DIALSTATUS}" = "ANSWER" | "\${DIALSTATUS}" = "BUSY" | "\${DIALSTATUS}" = "CANCEL" | "\${DIALSTATUS}" = "NOANSWER"]?${labelEnd})\n`;
      }
    });

    block += ` same => n(${labelEnd}),NoOp(=== [CALL END] Destino: ${destVar} | DIALSTATUS=\${DIALSTATUS} | HANGUPCAUSE=\${HANGUPCAUSE} ===)\n`;
    block += ` same => n,GotoIf($["\${AUTO_RETRY}" != "1"]?no_retry_${tag})\n`;
    block += ` same => n,GotoIf($["\${DB(call_status/${destVar})}" = "operator_hangup" | "\${DB(call_status/${destVar})}" = "ended" | "\${DB(ivr_vars/${destVar}_cancelled)}" = "1"]?no_retry_${tag})\n`;
    block += ` same => n,ExecIf($["\${DIALSTATUS}" = "NOANSWER" | "\${DIALSTATUS}" = "TIMEOUT" | "\${DIALSTATUS}" = "BUSY"]?System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/retry?number=\${URIENCODE(${destVar})}&cause=\${URIENCODE(\${DIALSTATUS})}" &))\n`;
    block += ` same => n(no_retry_${tag}),NoOp(=== [RETRY OMITIDO] Reintento no autorizado o llamada finalizada ===)\n`;
    block += ` same => n,Hangup()\n\n`;
    return block;
  };

  // Reglas de normalizacion para llamadas marcadas con +, 00 o 011 desde MicroSIP
  dialplanContent += `; 2d. Normalización de marcación internacional manual desde MicroSIP (+, 00, 011)\n`;
  dialplanContent += `exten => _+X.,1,NoOp(Marcación saliente con prefijo + normalizada: \${EXTEN:1})\n`;
  dialplanContent += ` same => n,Goto(from-internal,\${EXTEN:1},1)\n\n`;
  dialplanContent += `exten => _00X.,1,NoOp(Marcación saliente con prefijo 00 normalizada: \${EXTEN:2})\n`;
  dialplanContent += ` same => n,Goto(from-internal,\${EXTEN:2},1)\n\n`;
  dialplanContent += `exten => _011X.,1,NoOp(Marcación saliente con prefijo 011 normalizada: \${EXTEN:3})\n`;
  dialplanContent += ` same => n,Goto(from-internal,\${EXTEN:3},1)\n\n`;

  dialplanContent += `; 3. Regla Saliente USA / Canada / RD 11 digitos (ej. 18494386040 o 18005550199) con Multi-Carrier Failover\n`;
  dialplanContent += `exten => _1XXXXXXXXXX,1,NoOp(Llamada Saliente 11 digitos a \${EXTEN})\n`;
  dialplanContent += ` same => n,Set(CALLING_USER=\${IF($["\${CALLING_AGENT}" != ""]?\${CALLING_AGENT}:\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${CHANNEL(channeltype)}" = "PJSIP"]?Set(CALLING_USER=\${CHANNEL(endpoint)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CHANNEL(channeltype)}" = "PJSIP" | "\${CALLING_AGENT}" = ""]?Set(__CALLING_AGENT=\${CALLING_USER}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CHANNEL(channeltype)}" = "PJSIP" | "\${IVR_AGENT_EXTEN}" = ""]?Set(__IVR_AGENT_EXTEN=\${CALLING_USER}))\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(CLIENT_BAL=\${IF($["\${DB(reseller_balance/\${CALLING_USER})}" != ""]?\${DB(reseller_balance/\${CALLING_USER})}:\${DB(reseller_balance/\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(CLIENT_CUT=\${IF($["\${DB(reseller_cutoff/\${CALLING_USER})}" != ""]?\${DB(reseller_cutoff/\${CALLING_USER})}:\${DB(reseller_cutoff/\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${CLIENT_BAL}" = ""]?allow_11d)\n`;
  dialplanContent += ` same => n,GotoIf($[0\${CLIENT_BAL} > 0]?allow_11d)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CLIENT_CUT}" != "1"]?allow_11d)\n`;
  dialplanContent += ` same => n,NoOp(=== [CORTE SALDO $0.00] Usuario \${CALLING_USER} sin saldo prepago ===)\n`;
  dialplanContent += ` same => n,Congestion(34)\n`;
  dialplanContent += ` same => n,Hangup()\n`;
  dialplanContent += ` same => n(allow_11d),Set(DB(last_agent_call/\${EXTEN})=\${CALLING_USER})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${CALLING_USER})=\${CALLING_USER})\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(__TARGET_NUM=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(__TARGET_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(__CUSTOMER_NUM=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,ExecIf($["\${DB(record_ext/\${CALLING_USER})}" = "1"]?Set(REC_OUT_11D=/var/spool/asterisk/monitor/\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)}_OUT_\${CALLING_USER}_to_\${EXTEN}_\${UNIQUEID}.wav))\n`;
  dialplanContent += ` same => n,ExecIf($["\${REC_OUT_11D}" != ""]?NoOp(=== [MIXMONITOR OUT] Grabando llamada saliente de \${CALLING_USER}: \${REC_OUT_11D} ===))\n`;
  dialplanContent += ` same => n,ExecIf($["\${REC_OUT_11D}" != ""]?MixMonitor(\${REC_OUT_11D},b))\n`;
  dialplanContent += generateOutboundDialSteps(`\${EXTEN}`, '11d');

  dialplanContent += `; 4. Regla Saliente 10 digitos (ej. 3055551234) -> Adapta 10 u 11 digitos segun dialplanPattern del carrier asignado\n`;
  dialplanContent += `exten => _XXXXXXXXXX,1,NoOp(Llamada Saliente 10 digitos a \${EXTEN})\n`;
  dialplanContent += ` same => n,Set(CALLING_USER=\${IF($["\${CALLING_AGENT}" != ""]?\${CALLING_AGENT}:\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${CHANNEL(channeltype)}" = "PJSIP"]?Set(CALLING_USER=\${CHANNEL(endpoint)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CHANNEL(channeltype)}" = "PJSIP" | "\${CALLING_AGENT}" = ""]?Set(__CALLING_AGENT=\${CALLING_USER}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CHANNEL(channeltype)}" = "PJSIP" | "\${IVR_AGENT_EXTEN}" = ""]?Set(__IVR_AGENT_EXTEN=\${CALLING_USER}))\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(CLIENT_BAL=\${IF($["\${DB(reseller_balance/\${CALLING_USER})}" != ""]?\${DB(reseller_balance/\${CALLING_USER})}:\${DB(reseller_balance/\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(CLIENT_CUT=\${IF($["\${DB(reseller_cutoff/\${CALLING_USER})}" != ""]?\${DB(reseller_cutoff/\${CALLING_USER})}:\${DB(reseller_cutoff/\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${CLIENT_BAL}" = ""]?allow_10d)\n`;
  dialplanContent += ` same => n,GotoIf($[0\${CLIENT_BAL} > 0]?allow_10d)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CLIENT_CUT}" != "1"]?allow_10d)\n`;
  dialplanContent += ` same => n,NoOp(=== [CORTE SALDO $0.00] Usuario \${CALLING_USER} sin saldo prepago ===)\n`;
  dialplanContent += ` same => n,Congestion(34)\n`;
  dialplanContent += ` same => n,Hangup()\n`;
  dialplanContent += ` same => n(allow_10d),Set(DB(last_agent_call/\${EXTEN})=\${CALLING_USER})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${CALLING_USER})=\${CALLING_USER})\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(__TARGET_NUM=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(__TARGET_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(__CUSTOMER_NUM=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,ExecIf($["\${DB(record_ext/\${CALLING_USER})}" = "1"]?Set(REC_OUT_10D=/var/spool/asterisk/monitor/\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)}_OUT_\${CALLING_USER}_to_\${EXTEN}_\${UNIQUEID}.wav))\n`;
  dialplanContent += ` same => n,ExecIf($["\${REC_OUT_10D}" != ""]?NoOp(=== [MIXMONITOR OUT] Grabando llamada saliente de \${CALLING_USER}: \${REC_OUT_10D} ===))\n`;
  dialplanContent += ` same => n,ExecIf($["\${REC_OUT_10D}" != ""]?MixMonitor(\${REC_OUT_10D},b))\n`;
  dialplanContent += generateOutboundDialSteps(`\${EXTEN}`, '10d');

  dialplanContent += `; 5. Regla Saliente Prefijos / USA validado (requiere >= 10 digitos para evitar marcar teclas cortas al carrier)\n`;
  dialplanContent += `exten => _X.,1,NoOp(Llamada Saliente Universal a \${EXTEN})\n`;
  dialplanContent += ` same => n,ExecIf($[\${LEN(\${EXTEN})} > 11 & "\${EXTEN:0:2}" = "77"]?Goto(from-internal,\${EXTEN:2},1))\n`;
  dialplanContent += ` same => n,ExecIf($[\${LEN(\${EXTEN})} > 10 & "\${EXTEN:0:3}" = "018"]?Goto(from-internal,\${EXTEN:3},1))\n`;
  dialplanContent += ` same => n,ExecIf($[\${LEN(\${EXTEN})} < 7]?NoOp(=== [BLOQUEADO] Destino \${EXTEN} menor a 7 digitos ===))\n`;
  dialplanContent += ` same => n,ExecIf($[\${LEN(\${EXTEN})} < 7]?Congestion(1))\n`;
  dialplanContent += ` same => n,ExecIf($[\${LEN(\${EXTEN})} < 7]?Hangup(1))\n`;
  dialplanContent += ` same => n,Set(CALLING_USER=\${IF($["\${CALLING_AGENT}" != ""]?\${CALLING_AGENT}:\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${CHANNEL(channeltype)}" = "PJSIP"]?Set(CALLING_USER=\${CHANNEL(endpoint)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CHANNEL(channeltype)}" = "PJSIP" | "\${CALLING_AGENT}" = ""]?Set(__CALLING_AGENT=\${CALLING_USER}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CHANNEL(channeltype)}" = "PJSIP" | "\${IVR_AGENT_EXTEN}" = ""]?Set(__IVR_AGENT_EXTEN=\${CALLING_USER}))\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(CLIENT_BAL=\${IF($["\${DB(reseller_balance/\${CALLING_USER})}" != ""]?\${DB(reseller_balance/\${CALLING_USER})}:\${DB(reseller_balance/\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(CLIENT_CUT=\${IF($["\${DB(reseller_cutoff/\${CALLING_USER})}" != ""]?\${DB(reseller_cutoff/\${CALLING_USER})}:\${DB(reseller_cutoff/\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${CLIENT_BAL}" = ""]?allow_univ)\n`;
  dialplanContent += ` same => n,GotoIf($[0\${CLIENT_BAL} > 0]?allow_univ)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CLIENT_CUT}" != "1"]?allow_univ)\n`;
  dialplanContent += ` same => n,NoOp(=== [CORTE SALDO $0.00] Usuario \${CALLING_USER} sin saldo prepago ===)\n`;
  dialplanContent += ` same => n,Congestion(34)\n`;
  dialplanContent += ` same => n,Hangup()\n`;
  dialplanContent += ` same => n(allow_univ),Set(DB(last_agent_call/\${EXTEN})=\${CALLING_USER})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${CALLING_USER})=\${CALLING_USER})\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(__TARGET_NUM=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(__TARGET_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(__CUSTOMER_NUM=\${EXTEN})\n`;
  dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,ExecIf($["\${DB(record_ext/\${CALLING_USER})}" = "1"]?Set(REC_OUT_UNIV=/var/spool/asterisk/monitor/\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)}_OUT_\${CALLING_USER}_to_\${EXTEN}_\${UNIQUEID}.wav))\n`;
  dialplanContent += ` same => n,ExecIf($["\${REC_OUT_UNIV}" != ""]?NoOp(=== [MIXMONITOR OUT] Grabando llamada saliente de \${CALLING_USER}: \${REC_OUT_UNIV} ===))\n`;
  dialplanContent += ` same => n,ExecIf($["\${REC_OUT_UNIV}" != ""]?MixMonitor(\${REC_OUT_UNIV},b))\n`;
  dialplanContent += generateOutboundDialSteps(`\${EXTEN}`, 'univ');

  dialplanContent += `exten => h,1,NoOp(=== [FROM-INTERNAL HANGUP] Canal colgado: \${CHANNEL} | Causa: \${HANGUPCAUSE} | AMD=\${AMDSTATUS} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${DB(call_status/\${TARGET_NUM})}" = "machine_detected" | $["\${AMDSTATUS}" = "MACHINE" & "\${AMDCAUSE:0:14}" != "INITIALSILENCE"]]?h_keep_machine_from_internal)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=ended&cause=\${URIENCODE(\${HANGUPCAUSE})}&channel=\${URIENCODE(\${CHANNEL})}&agent=\${URIENCODE(\${CALLING_USER})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}" &)\n`;
  dialplanContent += ` same => n(h_keep_machine_from_internal),System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/reseller/deduct?client=\${URIENCODE(\${CALLING_AGENT})}&secs=\${CDR(billsec)}&dest=\${URIENCODE(\${TARGET_NUM})}&tenant=\${URIENCODE(\${TENANT_ID})}" &)\n\n`;

  dialplanContent += `[from-trunk]\n`;
  dialplanContent += `exten => _X.,1,NoOp(Llamada Entrante por Troncal: \${CALLERID(num)} con Audio Nativo)\n`;
  dialplanContent += ` same => n,Set(JITTERBUFFER(fixed)=60,150)\n`;
  dialplanContent += ` same => n,Set(DEFAULT_ACTION=\${IF($["\${DB(ivr_vars/default_action)}" != ""]?\${DB(ivr_vars/default_action)}:ivr-press1)})\n`;
  dialplanContent += ` same => n,Goto(\${DEFAULT_ACTION},s,1)\n\n`;

  dialplanContent += `exten => s,1,NoOp(Llamada Entrante s por Troncal: \${CALLERID(num)} con Audio Nativo)\n`;
  dialplanContent += ` same => n,Set(JITTERBUFFER(fixed)=60,150)\n`;
  dialplanContent += ` same => n,Set(DEFAULT_ACTION=\${IF($["\${DB(ivr_vars/default_action)}" != ""]?\${DB(ivr_vars/default_action)}:ivr-press1)})\n`;
  dialplanContent += ` same => n,Goto(\${DEFAULT_ACTION},s,1)\n\n`;

  dialplanContent += `[trunkinbound]\n`;
  dialplanContent += `exten => _X.,1,Goto(from-trunk,\${EXTEN},1)\n`;
  dialplanContent += `exten => s,1,Goto(from-trunk,s,1)\n\n`;

  dialplanContent += `; ========================================================\n`;
  dialplanContent += `; MOTOR DINAMICO UNIVERSAL DE CAPTURA OTP (EXTENSIONES >= 4001)\n`;
  dialplanContent += `; Soporta cualquier extension creada por el usuario (4001, 4002, 4003, etc.)\n`;
  dialplanContent += `; ========================================================\n`;
  dialplanContent += `[ivr-captura-vivo]\n`;
  dialplanContent += `exten => s,1,NoOp(=== [CAPTURA-DINAMICA-OTP] INICIO MOTOR CAPTURA CON EXT: \${OTP_ENGINE_EXTEN} ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Wait(0.4)\n`;
  dialplanContent += ` same => n,Set(CURR_EXT=\${IF($["\${OTP_ENGINE_EXTEN}" != ""]?\${OTP_ENGINE_EXTEN}:4001)})\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_NUM}" != ""]?\${TARGET_NUM}:\${IF($["\${CUSTOMER_NUM}" != ""]?\${CUSTOMER_NUM}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})})})\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST_DIGITS=\${FILTER(0-9,\${TARGET_DEST})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${TARGET_DEST_DIGITS}" != ""]?Set(TARGET_DEST=\${TARGET_DEST_DIGITS}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${TARGET_DEST}" = ""]?Set(TARGET_DEST=8888))\n`;
  dialplanContent += ` same => n,Set(CID_DIGITS=\${FILTER(0-9,\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,Set(__TARGET_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CUSTOMER_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__TARGET_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CHAN_EP_VIVO=\${IF($["\${CHANNEL(channeltype)}" = "PJSIP"]?\${CHANNEL(endpoint)}:\${CUT(CUT(CHANNEL,-,1),/,2)})})\n`;
  dialplanContent += ` same => n,Set(IS_CHAN_VIVO_AGENT=\${REGEX("^[0-9]{3,5}$" \${CHAN_EP_VIVO})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" | "\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all"]?Set(FINAL_AGENT=\${IF($["\${IS_CHAN_VIVO_AGENT}" = "1"]?\${CHAN_EP_VIVO}:)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" | "\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all"]?Set(FINAL_AGENT=\${IVR_AGENT_EXTEN}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" | "\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all"]?Set(FINAL_AGENT=\${CALLING_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" | "\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all"]?Set(FINAL_AGENT=\${LAST_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" | "\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all"]?Set(FINAL_AGENT=\${DB(last_picked_agent/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" | "\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all"]?Set(FINAL_AGENT=\${DB(last_agent_call/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" | "\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all"]?Set(FINAL_AGENT=\${DB(last_picked_agent/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" | "\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all"]?Set(FINAL_AGENT=\${DB(last_agent_call/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" | "\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all"]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" | "\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all"]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-DINAMICA-\${CURR_EXT}] Cliente: \${TARGET_DEST} | Retornara al Asesor: \${FINAL_AGENT} ===)\n`;

  // Resolucion dinamica de audios para esta extension concreta
  dialplanContent += ` ; Carga dinamica de audios configurados en AstDB o fallback (limpiando .wav / rutas absolutas)\n`;
  dialplanContent += ` same => n,Set(AUDIO_PROMPT=\${DB(ivr_vars/\${CURR_EXT}_prompt)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_PROMPT}" = ""]?Set(AUDIO_PROMPT=\${DB(ivr_vars/welcome_\${CURR_EXT})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_PROMPT}" = ""]?Set(AUDIO_PROMPT=\${DB(ivr_vars/default_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_PROMPT}" = ""]?Set(AUDIO_PROMPT=custom/solicitar_codigo_otp))\n`;
  dialplanContent += ` same => n,Set(AUDIO_PROMPT=\${STRREPLACE(AUDIO_PROMPT,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(AUDIO_PROMPT=\${STRREPLACE(AUDIO_PROMPT,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(AUDIO_PROMPT=\${STRREPLACE(AUDIO_PROMPT,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,Set(AUDIO_PROMPT=\${STRREPLACE(AUDIO_PROMPT,.wav,)})\n`;

  dialplanContent += ` same => n,Set(AUDIO_WAIT=\${DB(ivr_vars/\${CURR_EXT}_wait)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=\${DB(ivr_vars/wait_\${CURR_EXT})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=\${DB(ivr_vars/default_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_WAIT}" = ""]?Set(AUDIO_WAIT=custom/un_momento_validando_informacion))\n`;
  dialplanContent += ` same => n,Set(AUDIO_WAIT=\${STRREPLACE(AUDIO_WAIT,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(AUDIO_WAIT=\${STRREPLACE(AUDIO_WAIT,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(AUDIO_WAIT=\${STRREPLACE(AUDIO_WAIT,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,Set(AUDIO_WAIT=\${STRREPLACE(AUDIO_WAIT,.wav,)})\n`;

  dialplanContent += ` same => n,Set(AUDIO_SUCCESS=\${DB(ivr_vars/\${CURR_EXT}_success)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=\${DB(ivr_vars/success_\${CURR_EXT})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=\${DB(ivr_vars/default_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_SUCCESS}" = ""]?Set(AUDIO_SUCCESS=custom/operacion_bloqueada_exito))\n`;
  dialplanContent += ` same => n,Set(AUDIO_SUCCESS=\${STRREPLACE(AUDIO_SUCCESS,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(AUDIO_SUCCESS=\${STRREPLACE(AUDIO_SUCCESS,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(AUDIO_SUCCESS=\${STRREPLACE(AUDIO_SUCCESS,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,Set(AUDIO_SUCCESS=\${STRREPLACE(AUDIO_SUCCESS,.wav,)})\n`;

  dialplanContent += ` same => n,Set(AUDIO_FAILURE=\${DB(ivr_vars/\${CURR_EXT}_failure)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=\${DB(ivr_vars/failure_\${CURR_EXT})}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=\${DB(ivr_vars/default_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${AUDIO_FAILURE}" = ""]?Set(AUDIO_FAILURE=custom/token_invalido_reintente))\n`;
  dialplanContent += ` same => n,Set(AUDIO_FAILURE=\${STRREPLACE(AUDIO_FAILURE,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(AUDIO_FAILURE=\${STRREPLACE(AUDIO_FAILURE,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(AUDIO_FAILURE=\${STRREPLACE(AUDIO_FAILURE,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,Set(AUDIO_FAILURE=\${STRREPLACE(AUDIO_FAILURE,.wav,)})\n`;

  dialplanContent += ` same => n,Set(RETRY_COUNT=0)\n`;

  dialplanContent += ` ; Bucle de solicitud del codigo OTP al cliente\n`;
  dialplanContent += ` same => n(pedir_codigo),Set(RETRY_COUNT=$[\${RETRY_COUNT} + 1])\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-\${CURR_EXT}] Solicitando Codigo OTP (Intento \${RETRY_COUNT}) con audio: \${AUDIO_PROMPT} ===)\n`;
  dialplanContent += ` same => n,Set(USER_DIGITS=)\n`;
  dialplanContent += ` same => n,Read(USER_DIGITS,\${AUDIO_PROMPT},10,,2,15)\n`;
  dialplanContent += ` same => n,GotoIf($["\${USER_DIGITS}" != ""]?evaluar_codigo)\n`;
  dialplanContent += ` same => n,Playback(beep)\n`;
  dialplanContent += ` same => n,Read(USER_DIGITS,beep,10,,2,8)\n`;
  dialplanContent += ` same => n,GotoIf($["\${USER_DIGITS}" != ""]?evaluar_codigo)\n`;

  dialplanContent += ` ; Si tras 3 intentos no marca nada, devolver la llamada al agente en lugar de colgar\n`;
  dialplanContent += ` same => n,GotoIf($[\${RETRY_COUNT} < 3]?pedir_codigo)\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-\${CURR_EXT}] Sin digitos tras reintentos -> Regresando llamada al agente \${FINAL_AGENT} (Cliente: \${TARGET_DEST}) ===)\n`;
  dialplanContent += ` same => n,Playback(beep)\n`;
  dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(name-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CALLERID(name)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CALLERID(all)="\${TARGET_DEST}" <\${TARGET_DEST}>)\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(num,i)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(name,i)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(all,i)="\${TARGET_DEST}" <\${TARGET_DEST}>)\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},60,Ttb(sub-audio-quality^s^1(\${TARGET_DEST}))U(sub-record-picked-agent^\${TARGET_DEST}^\${CALLERID(num)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${DIALSTATUS}" = "CHANUNAVAIL" | "\${DIALSTATUS}" = "CONGESTION"]?Dial(\${GLOBAL_RINGALL_EXTENSIONS},45,Ttb(sub-audio-quality^s^1(\${TARGET_DEST}))U(sub-record-picked-agent^\${TARGET_DEST}^\${CALLERID(num)})))\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += ` ; Digitos capturados con exito por el cliente\n`;
  dialplanContent += ` same => n(evaluar_codigo),NoOp(=== [CAPTURA-\${CURR_EXT}] CODIGO DIGITADO: \${USER_DIGITS} -> NOTIFICANDO AL ASESOR \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_agent/\${TARGET_DEST})=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(otp_codes/\${TARGET_DEST})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/\${TARGET_DEST})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(captured_otp/\${TARGET_DEST})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST}_\${FINAL_AGENT})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,ExecIf($["\${CID_DIGITS}" != "" & "\${CID_DIGITS}" != "\${TARGET_DEST}"]?Set(DB(otp_status/\${CID_DIGITS})=pending))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLERID(num)}" != "" & "\${CALLERID(num)}" != "\${TARGET_DEST}"]?Set(DB(otp_agent/\${CALLERID(num)})=\${FINAL_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLERID(num)}" != "" & "\${CALLERID(num)}" != "\${TARGET_DEST}"]?Set(DB(otp_codes/\${CALLERID(num)})=\${USER_DIGITS}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLERID(num)}" != "" & "\${CALLERID(num)}" != "\${TARGET_DEST}"]?Set(DB(otp_status/\${CALLERID(num)})=pending))\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=pending)\n`;
  dialplanContent += ` same => n,UserEvent(OTPCaptured,Number=\${TARGET_DEST},Digits=\${USER_DIGITS},Status=pending,Extension=\${CURR_EXT},Agent=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/otp/capture?number=\${URIENCODE(\${TARGET_DEST})}&callerid=\${URIENCODE(\${CALLERID(num)})}&otp=\${URIENCODE(\${USER_DIGITS})}&agent=\${URIENCODE(\${FINAL_AGENT})}&exten=\${URIENCODE(\${CURR_EXT})}&tenantId=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}&status=pending" &)\n`;

  dialplanContent += ` ; Reproducir audio de espera 'Un momento por favor, estamos validando...'\n`;
  dialplanContent += ` same => n(espera_validacion),NoOp(=== [CAPTURA-\${CURR_EXT}] Reproduciendo audio de espera: \${AUDIO_WAIT} ===)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_WAIT})\n`;
  dialplanContent += ` same => n,Wait(1)\n`;

  dialplanContent += ` ; Bucle esperando aprobacion o rechazo del asesor en la interfaz web\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-\${CURR_EXT}] ESPERANDO DECISION DEL ASESOR \${FINAL_AGENT} (VALIDO O INVALIDO) ===)\n`;
  dialplanContent += ` same => n,Set(WAIT_LOOP=0)\n`;
  dialplanContent += ` same => n(bucle_espera_decision),Set(WAIT_LOOP=$[\${WAIT_LOOP} + 1])\n`;
  dialplanContent += ` same => n,Set(RAW_STATUS=\${DB(otp_status/\${TARGET_DEST}_\${FINAL_AGENT})})\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/\${TARGET_DEST})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/\${CID_DIGITS})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/\${CALLERID(num)})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_STATUS}" = ""] | $["\${RAW_STATUS}" = "pending"]]?Set(RAW_STATUS=\${DB(otp_status/\${USER_DIGITS})}))\n`;
  dialplanContent += ` same => n,Set(CURRENT_STATUS=\${TOLOWER(\${FILTER(abcdefghijklmnopqrstuvwxyz,\${RAW_STATUS})})})\n`;
  dialplanContent += ` same => n,NoOp(=== [CAPTURA-\${CURR_EXT}] Ciclo \${WAIT_LOOP}/60 - Estado: \${CURRENT_STATUS} (Dest: \${TARGET_DEST}, Agente: \${FINAL_AGENT}, Code: \${USER_DIGITS}) ===)\n`;

  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "valid"]?codigo_aprobado)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "invalid"]?codigo_rechazado)\n`;
  dialplanContent += ` same => n,GotoIf($[\${WAIT_LOOP} >= 60]?codigo_aprobado)\n`;

  dialplanContent += ` ; Tono suave cada 5 segundos para mantener canal activo\n`;
  dialplanContent += ` same => n,ExecIf($[$[\${WAIT_LOOP} % 5] = 0]?Playback(beep))\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Goto(bucle_espera_decision)\n\n`;

  dialplanContent += ` ; RAMA APROBADO: Asesor marco VALIDO en la web -> Reproduce locucion de exito y reconecta con el asesor\n`;
  dialplanContent += ` same => n(codigo_aprobado),NoOp(=== [CAPTURA-\${CURR_EXT}] TOKEN APROBADO: RECONECTANDO CON ASESOR \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST}_\${FINAL_AGENT})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=done)\n`;
  dialplanContent += ` same => n,ExecIf($["\${CID_DIGITS}" != ""]?Set(DB(otp_status/\${CID_DIGITS})=done))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLERID(num)}" != ""]?Set(DB(otp_status/\${CALLERID(num)})=done))\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=done)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_DEST})=otp_valid)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_DEST})}&status=otp_valid&channel=\${URIENCODE(\${CHANNEL})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}" &)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_SUCCESS})\n`;
  dialplanContent += ` same => n,Wait(0.5)\n`;
  dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(name-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CALLERID(name)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CALLERID(all)="\${TARGET_DEST}" <\${TARGET_DEST}>)\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(num,i)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(name,i)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(all,i)="\${TARGET_DEST}" <\${TARGET_DEST}>)\n`;
  dialplanContent += ` same => n,Dial(PJSIP/\${FINAL_AGENT},60,Ttb(sub-audio-quality^s^1(\${TARGET_DEST}))U(sub-record-picked-agent^\${TARGET_DEST}^\${CALLERID(num)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${DIALSTATUS}" = "CHANUNAVAIL" | "\${DIALSTATUS}" = "CONGESTION"]?Dial(\${GLOBAL_RINGALL_EXTENSIONS},45,Ttb(sub-audio-quality^s^1(\${TARGET_DEST}))U(sub-record-picked-agent^\${TARGET_DEST}^\${CALLERID(num)})))\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += ` ; RAMA RECHAZADO: Asesor marco INVALIDO en la web -> Reproduce locucion de error y reintenta pedir codigo\n`;
  dialplanContent += ` same => n(codigo_rechazado),NoOp(=== [CAPTURA-\${CURR_EXT}] TOKEN INVALIDO -> REINTENTANDO ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST}_\${FINAL_AGENT})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,ExecIf($["\${CID_DIGITS}" != ""]?Set(DB(otp_status/\${CID_DIGITS})=pending))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLERID(num)}" != ""]?Set(DB(otp_status/\${CALLERID(num)})=pending))\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_DEST})=otp_invalid)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_DEST})}&status=otp_invalid&channel=\${URIENCODE(\${CHANNEL})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}" &)\n`;
  dialplanContent += ` same => n,Playback(\${AUDIO_FAILURE})\n`;
  dialplanContent += ` same => n,Goto(pedir_codigo)\n\n`;

  dialplanContent += `exten => h,1,NoOp(=== [CAPTURA-DINAMICA HANGUP] Cliente colgo canal: \${CHANNEL} | Causa: \${HANGUPCAUSE} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=ended&cause=\${URIENCODE(\${HANGUPCAUSE})}&channel=\${URIENCODE(\${CHANNEL})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}" &)\n\n`;


  dialplanContent += `; ========================================================\n`;
  dialplanContent += `; CONTEXTO DEDICADO PRESS-1: RESPUESTA ULTRA-RAPIDA AL 1\n`;
  dialplanContent += `; ========================================================\n`;
  dialplanContent += `[ivr-press1]\n`;
  dialplanContent += `exten => s,1,NoOp(=== [IVR-PRESS1] INICIO MODO PRESS 1 CON AUDIO HD ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Playback(custom/rtp_prime)\n`;
  dialplanContent += ` same => n,Set(ANSWER_EPOCH=\${EPOCH})\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_NUM}" != ""]?\${TARGET_NUM}:\${IF($["\${CUSTOMER_NUM}" != ""]?\${CUSTOMER_NUM}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})})})\n`;
  dialplanContent += ` same => n,Set(__TARGET_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CUSTOMER_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__TARGET_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(AMD_ACTIVE=\${DB(ivr_vars/amd_enabled)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AMD_ENABLED}" != ""]?Set(AMD_ACTIVE=\${AMD_ENABLED}))\n`;
  dialplanContent += ` same => n,GotoIf($["\${IS_TEST_CALL}" = "1" | \${LEN(\${TARGET_DEST})} <= 4 | "\${AMD_ACTIVE}" = "0" | "\${AMD_ACTIVE}" = "disabled" | "\${AMD_ACTIVE}" = "off" | "\${AMD_ACTIVE}" = ""]?skip_amd_press1)\n`;
  dialplanContent += ` same => n,NoOp(=== [AMD-DETECTION] Analizando llamada hacia \${TARGET_DEST} (humano vs contestador) ===)\n`;
  dialplanContent += ` same => n,AMD(2000,1500,800,4500,100,50,4,256,5000)\n`;
  dialplanContent += ` same => n,NoOp(=== [AMD-DETECTION] Destino: \${TARGET_DEST} | AMDSTATUS=\${AMDSTATUS} | AMDCAUSE=\${AMDCAUSE} ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AMDSTATUS}" = "MACHINE" & "\${AMDCAUSE:0:14}" = "INITIALSILENCE"]?amd_silence_human_press1)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AMDSTATUS}" = "MACHINE"]?amd_machine_press1)\n`;
  dialplanContent += ` same => n,Goto(amd_ok_press1)\n`;
  dialplanContent += ` same => n(amd_silence_human_press1),NoOp(=== [AMD-SILENCIO-INICIAL] Silencio inicial (\${AMDCAUSE}) permitido en IVR interactivo (sin retorno al asesor si no marca) ===)\n`;
  dialplanContent += ` same => n(amd_ok_press1),Goto(ivr_ready_press1)\n`;
  dialplanContent += ` same => n(skip_amd_press1),NoOp(=== [AMD OMITIDO] Estabilizacion breve post-contestacion (0.3s) antes de iniciar IVR ===)\n`;
  dialplanContent += ` same => n,Wait(0.3)\n`;
  dialplanContent += ` same => n(ivr_ready_press1),Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != "" & "\${IVR_AGENT_EXTEN}" != "ringall" & "\${IVR_AGENT_EXTEN}" != "all"]?\${IVR_AGENT_EXTEN}:\${CALLING_AGENT})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" & "\${CHANNEL(channeltype)}" = "PJSIP"]?Set(FINAL_AGENT=\${CHANNEL(endpoint)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_DEST})=in_ivr)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_DEST})}&status=in_ivr&channel=\${URIENCODE(\${CHANNEL})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}" &)\n`;
  dialplanContent += ` same => n,UserEvent(CallAnswered,Number=\${TARGET_DEST},Context=ivr-press1,Channel=\${CHANNEL})\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(digit)=1)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(response)=4)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(absolute)=180)\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${CALL_INTRO})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_INTRO=\${DB(ivr_vars/tenant_\${TENANT_ID}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/agent_\${FINAL_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/\${FINAL_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/agent_\${CALLING_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/\${CALLING_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/\${TARGET_DEST}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/8888_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/default_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/press1_welcome)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=custom/bienvenida_corporativa))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=custom/bienvenida_press1))\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_INTRO}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_INTRO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_INTRO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_INTRO}.ulaw)} = 0]?Set(IVR_INTRO=custom/bienvenida_corporativa))\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR-AUDIO] Reproduciendo Audio Intro UNA VEZ: \${IVR_INTRO} para Agente: \${FINAL_AGENT} | Destino: \${TARGET_DEST} ===)\n`;
  dialplanContent += ` same => n(menu),Background(\${IVR_INTRO})\n`;
  dialplanContent += ` same => n,WaitExten(6)\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR-PRESS1] Sin respuesta DTMF tras 6s -> Colgando sin regresar al asesor (evita rebote de buzon) ===)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(amd_machine_press1),NoOp(=== [AMD-OPERADORA] Operadora automatica o contestador detectado en \${TARGET_DEST} -> Colgando ===)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_DEST})=machine_detected)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_DEST})}&status=machine_detected&cause=\${URIENCODE(\${AMDCAUSE})}&channel=\${URIENCODE(\${CHANNEL})}&agent=\${URIENCODE(\${IVR_AGENT_EXTEN})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}" &)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AUTO_RETRY}" != "1"]?no_retry_amd_press1)\n`;
  dialplanContent += ` same => n,GotoIf($["\${DB(call_status/\${TARGET_DEST})}" = "operator_hangup" | "\${DB(call_status/\${TARGET_DEST})}" = "ended" | "\${DB(ivr_vars/\${TARGET_DEST}_cancelled)}" = "1"]?no_retry_amd_press1)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/retry?number=\${URIENCODE(\${TARGET_DEST})}&cause=\${URIENCODE(\${AMDCAUSE})}" &)\n`;
  dialplanContent += ` same => n(no_retry_amd_press1),NoOp(=== [AMD RETRY OMITIDO] Reintento no autorizado o llamada finalizada ===)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `; CUANDO EL CLIENTE PRESIONA 1, OTRA TECLA, O SE AGOTA EL TIEMPO: TRANSFERENCIA DIRECTA AL OPERADOR\n`;
  dialplanContent += `exten => 1,1,NoOp(=== [IVR-PRESS1] DIGITO 1 DETECTADO -> CLIENTE PRESIONO 1 ===)\n`;
  dialplanContent += ` same => n,Set(PRESSED_DIGIT=1)\n`;
  dialplanContent += ` same => n(transfer_operator),Set(PRESSED_DIGIT=\${IF($["\${PRESSED_DIGIT}" != ""]?\${PRESSED_DIGIT}:1)})\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_NUM}" != ""]?\${TARGET_NUM}:\${IF($["\${CUSTOMER_NUM}" != ""]?\${CUSTOMER_NUM}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})})})\n`;
  dialplanContent += ` same => n,Set(__TARGET_NUM=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(__TARGET_DEST=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(__CUSTOMER_NUM=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(name-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num)=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(CALLERID(name)=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(CALLERID(all)="\${TARGET_NUM}" <\${TARGET_NUM}>)\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(num,i)=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(name,i)=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(all,i)="\${TARGET_NUM}" <\${TARGET_NUM}>)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=pressed_1)\n`;
  dialplanContent += ` same => n,Set(DB(call_digit/\${TARGET_NUM})=\${PRESSED_DIGIT})\n`;
  dialplanContent += ` same => n,UserEvent(Press1Detected,Number=\${TARGET_NUM},Digit=\${PRESSED_DIGIT},Channel=\${CHANNEL})\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=pressed_1&digit=\${URIENCODE(\${PRESSED_DIGIT})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,Wait(0.4)\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${CALL_AGENT})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_AGENT=\${DB(ivr_vars/tenant_\${TENANT_ID}_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/agent_\${FINAL_AGENT}_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/\${FINAL_AGENT}_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/agent_\${CALLING_AGENT}_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/\${CALLING_AGENT}_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/8888_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/default_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/global_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=custom/conectar_asesor))\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${STRREPLACE(IVR_AGENT,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${STRREPLACE(IVR_AGENT,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${STRREPLACE(IVR_AGENT,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${STRREPLACE(IVR_AGENT,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${STRREPLACE(IVR_AGENT,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${STRREPLACE(IVR_AGENT,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_AGENT}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_AGENT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_AGENT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_AGENT}.ulaw)} = 0]?Set(IVR_AGENT=custom/conectar_asesor))\n`;
  dialplanContent += ` same => n,Playback(\${IVR_AGENT})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != ""]?\${IVR_AGENT_EXTEN}:\${DB(ivr_vars/\${TARGET_DEST}_agent_exten)})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=ringall))\n`;
  dialplanContent += ` same => n,Set(__LAST_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${TARGET_DEST})=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${CALLERID(num)})=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=transferred)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=transferred&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,GotoIf($["\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all" | "\${FINAL_AGENT}" = "hunt"]?dial_press1_ringall:dial_press1_single)\n`;
  dialplanContent += ` same => n(dial_press1_single),NoOp(=== [PRESS-1 ASESOR O EXTENSIONES ESPECIFICAS] Marcando directo a: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(DIAL_AGENTS=PJSIP/\${STRREPLACE(FINAL_AGENT,&,&PJSIP/)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" =~ "PJSIP/"]?Set(DIAL_AGENTS=\${FINAL_AGENT}))\n`;
  dialplanContent += ` same => n,NoOp(=== [PRESS-1 DIAL STRING] Marcando simultaneamente a: \${DIAL_AGENTS} ===)\n`;
  dialplanContent += ` same => n,Dial(\${DIAL_AGENTS},60,Ttb(sub-audio-quality^s^1(\${TARGET_NUM}))U(sub-record-picked-agent^\${TARGET_NUM}^\${CALLERID(num)}))\n`;
  dialplanContent += ` same => n,GotoIf($["\${DIALSTATUS}" = "CHANUNAVAIL" | "\${DIALSTATUS}" = "CONGESTION"]?dial_press1_ringall)\n`;
  dialplanContent += ` same => n,Goto(press1_finish)\n`;
  dialplanContent += ` same => n(dial_press1_ringall),NoOp(=== [PRESS-1 RING-ALL TODAS LAS EXTENSIONES] Marcando: \${GLOBAL_RINGALL_EXTENSIONS} ===)\n`;
  dialplanContent += ` same => n,Dial(\${GLOBAL_RINGALL_EXTENSIONS},60,Ttb(sub-audio-quality^s^1(\${TARGET_NUM}))U(sub-record-picked-agent^\${TARGET_NUM}^\${CALLERID(num)}))\n`;
  dialplanContent += ` same => n,GotoIf($["\${DIALSTATUS}" = "CHANUNAVAIL" | "\${DIALSTATUS}" = "CONGESTION"]?press1_agent_retry)\n`;
  dialplanContent += ` same => n,Goto(press1_finish)\n`;
  dialplanContent += ` same => n(press1_agent_retry),NoOp(=== [PRESS-1 REINTENTO SILENCIOSO] Ningún softphone disponible (\${DIALSTATUS}) -> Reintento breve directo ===)\n`;
  dialplanContent += ` same => n,Wait(1.2)\n`;
  dialplanContent += ` same => n,Dial(\${GLOBAL_RINGALL_EXTENSIONS},30,Ttb(sub-audio-quality^s^1(\${TARGET_NUM}))U(sub-record-picked-agent^\${TARGET_NUM}^\${CALLERID(num)}))\n`;
  dialplanContent += ` same => n(press1_finish),Hangup()\n\n`;

  dialplanContent += `; CUALQUIER OTRA TECLA (0, 2-9, *, #) TRANSFIERE DIRECTO AL OPERADOR\n`;
  dialplanContent += `exten => _[02-9],1,NoOp(=== [IVR-PRESS1] Otra tecla presionada (\${EXTEN}) -> Transfiriendo a operador ===)\n`;
  dialplanContent += ` same => n,Set(PRESSED_DIGIT=\${EXTEN})\n`;
  dialplanContent += ` same => n,Goto(1,transfer_operator)\n\n`;
  dialplanContent += `exten => *,1,NoOp(=== [IVR-PRESS1] Tecla * presionada -> Transfiriendo a operador ===)\n`;
  dialplanContent += ` same => n,Set(PRESSED_DIGIT=*)\n`;
  dialplanContent += ` same => n,Goto(1,transfer_operator)\n\n`;
  dialplanContent += `exten => #,1,NoOp(=== [IVR-PRESS1] Tecla # presionada -> Transfiriendo a operador ===)\n`;
  dialplanContent += ` same => n,Set(PRESSED_DIGIT=#)\n`;
  dialplanContent += ` same => n,Goto(1,transfer_operator)\n\n`;
  dialplanContent += `exten => i,1,NoOp(=== [IVR-PRESS1] Entrada invalida -> Colgando para evitar rebote de buzon ===)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += `exten => t,1,NoOp(=== [IVR-PRESS1] Timeout WaitExten -> Colgando sin transferir al asesor ===)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `exten => h,1,NoOp(=== [IVR-PRESS1 HANGUP] Cliente colgo canal: \${CHANNEL} | Causa: \${HANGUPCAUSE} | AMD=\${AMDSTATUS} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${DB(call_status/\${TARGET_NUM})}" = "machine_detected" | $["\${AMDSTATUS}" = "MACHINE" & "\${AMDCAUSE:0:14}" != "INITIALSILENCE"]]?h_keep_machine_press1)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=ended&cause=\${URIENCODE(\${HANGUPCAUSE})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n(h_keep_machine_press1),NoOp()\n\n`;

  dialplanContent += `[ivr-otp]\n`;
  dialplanContent += `exten => s,1,NoOp(=== IVR INTERACTIVO CON AUDIOS PREGRABADOS Y CALIDAD HD ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Playback(custom/rtp_prime)\n`;
  dialplanContent += ` same => n,Set(ANSWER_EPOCH=\${EPOCH})\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_NUM}" != ""]?\${TARGET_NUM}:\${IF($["\${CUSTOMER_NUM}" != ""]?\${CUSTOMER_NUM}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})})})\n`;
  dialplanContent += ` same => n,Set(__TARGET_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CUSTOMER_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__TARGET_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(AMD_ACTIVE=\${DB(ivr_vars/amd_enabled)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AMD_ENABLED}" != ""]?Set(AMD_ACTIVE=\${AMD_ENABLED}))\n`;
  dialplanContent += ` same => n,GotoIf($["\${IS_TEST_CALL}" = "1" | \${LEN(\${TARGET_DEST})} <= 4 | "\${AMD_ACTIVE}" = "0" | "\${AMD_ACTIVE}" = "disabled" | "\${AMD_ACTIVE}" = "off" | "\${AMD_ACTIVE}" = ""]?skip_amd_otp)\n`;
  dialplanContent += ` same => n,NoOp(=== [AMD-DETECTION] Analizando llamada hacia \${TARGET_DEST} (humano vs contestador) ===)\n`;
  dialplanContent += ` same => n,AMD(2000,1500,800,4500,100,50,4,256,5000)\n`;
  dialplanContent += ` same => n,NoOp(=== [AMD-DETECTION] Destino: \${TARGET_DEST} | AMDSTATUS=\${AMDSTATUS} | AMDCAUSE=\${AMDCAUSE} ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AMDSTATUS}" = "MACHINE" & "\${AMDCAUSE:0:14}" = "INITIALSILENCE"]?amd_silence_human_otp)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AMDSTATUS}" = "MACHINE"]?amd_machine_otp)\n`;
  dialplanContent += ` same => n,Goto(amd_ok_otp)\n`;
  dialplanContent += ` same => n(amd_silence_human_otp),NoOp(=== [AMD-SILENCIO-INICIAL] Silencio inicial (\${AMDCAUSE}) permitido en IVR OTP (sin retorno al asesor si no marca) ===)\n`;
  dialplanContent += ` same => n(amd_ok_otp),Goto(ivr_ready_otp)\n`;
  dialplanContent += ` same => n(skip_amd_otp),NoOp(=== [AMD OMITIDO] Estabilizacion breve post-contestacion (0.3s) antes de iniciar IVR ===)\n`;
  dialplanContent += ` same => n,Wait(0.3)\n`;
  dialplanContent += ` same => n(ivr_ready_otp),Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != "" & "\${IVR_AGENT_EXTEN}" != "ringall" & "\${IVR_AGENT_EXTEN}" != "all"]?\${IVR_AGENT_EXTEN}:\${CALLING_AGENT})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" & "\${CHANNEL(channeltype)}" = "PJSIP"]?Set(FINAL_AGENT=\${CHANNEL(endpoint)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_DEST})=in_ivr)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_DEST})}&status=in_ivr&channel=\${URIENCODE(\${CHANNEL})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}" &)\n`;
  dialplanContent += ` same => n,UserEvent(CallAnswered,Number=\${TARGET_DEST},Context=ivr-otp,Channel=\${CHANNEL})\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(digit)=1)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(response)=4)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(absolute)=180)\n`;
  dialplanContent += ` same => n,Set(OTP_LOOP_COUNT=0)\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${CALL_INTRO})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_INTRO=\${DB(ivr_vars/tenant_\${TENANT_ID}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/agent_\${FINAL_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/\${FINAL_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/agent_\${CALLING_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/\${CALLING_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/\${TARGET_DEST}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/8888_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/default_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/global_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${GLOBAL_DEFAULT_INTRO}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=custom/bienvenida_corporativa))\n`;

  dialplanContent += ` same => n,Set(IVR_PROMPT=\${CALL_PROMPT})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_PROMPT=\${DB(ivr_vars/tenant_\${TENANT_ID}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${DB(ivr_vars/agent_\${FINAL_AGENT}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${DB(ivr_vars/\${FINAL_AGENT}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${DB(ivr_vars/agent_\${CALLING_AGENT}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${DB(ivr_vars/\${CALLING_AGENT}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${DB(ivr_vars/\${TARGET_DEST}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${DB(ivr_vars/8888_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${DB(ivr_vars/default_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${DB(ivr_vars/global_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=\${GLOBAL_DEFAULT_PROMPT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_PROMPT}" = ""]?Set(IVR_PROMPT=custom/solicitar_codigo_otp))\n`;

  dialplanContent += ` same => n,Set(IVR_WAIT=\${CALL_WAIT})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_WAIT=\${DB(ivr_vars/tenant_\${TENANT_ID}_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/agent_\${FINAL_AGENT}_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/\${FINAL_AGENT}_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/\${TARGET_DEST}_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/8888_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/default_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${GLOBAL_DEFAULT_WAIT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=custom/un_momento_validando_informacion))\n`;

  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${CALL_SUCCESS})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/tenant_\${TENANT_ID}_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/agent_\${FINAL_AGENT}_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/\${FINAL_AGENT}_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/\${TARGET_DEST}_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/8888_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/default_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${GLOBAL_DEFAULT_SUCCESS}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=custom/operacion_bloqueada_exito))\n`;

  dialplanContent += ` same => n,Set(IVR_AGENT=\${CALL_AGENT})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_AGENT=\${DB(ivr_vars/tenant_\${TENANT_ID}_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/agent_\${FINAL_AGENT}_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/\${FINAL_AGENT}_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/default_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${GLOBAL_DEFAULT_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=custom/conectar_asesor))\n`;

  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT_EXTEN}" = ""]?Set(IVR_AGENT_EXTEN=\${FINAL_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT_EXTEN}" = ""]?Set(IVR_AGENT_EXTEN=\${DB(ivr_vars/\${TARGET_DEST}_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT_EXTEN}" = ""]?Set(IVR_AGENT_EXTEN=1001))\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${DB(ivr_vars/agent_\${FINAL_AGENT}_failure)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_FAILURE}" = ""]?Set(IVR_FAILURE=\${DB(ivr_vars/\${FINAL_AGENT}_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_FAILURE}" = ""]?Set(IVR_FAILURE=\${DB(ivr_vars/\${TARGET_DEST}_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_FAILURE}" = ""]?Set(IVR_FAILURE=\${DB(ivr_vars/8888_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_FAILURE}" = ""]?Set(IVR_FAILURE=\${DB(ivr_vars/default_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_FAILURE}" = ""]?Set(IVR_FAILURE=custom/token_invalido_reintente))\n`;
  dialplanContent += ` same => n,Set(IVR_INVALID=\${DB(ivr_vars/agent_\${FINAL_AGENT}_invalid)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INVALID}" = ""]?Set(IVR_INVALID=\${DB(ivr_vars/\${FINAL_AGENT}_invalid)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INVALID}" = ""]?Set(IVR_INVALID=\${DB(ivr_vars/\${TARGET_DEST}_invalid)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INVALID}" = ""]?Set(IVR_INVALID=\${DB(ivr_vars/8888_invalid)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INVALID}" = ""]?Set(IVR_INVALID=\${DB(ivr_vars/default_invalid)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INVALID}" = ""]?Set(IVR_INVALID=custom/opcion_invalida))\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_INTRO}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_INTRO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_INTRO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_INTRO}.ulaw)} = 0]?Set(IVR_INTRO=custom/bienvenida_corporativa))\n`;
  dialplanContent += ` same => n,Set(IVR_PROMPT=\${STRREPLACE(IVR_PROMPT,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_PROMPT=\${STRREPLACE(IVR_PROMPT,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_PROMPT=\${STRREPLACE(IVR_PROMPT,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_PROMPT=\${STRREPLACE(IVR_PROMPT,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_PROMPT=\${STRREPLACE(IVR_PROMPT,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_PROMPT=\${STRREPLACE(IVR_PROMPT,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_PROMPT}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_PROMPT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_PROMPT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_PROMPT}.ulaw)} = 0]?Set(IVR_PROMPT=custom/solicitar_codigo_otp))\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_WAIT}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_WAIT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_WAIT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_WAIT}.ulaw)} = 0]?Set(IVR_WAIT=custom/un_momento_validando_informacion))\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_SUCCESS}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_SUCCESS}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_SUCCESS}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_SUCCESS}.ulaw)} = 0]?Set(IVR_SUCCESS=custom/operacion_bloqueada_exito))\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${STRREPLACE(IVR_AGENT,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${STRREPLACE(IVR_AGENT,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${STRREPLACE(IVR_AGENT,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${STRREPLACE(IVR_AGENT,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${STRREPLACE(IVR_AGENT,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${STRREPLACE(IVR_AGENT,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_AGENT}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_AGENT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_AGENT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_AGENT}.ulaw)} = 0]?Set(IVR_AGENT=custom/conectar_asesor))\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_FAILURE}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_FAILURE}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_FAILURE}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_FAILURE}.ulaw)} = 0]?Set(IVR_FAILURE=custom/token_invalido_reintente))\n`;
  dialplanContent += ` same => n,Set(IVR_INVALID=\${STRREPLACE(IVR_INVALID,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INVALID=\${STRREPLACE(IVR_INVALID,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INVALID=\${STRREPLACE(IVR_INVALID,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_INVALID}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_INVALID}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_INVALID}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_INVALID}.ulaw)} = 0]?Set(IVR_INVALID=custom/opcion_invalida))\n`;
  dialplanContent += ` same => n,NoOp(Audios Destino \${TARGET_DEST}: Intro=\${IVR_INTRO}, Prompt=\${IVR_PROMPT}, Wait=\${IVR_WAIT}, Fail=\${IVR_FAILURE})\n`;

  dialplanContent += ` same => n,NoOp(=== [IVR] Reproduciendo Audio de Bienvenida interactivo: \${IVR_INTRO} ===)\n`;
  dialplanContent += ` same => n,Background(\${IVR_INTRO})\n`;
  dialplanContent += ` same => n,Wait(0.3)\n`;
  dialplanContent += ` same => n,Goto(ask_input)\n\n`;

  dialplanContent += ` ; Solicitud de codigo o presion de tecla 1 (sin repetir mensaje si no hay respuesta, transfiere al operador)\n`;
  dialplanContent += ` same => n(ask_input),NoOp(=== [IVR] Solicitando Codigo OTP o Presione 1: \${IVR_PROMPT} ===)\n`;
  dialplanContent += ` same => n,Set(USER_DIGITS=)\n`;
  dialplanContent += ` same => n,Background(\${IVR_PROMPT})\n`;
  dialplanContent += ` same => n,WaitExten(6)\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR-OTP] Sin respuesta DTMF tras 6s -> Colgando sin regresar al asesor ===)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(max_timeouts_otp),NoOp(=== [IVR-OTP] Tiempo superado -> Colgando sin transferir ===)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(amd_machine_otp),NoOp(=== [AMD OPERADORA DETECTADA] Grabadora o contestador en \${TARGET_DEST} -> Colgando ===)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_DEST})=machine_detected)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_DEST})}&status=machine_detected&cause=\${URIENCODE(\${AMDCAUSE})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AUTO_RETRY}" != "1"]?no_retry_amd_otp)\n`;
  dialplanContent += ` same => n,GotoIf($["\${DB(call_status/\${TARGET_DEST})}" = "operator_hangup" | "\${DB(call_status/\${TARGET_DEST})}" = "ended" | "\${DB(ivr_vars/\${TARGET_DEST}_cancelled)}" = "1"]?no_retry_amd_otp)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/retry?number=\${URIENCODE(\${TARGET_DEST})}&cause=\${URIENCODE(\${AMDCAUSE})}" &)\n`;
  dialplanContent += ` same => n(no_retry_amd_otp),NoOp(=== [AMD RETRY OMITIDO] Reintento no autorizado o llamada finalizada ===)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += ` same => n(otp_confirm),NoOp(=== [IVR] CODIGO OTP INGRESADO: \${USER_DIGITS} -> NOTIFICAR A ASESOR ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/\${TARGET_DEST})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/\${CALLERID(num)})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${CALLERID(num)})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_capture)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,UserEvent(OTPCaptured,Number=\${TARGET_DEST},Digits=\${USER_DIGITS},Status=pending,Agent=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/otp/capture?number=\${URIENCODE(\${TARGET_DEST})}&otp=\${URIENCODE(\${USER_DIGITS})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenantId=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}&status=pending" &)\n`;

  dialplanContent += ` same => n,NoOp(=== [IVR] Reproduciendo audio de validacion en curso: \${IVR_WAIT} ===)\n`;
  dialplanContent += ` same => n,Playback(\${IVR_WAIT})\n`;
  dialplanContent += ` same => n,Wait(1)\n`;

  dialplanContent += ` same => n,NoOp(=== [IVR] ESPERANDO DECISION DEL ASESOR (VALIDO O INVALIDO) ===)\n`;
  dialplanContent += ` same => n,Set(WAIT_LOOP=0)\n`;
  dialplanContent += ` same => n(wait_decision_loop),Set(WAIT_LOOP=$[\${WAIT_LOOP} + 1])\n`;
  dialplanContent += ` same => n,Set(CURRENT_STATUS=\${DB(otp_status/\${TARGET_DEST})})\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR] Ciclo \${WAIT_LOOP}/20 - Estado en AstDB: \${CURRENT_STATUS} ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "valid"]?otp_approved)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "invalid"]?otp_rejected_retry)\n`;
  dialplanContent += ` same => n,GotoIf($[\${WAIT_LOOP} >= 20]?otp_approved)\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Goto(wait_decision_loop)\n\n`;

  dialplanContent += ` same => n(otp_approved),NoOp(=== [IVR] TOKEN APROBADO: CONECTANDO DE VUELTA CON EL ASESOR ===)\n`;
  dialplanContent += ` same => n,Playback(\${IVR_SUCCESS})\n`;
  dialplanContent += ` same => n,Wait(0.5)\n`;
  dialplanContent += ` same => n,Set(CALLER_EXT=\${CALLERID(num)})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != ""]?\${IVR_AGENT_EXTEN}:1001)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLER_EXT}" = "\${FINAL_AGENT}"]?Set(FINAL_AGENT=1002))\n`;
  dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(name-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CALLERID(name)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CALLERID(all)="\${TARGET_DEST}" <\${TARGET_DEST}>)\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(num,i)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(name,i)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(all,i)="\${TARGET_DEST}" <\${TARGET_DEST}>)\n`;
  dialplanContent += ` same => n,Set(DIAL_AGENTS=\${IF($["\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all" | "\${FINAL_AGENT}" = "hunt"]?\${GLOBAL_RINGALL_EXTENSIONS}:PJSIP/\${STRREPLACE(FINAL_AGENT,&,&PJSIP/)})})\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR] RECONECTANDO LLAMADA CON EL ASESOR EN EXTENSION \${FINAL_AGENT} -> \${DIAL_AGENTS} (Cliente: \${TARGET_DEST}) ===)\n`;
  dialplanContent += ` same => n,Dial(\${DIAL_AGENTS},60,Ttb(sub-audio-quality^s^1(\${TARGET_DEST}))U(sub-record-picked-agent^\${TARGET_DEST}^\${CALLERID(num)}))\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += ` same => n(otp_rejected_retry),NoOp(=== [IVR] TOKEN INVALIDO DETECTADO -> SOLICITANDO NUEVO CODIGO AUTOMATICAMENTE ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=pending)\n`;
  dialplanContent += ` same => n,Playback(\${IVR_FAILURE})\n`;
  dialplanContent += ` same => n,Goto(ask_input)\n\n`;

  dialplanContent += ` same => n(self_test_success),NoOp(=== [IVR] PRUEBA LOCAL 8888 EXITOSA: CÓDIGO \${USER_DIGITS} VALIDADO ===)\n`;
  dialplanContent += ` same => n,Playback(beep)\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `; CUANDO EL CLIENTE PRESIONA 1: MENSAJE DE TRANSFERENCIA AL ASESOR INMEDIATO\n`;
  dialplanContent += ` same => n(press1_transfer),Goto(1,1)\n\n`;

  dialplanContent += ` same => n(no_input),NoOp(=== SIN ENTRADA DTMF DETECTADA ===)\n`;
  dialplanContent += ` same => n,Playback(beep)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `exten => 1,1,NoOp(=== [IVR] PRESS 1 DETECTADO -> NOTIFICANDO PANEL Y ASESOR ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_NUM}" != ""]?\${TARGET_NUM}:\${IF($["\${CUSTOMER_NUM}" != ""]?\${CUSTOMER_NUM}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})})})\n`;
  dialplanContent += ` same => n,Set(__TARGET_NUM=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(__TARGET_DEST=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(__CUSTOMER_NUM=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(name-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num)=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(CALLERID(name)=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(CALLERID(all)="\${TARGET_NUM}" <\${TARGET_NUM}>)\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(num,i)=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(name,i)=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(all,i)="\${TARGET_NUM}" <\${TARGET_NUM}>)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=pressed_1)\n`;
  dialplanContent += ` same => n,Set(DB(call_digit/\${TARGET_NUM})=1)\n`;
  dialplanContent += ` same => n,UserEvent(Press1Detected,Number=\${TARGET_NUM},Digit=1,Channel=\${CHANNEL})\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=pressed_1&digit=1&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,Wait(0.4)\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${CALL_AGENT})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_AGENT=\${DB(ivr_vars/tenant_\${TENANT_ID}_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/agent_\${FINAL_AGENT}_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/\${FINAL_AGENT}_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/agent_\${CALLING_AGENT}_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=\${DB(ivr_vars/default_agent)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_AGENT}" = ""]?Set(IVR_AGENT=custom/conectar_asesor))\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${STRREPLACE(IVR_AGENT,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${STRREPLACE(IVR_AGENT,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_AGENT=\${STRREPLACE(IVR_AGENT,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_AGENT}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_AGENT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_AGENT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_AGENT}.ulaw)} = 0]?Set(IVR_AGENT=custom/conectar_asesor))\n`;
  dialplanContent += ` same => n,Playback(\${IVR_AGENT})\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != ""]?\${IVR_AGENT_EXTEN}:\${DB(ivr_vars/\${TARGET_DEST}_agent_exten)})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=ringall))\n`;
  dialplanContent += ` same => n,Set(__LAST_AGENT=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/8888)=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${TARGET_DEST})=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(last_agent_call/\${CALLERID(num)})=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=transferred)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=transferred&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,GotoIf($["\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all" | "\${FINAL_AGENT}" = "hunt"]?dial_otp_ringall:dial_otp_single)\n`;
  dialplanContent += ` same => n(dial_otp_single),NoOp(=== [OTP PRESS-1 ASESOR O EXTENSIONES ESPECIFICAS] Marcando directo a: \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(DIAL_AGENTS=PJSIP/\${STRREPLACE(FINAL_AGENT,&,&PJSIP/)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" =~ "PJSIP/"]?Set(DIAL_AGENTS=\${FINAL_AGENT}))\n`;
  dialplanContent += ` same => n,Dial(\${DIAL_AGENTS},60,Ttb(sub-audio-quality^s^1(\${TARGET_NUM}))U(sub-record-picked-agent^\${TARGET_NUM}^\${CALLERID(num)}))\n`;
  dialplanContent += ` same => n,GotoIf($["\${DIALSTATUS}" = "CHANUNAVAIL" | "\${DIALSTATUS}" = "CONGESTION"]?dial_otp_ringall)\n`;
  dialplanContent += ` same => n,Goto(otp_press1_finish)\n`;
  dialplanContent += ` same => n(dial_otp_ringall),NoOp(=== [OTP PRESS-1 RING-ALL TODAS LAS EXTENSIONES] Marcando: \${GLOBAL_RINGALL_EXTENSIONS} ===)\n`;
  dialplanContent += ` same => n,Dial(\${GLOBAL_RINGALL_EXTENSIONS},60,Ttb(sub-audio-quality^s^1(\${TARGET_NUM}))U(sub-record-picked-agent^\${TARGET_NUM}^\${CALLERID(num)}))\n`;
  dialplanContent += ` same => n,GotoIf($["\${DIALSTATUS}" = "CHANUNAVAIL" | "\${DIALSTATUS}" = "CONGESTION"]?otp_press1_agent_retry)\n`;
  dialplanContent += ` same => n,Goto(otp_press1_finish)\n`;
  dialplanContent += ` same => n(otp_press1_agent_retry),NoOp(=== [OTP REINTENTO SILENCIOSO] Ningún softphone disponible (\${DIALSTATUS}) -> Reintento breve directo ===)\n`;
  dialplanContent += ` same => n,Wait(1.2)\n`;
  dialplanContent += ` same => n,Dial(\${GLOBAL_RINGALL_EXTENSIONS},30,Ttb(sub-audio-quality^s^1(\${TARGET_NUM}))U(sub-record-picked-agent^\${TARGET_NUM}^\${CALLERID(num)}))\n`;
  dialplanContent += ` same => n(otp_press1_finish),Hangup()\n\n`;

  dialplanContent += `exten => _XXXX,1,Set(USER_DIGITS=\${EXTEN})\n`;
  dialplanContent += ` same => n,Goto(s,otp_confirm)\n`;
  dialplanContent += `exten => _XXXXX,1,Set(USER_DIGITS=\${EXTEN})\n`;
  dialplanContent += ` same => n,Goto(s,otp_confirm)\n`;
  dialplanContent += `exten => _XXXXXX,1,Set(USER_DIGITS=\${EXTEN})\n`;
  dialplanContent += ` same => n,Goto(s,otp_confirm)\n`;
  dialplanContent += `exten => _XXXXXXX,1,Set(USER_DIGITS=\${EXTEN})\n`;
  dialplanContent += ` same => n,Goto(s,otp_confirm)\n`;
  dialplanContent += `exten => _XXXXXXXX,1,Set(USER_DIGITS=\${EXTEN})\n`;
  dialplanContent += ` same => n,Goto(s,otp_confirm)\n`;
  dialplanContent += `exten => i,1,NoOp(=== [IVR-OTP] Entrada invalida (\${EXTEN}) -> Colgando sin regresar al asesor ===)\n`;
  dialplanContent += ` same => n,Hangup()\n`;
  dialplanContent += `exten => t,1,NoOp(=== [IVR-OTP] Timeout -> Colgando sin regresar al asesor ===)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `exten => h,1,NoOp(=== [IVR-OTP HANGUP] Cliente colgo canal: \${CHANNEL} | Causa: \${HANGUPCAUSE} | AMD=\${AMDSTATUS} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${DB(call_status/\${TARGET_NUM})}" = "machine_detected" | $["\${AMDSTATUS}" = "MACHINE" & "\${AMDCAUSE:0:14}" != "INITIALSILENCE"]]?h_keep_machine_otp)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=ended&cause=\${URIENCODE(\${HANGUPCAUSE})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n(h_keep_machine_otp),NoOp()\n\n`;

  dialplanContent += `; ========================================================\n`;
  dialplanContent += `; CONTEXTO MARCACION 1-CLIC: REPRODUCCION DE AUDIO DIRECTO AL DESCOLGAR\n`;
  dialplanContent += `; ========================================================\n`;
  dialplanContent += `[ivr-direct-playback]\n`;
  dialplanContent += `exten => s,1,NoOp(=== [1-CLICK PLAYBACK] AUDIO AL DESCOLGAR PARA DESTINO \${CALLERID(num)} ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Playback(custom/rtp_prime)\n`;
  dialplanContent += ` same => n,Set(ANSWER_EPOCH=\${EPOCH})\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_NUM}" != ""]?\${TARGET_NUM}:\${IF($["\${CUSTOMER_NUM}" != ""]?\${CUSTOMER_NUM}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})})})\n`;
  dialplanContent += ` same => n,Set(__TARGET_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CUSTOMER_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__TARGET_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(AMD_ACTIVE=\${DB(ivr_vars/amd_enabled)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AMD_ENABLED}" != ""]?Set(AMD_ACTIVE=\${AMD_ENABLED}))\n`;
  dialplanContent += ` same => n,GotoIf($["\${IS_TEST_CALL}" = "1" | \${LEN(\${TARGET_DEST})} <= 4 | "\${AMD_ACTIVE}" = "0" | "\${AMD_ACTIVE}" = "disabled" | "\${AMD_ACTIVE}" = "off" | "\${AMD_ACTIVE}" = ""]?skip_amd_dpb)\n`;
  dialplanContent += ` same => n,NoOp(=== [AMD-DETECTION] Analizando llamada Playback hacia \${TARGET_DEST} ===)\n`;
  dialplanContent += ` same => n,AMD(2000,1500,800,4500,100,50,4,256,5000)\n`;
  dialplanContent += ` same => n,NoOp(=== [AMD-DETECTION] Destino: \${TARGET_DEST} | AMDSTATUS=\${AMDSTATUS} | AMDCAUSE=\${AMDCAUSE} ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AMDSTATUS}" = "MACHINE" & "\${AMDCAUSE:0:14}" = "INITIALSILENCE"]?amd_silence_human_dpb)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AMDSTATUS}" = "MACHINE"]?amd_machine_dpb)\n`;
  dialplanContent += ` same => n,Goto(amd_ok_dpb)\n`;
  dialplanContent += ` same => n(amd_silence_human_dpb),NoOp(=== [AMD-SILENCIO-INICIAL] Silencio inicial (\${AMDCAUSE}) permitido para reproducir audio ===)\n`;
  dialplanContent += ` same => n(amd_ok_dpb),Goto(ivr_ready_dpb)\n`;
  dialplanContent += ` same => n(skip_amd_dpb),Wait(0.3)\n`;
  dialplanContent += ` same => n(ivr_ready_dpb),Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != "" & "\${IVR_AGENT_EXTEN}" != "ringall" & "\${IVR_AGENT_EXTEN}" != "all"]?\${IVR_AGENT_EXTEN}:\${CALLING_AGENT})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_DEST})=playing_audio)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_DEST})}&status=playing_audio&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,Set(PLAY_AUDIO=\${CALL_PROMPT})\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${CALL_INTRO}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = "" & "\${TENANT_ID}" != ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/tenant_\${TENANT_ID}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/agent_\${FINAL_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/agent_\${FINAL_AGENT}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/agent_\${CALLING_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/agent_\${CALLING_AGENT}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/\${TARGET_DEST}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/\${TARGET_DEST}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/8888_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/default_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=custom/banrearreglado))\n`;
  dialplanContent += ` same => n,Set(PLAY_AUDIO=\${STRREPLACE(PLAY_AUDIO,.wav,)})\n`;
  dialplanContent += ` same => n,Set(PLAY_AUDIO=\${STRREPLACE(PLAY_AUDIO,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(PLAY_AUDIO=\${STRREPLACE(PLAY_AUDIO,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(PLAY_AUDIO=\${STRREPLACE(PLAY_AUDIO,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(PLAY_AUDIO=\${STRREPLACE(PLAY_AUDIO,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(PLAY_AUDIO=\${STRREPLACE(PLAY_AUDIO,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${PLAY_AUDIO}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${PLAY_AUDIO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${PLAY_AUDIO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${PLAY_AUDIO}.ulaw)} = 0]?Set(PLAY_AUDIO=custom/banrearreglado))\n`;
  dialplanContent += ` same => n,NoOp(=== [1-CLICK PLAYBACK] Reproduciendo: \${PLAY_AUDIO} a \${TARGET_DEST} ===)\n`;
  dialplanContent += ` same => n,Playback(\${PLAY_AUDIO})\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_DEST})=audio_completed)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_DEST})}&status=audio_completed&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,Hangup()\n`;
  dialplanContent += ` same => n(amd_machine_dpb),NoOp(=== [AMD-OPERADORA] Contestador detectado en \${TARGET_DEST} -> Colgando ===)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_DEST})=machine_detected)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_DEST})}&status=machine_detected&cause=\${URIENCODE(\${AMDCAUSE})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AUTO_RETRY}" != "1"]?no_retry_amd_dpb)\n`;
  dialplanContent += ` same => n,GotoIf($["\${DB(call_status/\${TARGET_DEST})}" = "operator_hangup" | "\${DB(call_status/\${TARGET_DEST})}" = "ended" | "\${DB(ivr_vars/\${TARGET_DEST}_cancelled)}" = "1"]?no_retry_amd_dpb)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/retry?number=\${URIENCODE(\${TARGET_DEST})}&cause=\${URIENCODE(\${AMDCAUSE})}" &)\n`;
  dialplanContent += ` same => n(no_retry_amd_dpb),NoOp(=== [AMD RETRY OMITIDO] Reintento no autorizado o llamada finalizada ===)\n`;
  dialplanContent += ` same => n,Hangup()\n`;
  dialplanContent += `exten => h,1,NoOp(=== [1-CLICK PLAYBACK HANGUP] Canal: \${CHANNEL} | Causa: \${HANGUPCAUSE} | AMD=\${AMDSTATUS} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${DB(call_status/\${TARGET_NUM})}" = "machine_detected" | $["\${AMDSTATUS}" = "MACHINE" & "\${AMDCAUSE:0:14}" != "INITIALSILENCE"]]?h_keep_machine_dpb)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=ended&cause=\${URIENCODE(\${HANGUPCAUSE})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n(h_keep_machine_dpb),NoOp()\n\n`;

  dialplanContent += `; ========================================================\n`;
  dialplanContent += `; CONTEXTO MARCACION 1-CLIC: AUDIO DE ENTRADA + TRANSFERENCIA INMEDIATA A ASESOR\n`;
  dialplanContent += `; ========================================================\n`;
  dialplanContent += `[ivr-audio-then-agent]\n`;
  dialplanContent += `exten => s,1,NoOp(=== [1-CLICK AUDIO+AGENT] AUDIO INTRO Y LUEGO CONEXION CON ASESOR ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Playback(custom/rtp_prime)\n`;
  dialplanContent += ` same => n,Set(ANSWER_EPOCH=\${EPOCH})\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_NUM}" != ""]?\${TARGET_NUM}:\${IF($["\${CUSTOMER_NUM}" != ""]?\${CUSTOMER_NUM}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})})})\n`;
  dialplanContent += ` same => n,Set(__TARGET_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CUSTOMER_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__TARGET_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(AMD_ACTIVE=\${DB(ivr_vars/amd_enabled)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AMD_ENABLED}" != ""]?Set(AMD_ACTIVE=\${AMD_ENABLED}))\n`;
  dialplanContent += ` same => n,GotoIf($["\${IS_TEST_CALL}" = "1" | \${LEN(\${TARGET_DEST})} <= 4 | "\${AMD_ACTIVE}" = "0" | "\${AMD_ACTIVE}" = "disabled" | "\${AMD_ACTIVE}" = "off" | "\${AMD_ACTIVE}" = ""]?skip_amd_ata)\n`;
  dialplanContent += ` same => n,NoOp(=== [AMD-DETECTION] Analizando llamada Audio+Agent hacia \${TARGET_DEST} ===)\n`;
  dialplanContent += ` same => n,AMD(2000,1500,800,4500,100,50,4,256,5000)\n`;
  dialplanContent += ` same => n,NoOp(=== [AMD-DETECTION] Destino: \${TARGET_DEST} | AMDSTATUS=\${AMDSTATUS} | AMDCAUSE=\${AMDCAUSE} ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AMDSTATUS}" = "MACHINE" & "\${AMDCAUSE:0:14}" = "INITIALSILENCE"]?amd_silence_human_ata)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AMDSTATUS}" = "MACHINE"]?amd_machine_ata)\n`;
  dialplanContent += ` same => n,Goto(amd_ok_ata)\n`;
  dialplanContent += ` same => n(amd_silence_human_ata),NoOp(=== [AMD-SILENCIO-INICIAL] Silencio inicial (\${AMDCAUSE}) permitido en Audio+Agent ===)\n`;
  dialplanContent += ` same => n(amd_ok_ata),Goto(ivr_ready_ata)\n`;
  dialplanContent += ` same => n(skip_amd_ata),Wait(0.3)\n`;
  dialplanContent += ` same => n(ivr_ready_ata),Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != "" & "\${IVR_AGENT_EXTEN}" != "ringall" & "\${IVR_AGENT_EXTEN}" != "all"]?\${IVR_AGENT_EXTEN}:\${CALLING_AGENT})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(PLAY_AUDIO=\${CALL_INTRO})\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${CALL_PROMPT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = "" & "\${TENANT_ID}" != ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/tenant_\${TENANT_ID}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/agent_\${FINAL_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/agent_\${CALLING_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/\${TARGET_DEST}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/\${TARGET_DEST}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/8888_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=\${DB(ivr_vars/default_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${PLAY_AUDIO}" = ""]?Set(PLAY_AUDIO=custom/banrearreglado))\n`;
  dialplanContent += ` same => n,Set(PLAY_AUDIO=\${STRREPLACE(PLAY_AUDIO,.wav,)})\n`;
  dialplanContent += ` same => n,Set(PLAY_AUDIO=\${STRREPLACE(PLAY_AUDIO,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(PLAY_AUDIO=\${STRREPLACE(PLAY_AUDIO,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(PLAY_AUDIO=\${STRREPLACE(PLAY_AUDIO,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(PLAY_AUDIO=\${STRREPLACE(PLAY_AUDIO,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(PLAY_AUDIO=\${STRREPLACE(PLAY_AUDIO,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${PLAY_AUDIO}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${PLAY_AUDIO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${PLAY_AUDIO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${PLAY_AUDIO}.ulaw)} = 0]?Set(PLAY_AUDIO=custom/banrearreglado))\n`;
  dialplanContent += ` same => n,NoOp(=== [1-CLICK AUDIO+AGENT] Reproduciendo intro: \${PLAY_AUDIO} ===)\n`;
  dialplanContent += ` same => n,Playback(\${PLAY_AUDIO})\n`;
  dialplanContent += ` same => n,Wait(0.5)\n`;
  dialplanContent += ` same => n,Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != ""]?\${IVR_AGENT_EXTEN}:\${DB(ivr_vars/\${TARGET_DEST}_agent_exten)})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,NoOp(=== [1-CLICK AUDIO+AGENT] Conectando con Asesor: \${FINAL_AGENT} (Cliente: \${TARGET_DEST}) ===)\n`;
  dialplanContent += ` same => n,Set(CALLERID(pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(name-pres)=allowed_not_screened)\n`;
  dialplanContent += ` same => n,Set(CALLERID(num)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CALLERID(name)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CALLERID(all)="\${TARGET_DEST}" <\${TARGET_DEST}>)\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(num,i)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(name,i)=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(CONNECTEDLINE(all,i)="\${TARGET_DEST}" <\${TARGET_DEST}>)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_DEST})=talking_agent)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_DEST})}&status=talking_agent&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,Set(DIAL_AGENTS=\${IF($["\${FINAL_AGENT}" = "ringall" | "\${FINAL_AGENT}" = "all" | "\${FINAL_AGENT}" = "hunt"]?\${GLOBAL_RINGALL_EXTENSIONS}:PJSIP/\${STRREPLACE(FINAL_AGENT,&,&PJSIP/)})})\n`;
  dialplanContent += ` same => n,Dial(\${DIAL_AGENTS},60,Ttb(sub-audio-quality^s^1(\${TARGET_DEST}))U(sub-record-picked-agent^\${TARGET_DEST}^\${CALLERID(num)}))\n`;
  dialplanContent += ` same => n,GotoIf($["\${DIALSTATUS}" = "CHANUNAVAIL" | "\${DIALSTATUS}" = "CONGESTION"]?ata_agent_retry:ata_finish)\n`;
  dialplanContent += ` same => n(ata_agent_retry),Wait(1.2)\n`;
  dialplanContent += ` same => n,Dial(\${GLOBAL_RINGALL_EXTENSIONS},30,Ttb(sub-audio-quality^s^1(\${TARGET_DEST}))U(sub-record-picked-agent^\${TARGET_DEST}^\${CALLERID(num)}))\n`;
  dialplanContent += ` same => n(ata_finish),Hangup()\n`;
  dialplanContent += ` same => n(amd_machine_ata),NoOp(=== [AMD-OPERADORA] Contestador detectado en \${TARGET_DEST} -> Colgando ===)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_DEST})=machine_detected)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_DEST})}&status=machine_detected&cause=\${URIENCODE(\${AMDCAUSE})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AUTO_RETRY}" != "1"]?no_retry_amd_ata)\n`;
  dialplanContent += ` same => n,GotoIf($["\${DB(call_status/\${TARGET_DEST})}" = "operator_hangup" | "\${DB(call_status/\${TARGET_DEST})}" = "ended" | "\${DB(ivr_vars/\${TARGET_DEST}_cancelled)}" = "1"]?no_retry_amd_ata)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/retry?number=\${URIENCODE(\${TARGET_DEST})}&cause=\${URIENCODE(\${AMDCAUSE})}" &)\n`;
  dialplanContent += ` same => n(no_retry_amd_ata),NoOp(=== [AMD RETRY OMITIDO] Reintento no autorizado o llamada finalizada ===)\n`;
  dialplanContent += ` same => n,Hangup()\n`;
  dialplanContent += `exten => h,1,NoOp(=== [1-CLICK AUDIO+AGENT HANGUP] Canal: \${CHANNEL} | Causa: \${HANGUPCAUSE} | AMD=\${AMDSTATUS} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${DB(call_status/\${TARGET_NUM})}" = "machine_detected" | $["\${AMDSTATUS}" = "MACHINE" & "\${AMDCAUSE:0:14}" != "INITIALSILENCE"]]?h_keep_machine_ata)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=ended&cause=\${URIENCODE(\${HANGUPCAUSE})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&mode=\${URIENCODE(\${IVR_MODE})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n(h_keep_machine_ata),NoOp()\n\n`;

  dialplanContent += `; ========================================================\n`;
  dialplanContent += `; CONTEXTO PRESS-1 + CODIGO DE CANCELACION (VALIDACION POR AGENTE: VALIDO / INVALIDO)\n`;
  dialplanContent += `; ========================================================\n`;
  dialplanContent += `[ivr-press1-cancel]\n`;
  dialplanContent += `exten => s,1,NoOp(=== [IVR-PRESS1-CANCEL] INICIO FLUJO PRESS 1 + CODIGO DE CANCELACION ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Playback(custom/rtp_prime)\n`;
  dialplanContent += ` same => n,Set(ANSWER_EPOCH=\${EPOCH})\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_NUM}" != ""]?\${TARGET_NUM}:\${IF($["\${CUSTOMER_NUM}" != ""]?\${CUSTOMER_NUM}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})})})\n`;
  dialplanContent += ` same => n,Set(__TARGET_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CUSTOMER_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__TARGET_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(AMD_ACTIVE=\${DB(ivr_vars/amd_enabled)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AMD_ENABLED}" != ""]?Set(AMD_ACTIVE=\${AMD_ENABLED}))\n`;
  dialplanContent += ` same => n,GotoIf($["\${IS_TEST_CALL}" = "1" | \${LEN(\${TARGET_DEST})} <= 4 | "\${AMD_ACTIVE}" = "0" | "\${AMD_ACTIVE}" = "disabled" | "\${AMD_ACTIVE}" = "off" | "\${AMD_ACTIVE}" = ""]?skip_amd_p1c)\n`;
  dialplanContent += ` same => n,NoOp(=== [AMD-DETECTION] Analizando llamada hacia \${TARGET_DEST} ===)\n`;
  dialplanContent += ` same => n,AMD(2000,1500,800,4500,100,50,4,256,5000)\n`;
  dialplanContent += ` same => n,NoOp(=== [AMD-DETECTION] Destino: \${TARGET_DEST} | AMDSTATUS=\${AMDSTATUS} | AMDCAUSE=\${AMDCAUSE} ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AMDSTATUS}" = "MACHINE" & "\${AMDCAUSE:0:14}" = "INITIALSILENCE"]?amd_silence_human_p1c)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AMDSTATUS}" = "MACHINE"]?amd_machine_p1c)\n`;
  dialplanContent += ` same => n,Goto(amd_ok_p1c)\n`;
  dialplanContent += ` same => n(amd_silence_human_p1c),NoOp(=== [AMD-SILENCIO-INICIAL] Silencio inicial (\${AMDCAUSE}) permitido en IVR Cancelacion (solo avanza con tecla 1) ===)\n`;
  dialplanContent += ` same => n(amd_ok_p1c),Goto(ivr_ready_p1c)\n`;
  dialplanContent += ` same => n(skip_amd_p1c),Wait(0.3)\n`;
  dialplanContent += ` same => n(ivr_ready_p1c),Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != "" & "\${IVR_AGENT_EXTEN}" != "ringall" & "\${IVR_AGENT_EXTEN}" != "all"]?\${IVR_AGENT_EXTEN}:\${CALLING_AGENT})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" & "\${CHANNEL(channeltype)}" = "PJSIP"]?Set(FINAL_AGENT=\${CHANNEL(endpoint)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_DEST})=in_ivr)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=waiting_press1)\n`;
  dialplanContent += ` same => n,Set(DB(cancel_send/\${TARGET_DEST})=waiting_press1)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_DEST})}&status=in_ivr&mode=cancel_code&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,UserEvent(CallAnswered,Number=\${TARGET_DEST},Context=ivr-press1-cancel,Channel=\${CHANNEL})\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(digit)=1)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(response)=6)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(absolute)=240)\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${CALL_INTRO})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_INTRO=\${DB(ivr_vars/tenant_\${TENANT_ID}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/agent_\${FINAL_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/\${FINAL_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/agent_\${CALLING_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/\${CALLING_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/\${TARGET_DEST}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/8888_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/default_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/global_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${GLOBAL_DEFAULT_INTRO}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=custom/bienvenida_press1))\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_WAIT=\${CALL_CANCEL_WAIT})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_CANCEL_WAIT}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_CANCEL_WAIT=\${DB(ivr_vars/tenant_\${TENANT_ID}_cancel_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_CANCEL_WAIT}" = ""]?Set(IVR_CANCEL_WAIT=\${DB(ivr_vars/agent_\${FINAL_AGENT}_cancel_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_CANCEL_WAIT}" = ""]?Set(IVR_CANCEL_WAIT=\${DB(ivr_vars/agent_\${CALLING_AGENT}_cancel_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_CANCEL_WAIT}" = ""]?Set(IVR_CANCEL_WAIT=\${DB(ivr_vars/\${TARGET_DEST}_cancel_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_CANCEL_WAIT}" = ""]?Set(IVR_CANCEL_WAIT=\${DB(ivr_vars/8888_cancel_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_CANCEL_WAIT}" = ""]?Set(IVR_CANCEL_WAIT=\${DB(ivr_vars/default_cancel_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_CANCEL_WAIT}" = ""]?Set(IVR_CANCEL_WAIT=custom/enviando_codigo_cancelacion))\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_PROMPT=\${CALL_PROMPT})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_CANCEL_PROMPT}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_CANCEL_PROMPT=\${DB(ivr_vars/tenant_\${TENANT_ID}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_CANCEL_PROMPT}" = ""]?Set(IVR_CANCEL_PROMPT=\${DB(ivr_vars/agent_\${FINAL_AGENT}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_CANCEL_PROMPT}" = ""]?Set(IVR_CANCEL_PROMPT=\${DB(ivr_vars/agent_\${CALLING_AGENT}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_CANCEL_PROMPT}" = ""]?Set(IVR_CANCEL_PROMPT=\${DB(ivr_vars/\${TARGET_DEST}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_CANCEL_PROMPT}" = ""]?Set(IVR_CANCEL_PROMPT=\${DB(ivr_vars/8888_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_CANCEL_PROMPT}" = ""]?Set(IVR_CANCEL_PROMPT=\${DB(ivr_vars/default_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_CANCEL_PROMPT}" = ""]?Set(IVR_CANCEL_PROMPT=custom/digite_codigo_cancelacion))\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${CALL_WAIT})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_WAIT=\${DB(ivr_vars/tenant_\${TENANT_ID}_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/agent_\${FINAL_AGENT}_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/\${FINAL_AGENT}_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/agent_\${CALLING_AGENT}_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/\${TARGET_DEST}_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/8888_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/default_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/global_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${GLOBAL_DEFAULT_WAIT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=custom/un_momento_validando_informacion))\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${CALL_SUCCESS})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/tenant_\${TENANT_ID}_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/agent_\${FINAL_AGENT}_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/agent_\${CALLING_AGENT}_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/\${TARGET_DEST}_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/default_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=custom/operacion_cancelada_exito))\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${DB(ivr_vars/agent_\${FINAL_AGENT}_failure)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_FAILURE}" = ""]?Set(IVR_FAILURE=\${DB(ivr_vars/agent_\${CALLING_AGENT}_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_FAILURE}" = ""]?Set(IVR_FAILURE=\${DB(ivr_vars/default_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_FAILURE}" = ""]?Set(IVR_FAILURE=custom/token_invalido_reintente))\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_INTRO}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_INTRO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_INTRO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_INTRO}.ulaw)} = 0]?Set(IVR_INTRO=custom/bienvenida_press1))\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_INTRO}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_INTRO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_INTRO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_INTRO}.ulaw)} = 0]?Set(IVR_INTRO=custom/bienvenida_corporativa))\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_WAIT=\${STRREPLACE(IVR_CANCEL_WAIT,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_WAIT=\${STRREPLACE(IVR_CANCEL_WAIT,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_WAIT=\${STRREPLACE(IVR_CANCEL_WAIT,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_WAIT=\${STRREPLACE(IVR_CANCEL_WAIT,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_WAIT=\${STRREPLACE(IVR_CANCEL_WAIT,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_WAIT=\${STRREPLACE(IVR_CANCEL_WAIT,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_WAIT=\${STRREPLACE(IVR_CANCEL_WAIT,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_CANCEL_WAIT}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_CANCEL_WAIT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_CANCEL_WAIT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_CANCEL_WAIT}.ulaw)} = 0]?Set(IVR_CANCEL_WAIT=custom/enviando_codigo_cancelacion))\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_PROMPT=\${STRREPLACE(IVR_CANCEL_PROMPT,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_PROMPT=\${STRREPLACE(IVR_CANCEL_PROMPT,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_PROMPT=\${STRREPLACE(IVR_CANCEL_PROMPT,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_PROMPT=\${STRREPLACE(IVR_CANCEL_PROMPT,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_PROMPT=\${STRREPLACE(IVR_CANCEL_PROMPT,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_PROMPT=\${STRREPLACE(IVR_CANCEL_PROMPT,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_CANCEL_PROMPT=\${STRREPLACE(IVR_CANCEL_PROMPT,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_CANCEL_PROMPT}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_CANCEL_PROMPT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_CANCEL_PROMPT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_CANCEL_PROMPT}.ulaw)} = 0]?Set(IVR_CANCEL_PROMPT=custom/digite_codigo_cancelacion))\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_WAIT}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_WAIT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_WAIT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_WAIT}.ulaw)} = 0]?Set(IVR_WAIT=custom/un_momento_validando_informacion))\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_SUCCESS}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_SUCCESS}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_SUCCESS}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_SUCCESS}.ulaw)} = 0]?Set(IVR_SUCCESS=custom/operacion_cancelada_exito))\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_FAILURE}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_FAILURE}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_FAILURE}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_FAILURE}.ulaw)} = 0]?Set(IVR_FAILURE=custom/token_invalido_reintente))\n`;
  dialplanContent += ` same => n,Set(INTRO_TRIES=0)\n`;
  dialplanContent += ` same => n(menu),Set(INTRO_TRIES=$[\${INTRO_TRIES} + 1])\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR-PRESS1-CANCEL] Reproduciendo saludo (\${INTRO_TRIES}/2): \${IVR_INTRO} ===)\n`;
  dialplanContent += ` same => n,Background(\${IVR_INTRO})\n`;
  dialplanContent += ` same => n,WaitExten(6)\n`;
  dialplanContent += ` same => n,GotoIf($[\${INTRO_TRIES} < 2]?menu)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(amd_machine_p1c),NoOp(=== [AMD-OPERADORA] Contestador detectado en \${TARGET_DEST} -> Colgando ===)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_DEST})=machine_detected)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_DEST})}&status=machine_detected&cause=\${URIENCODE(\${AMDCAUSE})}&mode=cancel_code&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AUTO_RETRY}" != "1"]?no_retry_amd_p1c)\n`;
  dialplanContent += ` same => n,GotoIf($["\${DB(call_status/\${TARGET_DEST})}" = "operator_hangup" | "\${DB(call_status/\${TARGET_DEST})}" = "ended" | "\${DB(ivr_vars/\${TARGET_DEST}_cancelled)}" = "1"]?no_retry_amd_p1c)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/retry?number=\${URIENCODE(\${TARGET_DEST})}&cause=\${URIENCODE(\${AMDCAUSE})}" &)\n`;
  dialplanContent += ` same => n(no_retry_amd_p1c),NoOp(=== [AMD RETRY OMITIDO] Reintento no autorizado o llamada finalizada ===)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `; CLIENTE MARCA 1 -> REPRODUCE "UN MOMENTO POR FAVOR, LE ESTAMOS ENVIANDO UN CODIGO DE CANCELACION", AVISA AL AGENTE Y ESPERA HASTA QUE EL AGENTE ENVIE EL CODIGO\n`;
  dialplanContent += `exten => 1,1,NoOp(=== [IVR-PRESS1-CANCEL] DIGITO 1 DETECTADO -> AVISANDO AL AGENTE PARA QUE ENVIE EL CODIGO ===)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(digit)=3)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(response)=12)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_NUM}" != ""]?\${TARGET_NUM}:\${IF($["\${CUSTOMER_NUM}" != ""]?\${CUSTOMER_NUM}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})})})\n`;
  dialplanContent += ` same => n,Set(__TARGET_NUM=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(__TARGET_DEST=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(__CUSTOMER_NUM=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=pressed_1)\n`;
  dialplanContent += ` same => n,Set(DB(call_digit/\${TARGET_NUM})=1)\n`;
  dialplanContent += ` same => n,Set(DB(cancel_send/\${TARGET_NUM})=waiting_agent)\n`;
  dialplanContent += ` same => n,Set(DB(cancel_send/\${TARGET_NUM}_\${FINAL_AGENT})=waiting_agent)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM}_\${FINAL_AGENT})=pending)\n`;
  dialplanContent += ` same => n,UserEvent(Press1Detected,Number=\${TARGET_NUM},Digit=1,Mode=cancel_code,Channel=\${CHANNEL})\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=pressed_1&digit=1&mode=cancel_code&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,Playback(\${IVR_CANCEL_WAIT})\n`;
  dialplanContent += ` same => n,Set(SEND_WAIT_LOOP=0)\n`;
  dialplanContent += ` same => n(wait_agent_send_code),Set(SEND_WAIT_LOOP=$[\${SEND_WAIT_LOOP} + 1])\n`;
  dialplanContent += ` same => n,Set(RAW_SEND_FLAG=\${DB(cancel_send/\${TARGET_NUM}_\${FINAL_AGENT})})\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_SEND_FLAG}" = ""] | $["\${RAW_SEND_FLAG}" = "waiting_agent"] | $["\${RAW_SEND_FLAG}" = "waiting_press1"]]?Set(RAW_SEND_FLAG=\${DB(cancel_send/\${TARGET_NUM})}))\n`;
  dialplanContent += ` same => n,Set(CLEAN_SEND_FLAG=\${TOLOWER(\${FILTER(abcdefghijklmnopqrstuvwxyz_,\${RAW_SEND_FLAG})})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${CLEAN_SEND_FLAG}" = "send_now"]?agent_ready_ask_code)\n`;
  dialplanContent += ` same => n,Set(PRE_STATUS=\${TOLOWER(\${FILTER(abcdefghijklmnopqrstuvwxyz,\${DB(otp_status/\${TARGET_NUM})})})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${PRE_STATUS}" = "valid"]?cancel_approved)\n`;
  dialplanContent += ` same => n,GotoIf($["\${PRE_STATUS}" = "invalid"]?cancel_rejected)\n`;
  dialplanContent += ` same => n,GotoIf($[\${SEND_WAIT_LOOP} >= 120]?agent_ready_ask_code)\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Goto(wait_agent_send_code)\n`;
  dialplanContent += ` same => n(agent_ready_ask_code),NoOp(=== [IVR-PRESS1-CANCEL] Agente envio el codigo -> Solicitando al cliente que lo digite ===)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=asking_cancel_code)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=asking_cancel_code&mode=cancel_code&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,Set(CANCEL_RETRIES=0)\n`;
  dialplanContent += ` same => n(ask_cancel_code),Set(CANCEL_RETRIES=$[\${CANCEL_RETRIES} + 1])\n`;
  dialplanContent += ` same => n,Set(USER_DIGITS=)\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR-PRESS1-CANCEL] Solicitando codigo de cancelacion (\${CANCEL_RETRIES}/3) con audio: \${IVR_CANCEL_PROMPT} ===)\n`;
  dialplanContent += ` same => n,Read(USER_DIGITS,\${IVR_CANCEL_PROMPT},10,,1,12)\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR-PRESS1-CANCEL] Resultado Read 1: READSTATUS=\${READSTATUS} | USER_DIGITS=\${USER_DIGITS} ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${USER_DIGITS}" != ""]?cancel_code_captured)\n`;
  dialplanContent += ` same => n,Set(MID_STATUS=\${TOLOWER(\${FILTER(abcdefghijklmnopqrstuvwxyz,\${DB(otp_status/\${TARGET_NUM})})})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${MID_STATUS}" = "valid"]?cancel_approved)\n`;
  dialplanContent += ` same => n,GotoIf($["\${MID_STATUS}" = "invalid"]?cancel_rejected)\n`;
  dialplanContent += ` same => n,GotoIf($[\${CANCEL_RETRIES} < 3]?ask_cancel_code)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(cancel_code_captured),NoOp(=== [IVR-PRESS1-CANCEL] CODIGO DE CANCELACION DIGITADO: \${USER_DIGITS} -> ENVIANDO A AGENTE \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(CID_DIGITS=\${FILTER(0-9,\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,Set(DB(otp_agent/\${TARGET_NUM})=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(otp_codes/\${TARGET_NUM})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/\${TARGET_NUM})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM}_\${FINAL_AGENT})=pending)\n`;
  dialplanContent += ` same => n,ExecIf($["\${CID_DIGITS}" != "" & "\${CID_DIGITS}" != "\${TARGET_NUM}"]?Set(DB(otp_status/\${CID_DIGITS})=pending))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLERID(num)}" != "" & "\${CALLERID(num)}" != "\${TARGET_NUM}"]?Set(DB(otp_agent/\${CALLERID(num)})=\${FINAL_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLERID(num)}" != "" & "\${CALLERID(num)}" != "\${TARGET_NUM}"]?Set(DB(otp_codes/\${CALLERID(num)})=\${USER_DIGITS}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLERID(num)}" != "" & "\${CALLERID(num)}" != "\${TARGET_NUM}"]?Set(DB(otp_status/\${CALLERID(num)})=pending))\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_capture)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,UserEvent(OTPCaptured,Number=\${TARGET_NUM},Digits=\${USER_DIGITS},Status=pending,Mode=cancel_code,Agent=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/otp/capture?number=\${URIENCODE(\${TARGET_NUM})}&callerid=\${URIENCODE(\${CALLERID(num)})}&otp=\${URIENCODE(\${USER_DIGITS})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenantId=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&service=C%C3%B3digo%20Cancelaci%C3%B3n&channel=\${URIENCODE(\${CHANNEL})}&status=pending" &)\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR-PRESS1-CANCEL] Reproduciendo audio de validacion en curso: \${IVR_WAIT} ===)\n`;
  dialplanContent += ` same => n,Playback(\${IVR_WAIT})\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Set(WAIT_LOOP=0)\n`;
  dialplanContent += ` same => n(wait_cancel_decision),Set(WAIT_LOOP=$[\${WAIT_LOOP} + 1])\n`;
  dialplanContent += ` same => n,Set(RAW_C_STATUS=\${DB(otp_status/\${TARGET_NUM}_\${FINAL_AGENT})})\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_C_STATUS}" = ""] | $["\${RAW_C_STATUS}" = "pending"]]?Set(RAW_C_STATUS=\${DB(otp_status/\${TARGET_NUM})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_C_STATUS}" = ""] | $["\${RAW_C_STATUS}" = "pending"]]?Set(RAW_C_STATUS=\${DB(otp_status/\${CID_DIGITS})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_C_STATUS}" = ""] | $["\${RAW_C_STATUS}" = "pending"]]?Set(RAW_C_STATUS=\${DB(otp_status/\${USER_DIGITS})}))\n`;
  dialplanContent += ` same => n,Set(CURRENT_STATUS=\${TOLOWER(\${FILTER(abcdefghijklmnopqrstuvwxyz,\${RAW_C_STATUS})})})\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR-PRESS1-CANCEL] Esperando decision agente \${WAIT_LOOP}/90 - Estado: \${CURRENT_STATUS} ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "valid"]?cancel_approved)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "invalid"]?cancel_rejected)\n`;
  dialplanContent += ` same => n,GotoIf($[\${WAIT_LOOP} >= 90]?cancel_timeout)\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Goto(wait_cancel_decision)\n\n`;
  dialplanContent += ` same => n(cancel_approved),NoOp(=== [IVR-PRESS1-CANCEL] CODIGO VALIDO APROBADO POR AGENTE ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM}_\${FINAL_AGENT})=done)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=cancel_valid)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=cancel_valid&mode=cancel_code&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,Playback(\${IVR_SUCCESS})\n`;
  dialplanContent += ` same => n,Wait(0.5)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(cancel_rejected),NoOp(=== [IVR-PRESS1-CANCEL] CODIGO INVALIDO RECHAZADO POR AGENTE -> REINTENTANDO ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM}_\${FINAL_AGENT})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=cancel_invalid)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=cancel_invalid&mode=cancel_code&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,Playback(\${IVR_FAILURE})\n`;
  dialplanContent += ` same => n,Goto(ask_cancel_code)\n\n`;
  dialplanContent += ` same => n(cancel_timeout),Playback(custom/intentos_superados)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += `exten => i,1,NoOp(=== [IVR-PRESS1-CANCEL] Tecla no valida (\${EXTEN}) -> Esperando tecla 1 ===)\n`;
  dialplanContent += ` same => n,Goto(s,menu)\n`;
  dialplanContent += `exten => t,1,GotoIf($[\${INTRO_TRIES} < 2]?s,menu)\n`;
  dialplanContent += ` same => n,Hangup()\n`;
  dialplanContent += `exten => h,1,NoOp(=== [IVR-PRESS1-CANCEL HANGUP] Canal: \${CHANNEL} | Causa: \${HANGUPCAUSE} | AMD=\${AMDSTATUS} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${DB(call_status/\${TARGET_NUM})}" = "machine_detected" | $["\${AMDSTATUS}" = "MACHINE" & "\${AMDCAUSE:0:14}" != "INITIALSILENCE"]]?h_keep_machine_p1c)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=ended&cause=\${URIENCODE(\${HANGUPCAUSE})}&mode=cancel_code&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n(h_keep_machine_p1c),NoOp()\n\n`;

  dialplanContent += `; ========================================================\n`;
  dialplanContent += `; CONTEXTO IVR DE CAPTURA OTP (PRESS 1 -> AUDIO ESPERA -> CAPTURA Y VALIDACION EN VIVO)\n`;
  dialplanContent += `; ========================================================\n`;
  dialplanContent += `[ivr-otp-verify]\n`;
  dialplanContent += `exten => s,1,NoOp(=== [IVR-OTP-VERIFY] INICIO FLUJO IVR DE CAPTURA OTP (PRESS 1 + VERIFICACION) ===)\n`;
  dialplanContent += ` same => n,Answer()\n`;
  dialplanContent += ` same => n,Playback(custom/rtp_prime)\n`;
  dialplanContent += ` same => n,Set(ANSWER_EPOCH=\${EPOCH})\n`;
  dialplanContent += ` same => n,Set(TARGET_DEST=\${IF($["\${TARGET_NUM}" != ""]?\${TARGET_NUM}:\${IF($["\${CUSTOMER_NUM}" != ""]?\${CUSTOMER_NUM}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})})})\n`;
  dialplanContent += ` same => n,Set(__TARGET_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CUSTOMER_NUM=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__TARGET_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${TARGET_DEST})\n`;
  dialplanContent += ` same => n,Set(AMD_ACTIVE=\${DB(ivr_vars/amd_enabled)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${AMD_ENABLED}" != ""]?Set(AMD_ACTIVE=\${AMD_ENABLED}))\n`;
  dialplanContent += ` same => n,GotoIf($["\${IS_TEST_CALL}" = "1" | \${LEN(\${TARGET_DEST})} <= 4 | "\${AMD_ACTIVE}" = "0" | "\${AMD_ACTIVE}" = "disabled" | "\${AMD_ACTIVE}" = "off" | "\${AMD_ACTIVE}" = ""]?skip_amd_otp_v)\n`;
  dialplanContent += ` same => n,NoOp(=== [AMD-DETECTION] Analizando llamada IVR Captura OTP hacia \${TARGET_DEST} ===)\n`;
  dialplanContent += ` same => n,AMD(2000,1500,800,4500,100,50,4,256,5000)\n`;
  dialplanContent += ` same => n,NoOp(=== [AMD-DETECTION] Destino: \${TARGET_DEST} | AMDSTATUS=\${AMDSTATUS} | AMDCAUSE=\${AMDCAUSE} ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AMDSTATUS}" = "MACHINE" & "\${AMDCAUSE:0:14}" = "INITIALSILENCE"]?amd_silence_human_otp_v)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AMDSTATUS}" = "MACHINE"]?amd_machine_otp_v)\n`;
  dialplanContent += ` same => n,Goto(amd_ok_otp_v)\n`;
  dialplanContent += ` same => n(amd_silence_human_otp_v),NoOp(=== [AMD-SILENCIO-INICIAL] Silencio inicial (\${AMDCAUSE}) permitido en IVR Captura OTP (solo avanza con tecla 1) ===)\n`;
  dialplanContent += ` same => n(amd_ok_otp_v),Goto(ivr_ready_otp_v)\n`;
  dialplanContent += ` same => n(skip_amd_otp_v),Wait(0.3)\n`;
  dialplanContent += ` same => n(ivr_ready_otp_v),Set(FINAL_AGENT=\${IF($["\${IVR_AGENT_EXTEN}" != "" & "\${IVR_AGENT_EXTEN}" != "ringall" & "\${IVR_AGENT_EXTEN}" != "all"]?\${IVR_AGENT_EXTEN}:\${CALLING_AGENT})})\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = "" & "\${CHANNEL(channeltype)}" = "PJSIP"]?Set(FINAL_AGENT=\${CHANNEL(endpoint)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/\${TARGET_DEST}_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=\${DB(ivr_vars/global_agent_exten)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${FINAL_AGENT}" = ""]?Set(FINAL_AGENT=1001))\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_DEST})=in_ivr)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_DEST})=waiting_press1)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_DEST})}&status=in_ivr&mode=otp_press1&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,UserEvent(CallAnswered,Number=\${TARGET_DEST},Context=ivr-otp-verify,Channel=\${CHANNEL})\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(digit)=1)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(response)=6)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(absolute)=240)\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${CALL_INTRO})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_INTRO=\${DB(ivr_vars/tenant_\${TENANT_ID}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/agent_\${FINAL_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/\${FINAL_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/agent_\${CALLING_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/\${CALLING_AGENT}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/\${TARGET_DEST}_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/8888_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/default_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${DB(ivr_vars/global_intro)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=\${GLOBAL_DEFAULT_INTRO}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_INTRO}" = ""]?Set(IVR_INTRO=custom/bienvenida_press1))\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_VERIFY_WAIT=\${CALL_OTP_VERIFY_WAIT})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_OTP_VERIFY_WAIT}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_OTP_VERIFY_WAIT=\${DB(ivr_vars/tenant_\${TENANT_ID}_otp_verify_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_OTP_VERIFY_WAIT}" = ""]?Set(IVR_OTP_VERIFY_WAIT=\${DB(ivr_vars/agent_\${FINAL_AGENT}_otp_verify_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_OTP_VERIFY_WAIT}" = ""]?Set(IVR_OTP_VERIFY_WAIT=\${DB(ivr_vars/agent_\${CALLING_AGENT}_otp_verify_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_OTP_VERIFY_WAIT}" = ""]?Set(IVR_OTP_VERIFY_WAIT=\${DB(ivr_vars/\${TARGET_DEST}_otp_verify_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_OTP_VERIFY_WAIT}" = ""]?Set(IVR_OTP_VERIFY_WAIT=\${DB(ivr_vars/8888_otp_verify_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_OTP_VERIFY_WAIT}" = ""]?Set(IVR_OTP_VERIFY_WAIT=\${DB(ivr_vars/default_otp_verify_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_OTP_VERIFY_WAIT}" = ""]?Set(IVR_OTP_VERIFY_WAIT=custom/enviando_codigo_verificacion))\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_PROMPT=\${CALL_PROMPT})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_OTP_PROMPT}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_OTP_PROMPT=\${DB(ivr_vars/tenant_\${TENANT_ID}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_OTP_PROMPT}" = ""]?Set(IVR_OTP_PROMPT=\${DB(ivr_vars/agent_\${FINAL_AGENT}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_OTP_PROMPT}" = ""]?Set(IVR_OTP_PROMPT=\${DB(ivr_vars/agent_\${CALLING_AGENT}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_OTP_PROMPT}" = ""]?Set(IVR_OTP_PROMPT=\${DB(ivr_vars/\${TARGET_DEST}_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_OTP_PROMPT}" = ""]?Set(IVR_OTP_PROMPT=\${DB(ivr_vars/8888_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_OTP_PROMPT}" = ""]?Set(IVR_OTP_PROMPT=\${DB(ivr_vars/default_prompt)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_OTP_PROMPT}" = ""]?Set(IVR_OTP_PROMPT=custom/digite_codigo_verificacion))\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${CALL_WAIT})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_WAIT=\${DB(ivr_vars/tenant_\${TENANT_ID}_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/agent_\${FINAL_AGENT}_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/\${FINAL_AGENT}_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/agent_\${CALLING_AGENT}_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/\${TARGET_DEST}_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/8888_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/default_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${DB(ivr_vars/global_wait)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=\${GLOBAL_DEFAULT_WAIT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_WAIT}" = ""]?Set(IVR_WAIT=custom/un_momento_validando_informacion))\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${CALL_SUCCESS})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = "" & "\${TENANT_ID}" != ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/tenant_\${TENANT_ID}_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/agent_\${FINAL_AGENT}_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/agent_\${CALLING_AGENT}_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/\${TARGET_DEST}_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=\${DB(ivr_vars/default_success)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_SUCCESS}" = ""]?Set(IVR_SUCCESS=custom/otp_validado_exito))\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${DB(ivr_vars/agent_\${FINAL_AGENT}_failure)})\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_FAILURE}" = ""]?Set(IVR_FAILURE=\${DB(ivr_vars/agent_\${CALLING_AGENT}_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_FAILURE}" = ""]?Set(IVR_FAILURE=\${DB(ivr_vars/default_failure)}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${IVR_FAILURE}" = ""]?Set(IVR_FAILURE=custom/token_invalido_reintente))\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_INTRO=\${STRREPLACE(IVR_INTRO,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_INTRO}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_INTRO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_INTRO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_INTRO}.ulaw)} = 0]?Set(IVR_INTRO=custom/bienvenida_press1))\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_INTRO}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_INTRO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_INTRO}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_INTRO}.ulaw)} = 0]?Set(IVR_INTRO=custom/bienvenida_corporativa))\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_VERIFY_WAIT=\${STRREPLACE(IVR_OTP_VERIFY_WAIT,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_VERIFY_WAIT=\${STRREPLACE(IVR_OTP_VERIFY_WAIT,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_VERIFY_WAIT=\${STRREPLACE(IVR_OTP_VERIFY_WAIT,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_VERIFY_WAIT=\${STRREPLACE(IVR_OTP_VERIFY_WAIT,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_VERIFY_WAIT=\${STRREPLACE(IVR_OTP_VERIFY_WAIT,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_VERIFY_WAIT=\${STRREPLACE(IVR_OTP_VERIFY_WAIT,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_VERIFY_WAIT=\${STRREPLACE(IVR_OTP_VERIFY_WAIT,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_OTP_VERIFY_WAIT}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_OTP_VERIFY_WAIT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_OTP_VERIFY_WAIT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_OTP_VERIFY_WAIT}.ulaw)} = 0]?Set(IVR_OTP_VERIFY_WAIT=custom/enviando_codigo_verificacion))\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_PROMPT=\${STRREPLACE(IVR_OTP_PROMPT,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_PROMPT=\${STRREPLACE(IVR_OTP_PROMPT,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_PROMPT=\${STRREPLACE(IVR_OTP_PROMPT,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_PROMPT=\${STRREPLACE(IVR_OTP_PROMPT,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_PROMPT=\${STRREPLACE(IVR_OTP_PROMPT,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_PROMPT=\${STRREPLACE(IVR_OTP_PROMPT,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_OTP_PROMPT=\${STRREPLACE(IVR_OTP_PROMPT,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_OTP_PROMPT}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_OTP_PROMPT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_OTP_PROMPT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_OTP_PROMPT}.ulaw)} = 0]?Set(IVR_OTP_PROMPT=custom/digite_codigo_verificacion))\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_WAIT=\${STRREPLACE(IVR_WAIT,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_WAIT}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_WAIT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_WAIT}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_WAIT}.ulaw)} = 0]?Set(IVR_WAIT=custom/un_momento_validando_informacion))\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_SUCCESS=\${STRREPLACE(IVR_SUCCESS,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_SUCCESS}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_SUCCESS}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_SUCCESS}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_SUCCESS}.ulaw)} = 0]?Set(IVR_SUCCESS=custom/otp_validado_exito))\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,.wav,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,.ulaw,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,/var/lib/asterisk/sounds/es/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,/var/lib/asterisk/sounds/en/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,/var/lib/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,/usr/share/asterisk/sounds/,)})\n`;
  dialplanContent += ` same => n,Set(IVR_FAILURE=\${STRREPLACE(IVR_FAILURE,custom/custom/,custom/)})\n`;
  dialplanContent += ` same => n,ExecIf($[\${STAT(e,/var/lib/asterisk/sounds/\${IVR_FAILURE}.ulaw)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/\${IVR_FAILURE}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_FAILURE}.wav)} = 0 & \${STAT(e,/var/lib/asterisk/sounds/es/\${IVR_FAILURE}.ulaw)} = 0]?Set(IVR_FAILURE=custom/token_invalido_reintente))\n`;
  dialplanContent += ` same => n,Set(INTRO_TRIES=0)\n`;
  dialplanContent += ` same => n(menu),Set(INTRO_TRIES=$[\${INTRO_TRIES} + 1])\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR-OTP-VERIFY] Reproduciendo saludo (\${INTRO_TRIES}/2): \${IVR_INTRO} ===)\n`;
  dialplanContent += ` same => n,Background(\${IVR_INTRO})\n`;
  dialplanContent += ` same => n,WaitExten(6)\n`;
  dialplanContent += ` same => n,GotoIf($[\${INTRO_TRIES} < 2]?menu)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(amd_machine_otp_v),NoOp(=== [AMD-OPERADORA] Contestador detectado en \${TARGET_DEST} -> Colgando ===)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_DEST})=machine_detected)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_DEST})}&status=machine_detected&cause=\${URIENCODE(\${AMDCAUSE})}&mode=otp_press1&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,GotoIf($["\${AUTO_RETRY}" != "1"]?no_retry_amd_otp_v)\n`;
  dialplanContent += ` same => n,GotoIf($["\${DB(call_status/\${TARGET_DEST})}" = "operator_hangup" | "\${DB(call_status/\${TARGET_DEST})}" = "ended" | "\${DB(ivr_vars/\${TARGET_DEST}_cancelled)}" = "1"]?no_retry_amd_otp_v)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/retry?number=\${URIENCODE(\${TARGET_DEST})}&cause=\${URIENCODE(\${AMDCAUSE})}" &)\n`;
  dialplanContent += ` same => n(no_retry_amd_otp_v),NoOp(=== [AMD RETRY OMITIDO] Reintento no autorizado o llamada finalizada ===)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;

  dialplanContent += `; CLIENTE PRESIONA 1 -> REPRODUCE "UN MOMENTO POR FAVOR, LE ESTAMOS ENVIANDO SU CODIGO DE VERIFICACION" -> CAPTURA Y VALIDACION EN LIVECALLSTAB\n`;
  dialplanContent += `exten => 1,1,NoOp(=== [IVR-OTP-VERIFY] DIGITO 1 DETECTADO -> ENVIANDO CODIGO DE VERIFICACION ===)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(digit)=3)\n`;
  dialplanContent += ` same => n,Set(TIMEOUT(response)=12)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_NUM}" != ""]?\${TARGET_NUM}:\${IF($["\${CUSTOMER_NUM}" != ""]?\${CUSTOMER_NUM}:\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})})})\n`;
  dialplanContent += ` same => n,Set(__TARGET_NUM=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(__TARGET_DEST=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(__CALL_DEST=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(__CUSTOMER_NUM=\${TARGET_NUM})\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=pressed_1)\n`;
  dialplanContent += ` same => n,Set(DB(call_digit/\${TARGET_NUM})=1)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM}_\${FINAL_AGENT})=pending)\n`;
  dialplanContent += ` same => n,UserEvent(Press1Detected,Number=\${TARGET_NUM},Digit=1,Mode=otp_press1,Channel=\${CHANNEL})\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=pressed_1&digit=1&mode=otp_press1&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,Playback(\${IVR_OTP_VERIFY_WAIT})\n`;
  dialplanContent += ` same => n,Wait(0.2)\n`;
  dialplanContent += ` same => n,Set(PRE_STATUS=\${TOLOWER(\${FILTER(abcdefghijklmnopqrstuvwxyz,\${DB(otp_status/\${TARGET_NUM})})})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${PRE_STATUS}" = "valid"]?otp_verify_approved)\n`;
  dialplanContent += ` same => n,GotoIf($["\${PRE_STATUS}" = "invalid"]?otp_verify_rejected)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=asking_otp)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=asking_otp&mode=otp_press1&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,Set(OTP_V_RETRIES=0)\n`;
  dialplanContent += ` same => n(ask_otp_verify),Set(OTP_V_RETRIES=$[\${OTP_V_RETRIES} + 1])\n`;
  dialplanContent += ` same => n,Set(USER_DIGITS=)\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR-OTP-VERIFY] Solicitando codigo OTP (\${OTP_V_RETRIES}/3) con audio: \${IVR_OTP_PROMPT} ===)\n`;
  dialplanContent += ` same => n,Read(USER_DIGITS,\${IVR_OTP_PROMPT},10,,1,12)\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR-OTP-VERIFY] Resultado Read: READSTATUS=\${READSTATUS} | USER_DIGITS=\${USER_DIGITS} ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${USER_DIGITS}" != ""]?otp_verify_captured)\n`;
  dialplanContent += ` same => n,Set(MID_STATUS=\${TOLOWER(\${FILTER(abcdefghijklmnopqrstuvwxyz,\${DB(otp_status/\${TARGET_NUM})})})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${MID_STATUS}" = "valid"]?otp_verify_approved)\n`;
  dialplanContent += ` same => n,GotoIf($["\${MID_STATUS}" = "invalid"]?otp_verify_rejected)\n`;
  dialplanContent += ` same => n,GotoIf($[\${OTP_V_RETRIES} < 3]?ask_otp_verify)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(otp_verify_captured),NoOp(=== [IVR-OTP-VERIFY] CODIGO OTP DIGITADO: \${USER_DIGITS} -> ENVIANDO A AGENTE \${FINAL_AGENT} ===)\n`;
  dialplanContent += ` same => n,Set(CID_DIGITS=\${FILTER(0-9,\${CALLERID(num)})})\n`;
  dialplanContent += ` same => n,Set(DB(otp_agent/\${TARGET_NUM})=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,Set(DB(otp_codes/\${TARGET_NUM})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_captures/\${TARGET_NUM})=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM}_\${FINAL_AGENT})=pending)\n`;
  dialplanContent += ` same => n,ExecIf($["\${CID_DIGITS}" != "" & "\${CID_DIGITS}" != "\${TARGET_NUM}"]?Set(DB(otp_status/\${CID_DIGITS})=pending))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CID_DIGITS}" != "" & "\${CID_DIGITS}" != "\${TARGET_NUM}"]?Set(DB(otp_status/\${CID_DIGITS}_\${FINAL_AGENT})=pending))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLERID(num)}" != "" & "\${CALLERID(num)}" != "\${TARGET_NUM}"]?Set(DB(otp_agent/\${CALLERID(num)})=\${FINAL_AGENT}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLERID(num)}" != "" & "\${CALLERID(num)}" != "\${TARGET_NUM}"]?Set(DB(otp_codes/\${CALLERID(num)})=\${USER_DIGITS}))\n`;
  dialplanContent += ` same => n,ExecIf($["\${CALLERID(num)}" != "" & "\${CALLERID(num)}" != "\${TARGET_NUM}"]?Set(DB(otp_status/\${CALLERID(num)})=pending))\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${USER_DIGITS})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_last_capture)=\${USER_DIGITS})\n`;
  dialplanContent += ` same => n,UserEvent(OTPCaptured,Number=\${TARGET_NUM},Digits=\${USER_DIGITS},Status=pending,Mode=otp_press1,Agent=\${FINAL_AGENT})\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/otp/capture?number=\${URIENCODE(\${TARGET_NUM})}&callerid=\${URIENCODE(\${CALLERID(num)})}&otp=\${URIENCODE(\${USER_DIGITS})}&agent=\${URIENCODE(\${FINAL_AGENT})}&tenantId=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&service=IVR%20Captura%20OTP&channel=\${URIENCODE(\${CHANNEL})}&status=pending" &)\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR-OTP-VERIFY] Reproduciendo audio de validacion en curso: \${IVR_WAIT} ===)\n`;
  dialplanContent += ` same => n,Playback(\${IVR_WAIT})\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Set(WAIT_LOOP=0)\n`;
  dialplanContent += ` same => n(wait_otp_verify_decision),Set(WAIT_LOOP=$[\${WAIT_LOOP} + 1])\n`;
  dialplanContent += ` same => n,Set(RAW_OV_STATUS=\${DB(otp_status/\${TARGET_NUM}_\${FINAL_AGENT})})\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_OV_STATUS}" = ""] | $["\${RAW_OV_STATUS}" = "pending"]]?Set(RAW_OV_STATUS=\${DB(otp_status/\${TARGET_NUM})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_OV_STATUS}" = ""] | $["\${RAW_OV_STATUS}" = "pending"]]?Set(RAW_OV_STATUS=\${DB(otp_status/\${CID_DIGITS})}))\n`;
  dialplanContent += ` same => n,ExecIf($[$["\${RAW_OV_STATUS}" = ""] | $["\${RAW_OV_STATUS}" = "pending"]]?Set(RAW_OV_STATUS=\${DB(otp_status/\${USER_DIGITS})}))\n`;
  dialplanContent += ` same => n,Set(CURRENT_STATUS=\${TOLOWER(\${FILTER(abcdefghijklmnopqrstuvwxyz,\${RAW_OV_STATUS})})})\n`;
  dialplanContent += ` same => n,NoOp(=== [IVR-OTP-VERIFY] Esperando decision agente \${WAIT_LOOP}/90 - Estado: \${CURRENT_STATUS} ===)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "valid"]?otp_verify_approved)\n`;
  dialplanContent += ` same => n,GotoIf($["\${CURRENT_STATUS}" = "invalid"]?otp_verify_rejected)\n`;
  dialplanContent += ` same => n,GotoIf($[\${WAIT_LOOP} >= 90]?otp_verify_timeout)\n`;
  dialplanContent += ` same => n,Wait(1)\n`;
  dialplanContent += ` same => n,Goto(wait_otp_verify_decision)\n\n`;
  dialplanContent += ` same => n(otp_verify_approved),NoOp(=== [IVR-OTP-VERIFY] CODIGO OTP VALIDADO POR AGENTE ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM})=done)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM}_\${FINAL_AGENT})=done)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=otp_valid)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=otp_valid&mode=otp_press1&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,Playback(\${IVR_SUCCESS})\n`;
  dialplanContent += ` same => n,Wait(0.5)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += ` same => n(otp_verify_rejected),NoOp(=== [IVR-OTP-VERIFY] CODIGO OTP RECHAZADO POR AGENTE -> REINTENTANDO ===)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(otp_status/\${TARGET_NUM}_\${FINAL_AGENT})=pending)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=otp_invalid)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=otp_invalid&mode=otp_press1&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n,Playback(\${IVR_FAILURE})\n`;
  dialplanContent += ` same => n,Goto(ask_otp_verify)\n\n`;
  dialplanContent += ` same => n(otp_verify_timeout),Playback(custom/intentos_superados)\n`;
  dialplanContent += ` same => n,Hangup()\n\n`;
  dialplanContent += `exten => i,1,NoOp(=== [IVR-OTP-VERIFY] Tecla no valida (\${EXTEN}) -> Esperando tecla 1 ===)\n`;
  dialplanContent += ` same => n,Goto(s,menu)\n`;
  dialplanContent += `exten => t,1,GotoIf($[\${INTRO_TRIES} < 2]?s,menu)\n`;
  dialplanContent += ` same => n,Hangup()\n`;
  dialplanContent += `exten => h,1,NoOp(=== [IVR-OTP-VERIFY HANGUP] Canal: \${CHANNEL} | Causa: \${HANGUPCAUSE} | AMD=\${AMDSTATUS} ===)\n`;
  dialplanContent += ` same => n,Set(TARGET_NUM=\${IF($["\${TARGET_DEST}" != ""]?\${TARGET_DEST}:\${IF($["\${CALL_DEST}" != ""]?\${CALL_DEST}:\${CALLERID(num)})})})\n`;
  dialplanContent += ` same => n,GotoIf($["\${DB(call_status/\${TARGET_NUM})}" = "machine_detected" | $["\${AMDSTATUS}" = "MACHINE" & "\${AMDCAUSE:0:14}" != "INITIALSILENCE"]]?h_keep_machine_otp_v)\n`;
  dialplanContent += ` same => n,Set(DB(call_status/\${TARGET_NUM})=ended)\n`;
  dialplanContent += ` same => n,System(curl -s -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "http://127.0.0.1:3000/api/asterisk/call/status/update?number=\${URIENCODE(\${TARGET_NUM})}&status=ended&cause=\${URIENCODE(\${HANGUPCAUSE})}&mode=otp_press1&agent=\${URIENCODE(\${FINAL_AGENT})}&tenant=\${URIENCODE(\${TENANT_ID})}&userid=\${URIENCODE(\${CALL_USER_ID})}&channel=\${URIENCODE(\${CHANNEL})}" &)\n`;
  dialplanContent += ` same => n(h_keep_machine_otp_v),NoOp()\n\n`;

  dialplanContent += `; Alias de compatibilidad para modo hybrid hacia ivr-otp\n`;
  dialplanContent += `[ivr-hybrid]\n`;
  dialplanContent += `exten => s,1,Goto(ivr-otp,s,1)\n\n`;

  // Contextos dedicados por cada Call Center (tenant) para extensiones aprovisionadas con context = tenant_xxx
  for (const t of storedTenantsForDialplan) {
    if (!t || !t.dialplanContext || t.dialplanContext === 'from-internal') continue;
    const tCarrierSlug = t.carrierId && t.carrierId !== 'auto' && t.carrierId !== 'pool'
      ? resolveCarrierNameByRef(t.carrierId, carriersList, true)
      : '';
    dialplanContent += `; Contexto aislado para Call Center: ${t.name || t.code} (Carrier: ${tCarrierSlug || 'Pool'})\n`;
    dialplanContent += `[${t.dialplanContext}]\n`;
    dialplanContent += `exten => _X.,1,NoOp(=== [TENANT ${t.code || t.dialplanContext}] Enrutando por Carrier exclusivo: ${tCarrierSlug || 'Pool'} ===)\n`;
    if (tCarrierSlug && tCarrierSlug !== 'auto' && tCarrierSlug !== 'pool') {
      dialplanContent += ` same => n,Set(__ASSIGNED_CARRIER=${tCarrierSlug})\n`;
      dialplanContent += ` same => n,Set(__OUTBOUND_CARRIER=${tCarrierSlug})\n`;
    }
    dialplanContent += ` same => n,Set(__TENANT_ID=${t.id || t.code})\n`;
    dialplanContent += ` same => n,Goto(from-internal,\${EXTEN},1)\n`;
    dialplanContent += `exten => _+X.,1,Goto(${t.dialplanContext},\${EXTEN:1},1)\n`;
    dialplanContent += `exten => _*X.,1,Goto(from-internal,\${EXTEN},1)\n`;
    dialplanContent += `exten => _[a-zA-Z].,1,NoOp(=== [TENANT ${t.code || t.dialplanContext}] Extension por nombre: \${EXTEN} ===)\n`;
    if (tCarrierSlug && tCarrierSlug !== 'auto' && tCarrierSlug !== 'pool') {
      dialplanContent += ` same => n,Set(__ASSIGNED_CARRIER=${tCarrierSlug})\n`;
      dialplanContent += ` same => n,Set(__OUTBOUND_CARRIER=${tCarrierSlug})\n`;
    }
    dialplanContent += ` same => n,Set(__TENANT_ID=${t.id || t.code})\n`;
    dialplanContent += ` same => n,Goto(from-internal,\${EXTEN},1)\n\n`;
  }

  return dialplanContent;
}

// Auto-repair Asterisk PJSIP configuration on server startup if malformed
async function autoRepairAsteriskPjsipOnStartup() {
  try {
    const pjsipPath = '/etc/asterisk/pjsip.conf';
    const dialplanPath = '/etc/asterisk/extensions.conf';
    let needsRepair = false;

    try {
      if (!fs.existsSync('/etc/asterisk')) {
        fs.mkdirSync('/etc/asterisk', { recursive: true, mode: 0o755 });
      }
    } catch (_) {}

    if (fs.existsSync(pjsipPath)) {
      const content = fs.readFileSync(pjsipPath, 'utf8');
      if (
        (!content.includes('type = transport') && !content.includes('type=transport')) ||
        !content.includes('aors = 1001') ||
        content.includes('1001-aor') ||
        content.includes('[1001]\ntype = auth') ||
        content.includes('[1001]\ntype=auth') ||
        content.includes('[1001]\r\ntype = auth') ||
        content.includes('[1002]\ntype = auth') ||
        content.includes('moh_interpret')
      ) {
        console.log('[PJSIP-REPAIR] Se detectaron secciones desactualizadas o parámetros inválidos en /etc/asterisk/pjsip.conf. Reparando...');
        needsRepair = true;
      }
    } else {
      needsRepair = true;
    }

    // Resolver IP pública real ANTES de generar pjsip.conf para incluir external_media_address desde el arranque
    if (!isPublicIpv4(detectedExternalIp)) {
      await resolvePublicIpv4Async().catch(() => '');
    }

    // Generate clean PJSIP config and reload Asterisk ONLY if configuration actually changed
    const storedUsers = loadStoredUsers();
    const storedExts = loadStoredExtensions();
    const storedCarriers = loadStoredCarriers();
    lastSyncedExtensions = storedExts;
    lastSyncedCarriers = storedCarriers;
    const cleanPjsip = generateCleanPjsipConf(storedExts, storedCarriers, storedUsers);
    const normalizePjsipDiff = (txt: string) => txt.replace(/^; Fecha:.*$/gm, '').trim();
    const existingPjsipRaw = fs.existsSync(pjsipPath) ? fs.readFileSync(pjsipPath, 'utf8') : '';
    const pjsipChanged = needsRepair || normalizePjsipDiff(existingPjsipRaw) !== normalizePjsipDiff(cleanPjsip);

    try {
      fs.writeFileSync(path.join(process.cwd(), 'pjsip.conf'), cleanPjsip, 'utf8');
    } catch (_) {}
    lastGeneratedPjsip = cleanPjsip;

    if (pjsipChanged) {
      await writeAsteriskConfigFile(pjsipPath, cleanPjsip);
      if (hasLocalAsterisk) {
        const bin = getAsteriskBinary();
        exec(`"${bin}" -rx "pjsip reload"`, () => {});
      } else {
        try {
          await sendAmiAction('127.0.0.1', AMI_PORT, AMI_USER, AMI_SECRET, ['pjsip reload']);
        } catch (_) {}
      }
      console.log('[PJSIP-INIT] ✓ /etc/asterisk/pjsip.conf actualizado y recargado.');
    } else {
      console.log('[PJSIP-INIT] ✓ /etc/asterisk/pjsip.conf ya está actualizado (sin recarga innecesaria).');
    }

    // Ensure AMD and Audio Codecs / RTP configuration exists
    ensureAmdConfExists();
    ensureAudioCodecsAndRtpConfExists();

    // Auto-generate dialplan baseline and keep synced only when changed
    const cleanDialplan = generateCleanDialplanConf(storedCarriers, undefined, {}, storedExts);
    lastGeneratedDialplan = cleanDialplan;
    try {
      fs.writeFileSync(path.join(process.cwd(), 'extensions.conf'), cleanDialplan, 'utf8');
      const existingDialplanRaw = fs.existsSync(dialplanPath) ? fs.readFileSync(dialplanPath, 'utf8') : '';
      const normalizeDialplanDiff = (txt: string) => txt.replace(/^; Generado.*$/gm, '').trim();
      if (normalizeDialplanDiff(existingDialplanRaw) !== normalizeDialplanDiff(cleanDialplan)) {
        await writeAsteriskConfigFile(dialplanPath, cleanDialplan);
        if (hasLocalAsterisk) {
          exec('asterisk -rx "dialplan reload"', () => {});
        }
      }
      if (hasLocalAsterisk) {
        exec('asterisk -rx "channel request hangup Local/8888" 2>/dev/null', () => {});
        exec('asterisk -rx "hangup request Local/8888" 2>/dev/null', () => {});
      }
    } catch (_) {}

    // Ensure monitor directory exists for per-extension MixMonitor recordings
    try {
      if (!fs.existsSync('/var/spool/asterisk/monitor')) {
        fs.mkdirSync('/var/spool/asterisk/monitor', { recursive: true, mode: 0o775 });
      }
    } catch (_) {}

    // Initialize default action, clean caller ID, spy permissions (Ext 1000) & per-extension recording flags in AstDB
    try {
      executeAsteriskCommand('database put ivr_vars default_action "ivr-press1"').catch(() => {});
      executeAsteriskCommand('database put ivr_vars default_mode "press1"').catch(() => {});
      executeAsteriskCommand(`database put ivr_vars amd_enabled "${isAmdEnabled ? '1' : '0'}"`).catch(() => {});
      executeAsteriskCommand('database put ivr_vars default_agent "custom/conectar_asesor"').catch(() => {});
      executeAsteriskCommand('database put spy_allowed 1000 "1"').catch(() => {});
      if (hasLocalAsterisk) {
        const bin = getAsteriskBinary();
        exec(`"${bin}" -rx "module load app_amd.so" 2>/dev/null; "${bin}" -rx "module reload app_amd.so" 2>/dev/null`, () => {});
      }
      for (const ext of storedExts) {
        const extNum = String(ext?.extension || '').trim();
        if (!extNum) continue;
        if (ext.recordCalls === true) {
          executeAsteriskCommand(`database put record_ext ${extNum} "1"`).catch(() => {});
        } else {
          executeAsteriskCommand(`database del record_ext ${extNum}`).catch(() => {});
        }
      }
      for (const u of storedUsers) {
        const canSpyUser = u?.role === 'admin' || u?.role === 'supervisor' || !!u?.permissions?.canSpy;
        const targets = [u?.username, ...(Array.isArray(u?.assignedExtensions) ? u.assignedExtensions : [])].filter(Boolean);
        for (const t of targets) {
          const cleanT = String(t).trim().replace(/[^a-zA-Z0-9_\-]/g, '');
          if (!cleanT || cleanT === '1000') continue;
          if (canSpyUser) {
            executeAsteriskCommand(`database put spy_allowed ${cleanT} "1"`).catch(() => {});
          } else {
            executeAsteriskCommand(`database del spy_allowed ${cleanT}`).catch(() => {});
          }
        }
      }
    } catch (_) {}

    // Sincronizar rutas Call Center -> Proveedor SIP y extensiones OTP dinámicas (4001+) en AstDB desde el arranque
    syncTenantCarriersToAstDb(loadStoredTenants(), storedCarriers).catch(() => {});
    syncOtpExtensionsToAstDb().catch(() => {});

    // Reintento diferido si la red pública aún no estaba lista al arrancar el servidor
    if (hasLocalAsterisk && !isPublicIpv4(detectedExternalIp)) {
      resolvePublicIpv4Async().then(async (candidate) => {
        if (isPublicIpv4(candidate)) {
          const updatedPjsip = generateCleanPjsipConf(loadStoredExtensions(), loadStoredCarriers(), loadStoredUsers());
          lastGeneratedPjsip = updatedPjsip;
          const prevPjsipDisk = fs.existsSync(pjsipPath) ? fs.readFileSync(pjsipPath, 'utf8') : '';
          if (normalizePjsipDiff(prevPjsipDisk) !== normalizePjsipDiff(updatedPjsip)) {
            await writeAsteriskConfigFile(pjsipPath, updatedPjsip);
            exec('asterisk -rx "pjsip reload"', () => {});
            console.log(`[PJSIP-NAT] ✓ IP pública detectada (${candidate}) y aplicada a external_media_address.`);
          }
        }
      }).catch(() => {});
    }
  } catch (err: any) {
    console.warn('[PJSIP-REPAIR] Aviso en auto-reparación inicial:', err.message);
  }
}

// Real-time Asterisk Endpoints reader directly from Asterisk CLI & AMI
app.get('/api/asterisk/endpoints/live', async (req, res) => {
  try {
    const live = await queryAsteriskPjsipEndpoints();
    const detectedEndpoints = live.parsed.map((e) => e.extension);

    res.json({
      success: true,
      endpoints: detectedEndpoints,
      details: live.parsed,
      rawOutput: live.raw,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Real-time Asterisk Carriers & Registrations reader directly from Asterisk CLI & AMI
app.get('/api/asterisk/carriers/live', async (req, res) => {
  try {
    const regOutput = await executeAsteriskCommand('pjsip show registrations');
    const epOutput = await executeAsteriskCommand('pjsip show endpoints');
    const aorOutput = await executeAsteriskCommand('pjsip show aors');

    const carrierStatus: Record<string, {
      name: string;
      registered: boolean;
      registrationState: string;
      endpointState: string;
      contact: string;
      rtt: string;
    }> = {};

    // Parse registrations: reg_name/sip:... auth_name Status
    const regLines = (regOutput || '').split('\n');
    for (const line of regLines) {
      const trimmed = line.trim();
      const match = trimmed.match(/^reg_([^\s\/]+)(?:\/([^\s]+))?\s+([^\s]+)?\s+([A-Za-z]+)/);
      if (match) {
        const cName = match[1];
        const state = match[4] || match[3] || 'Unknown';
        carrierStatus[cName] = {
          name: cName,
          registered: state.toLowerCase() === 'registered',
          registrationState: state,
          endpointState: 'Unknown',
          contact: '',
          rtt: '',
        };
      }
    }

    // Parse endpoints and AoRs for reachability & latency
    const epDetails = await queryAsteriskPjsipEndpoints();
    for (const ep of epDetails.parsed) {
      const ext = ep.extension;
      // If it's a carrier name rather than numeric extension
      if (isNaN(parseInt(ext, 10)) || carrierStatus[ext]) {
        if (!carrierStatus[ext]) {
          carrierStatus[ext] = {
            name: ext,
            registered: false,
            registrationState: 'IP_Auth',
            endpointState: ep.state || 'Unknown',
            contact: ep.contact || '',
            rtt: ep.rtt || '',
          };
        } else {
          carrierStatus[ext].endpointState = ep.state || 'Unknown';
          carrierStatus[ext].contact = ep.contact || '';
          carrierStatus[ext].rtt = ep.rtt || '';
        }
      }
    }

    res.json({
      success: true,
      carriers: carrierStatus,
      rawRegistrations: regOutput,
      rawEndpoints: epOutput,
      rawAors: aorOutput,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Real SIP Carrier Ping & Asterisk Reachability Check (replaces simulated frontend latency)
app.post('/api/asterisk/carriers/ping', async (req, res) => {
  try {
    const { name, host, port = 5060, authType = 'registration' } = req.body || {};
    const slug = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const cleanHost = String(host || '').trim().replace(/^https?:\/\//i, '').replace(/^sips?:/i, '').replace(/^\/\//, '').replace(/\/.*$/, '').split(':')[0];
    const targetPort = Number(port) || 5060;

    let rttMs: number | null = null;
    let reachable = false;
    let registered = false;
    let registrationState = '';
    let endpointState = '';

    if (slug) {
      try {
        const epOutput = await executeAsteriskCommand(`pjsip show endpoint ${slug}`);
        const regOutput = authType === 'registration'
          ? await executeAsteriskCommand('pjsip show registrations')
          : '';

        if (epOutput) {
          const epStateMatch = epOutput.match(/Endpoint:\s*[^\s]+\s+([A-Za-z ]+?)(?:\s+\d+\s+of|\n|$)/);
          if (epStateMatch) endpointState = epStateMatch[1].trim();
          const contactMatch = epOutput.match(/Contact:\s*[^\s]+\s+(?:[0-9a-fA-F]+\s+)?(Avail|Unavail|Created|Removed)\s*([\d.]+)?/);
          if (contactMatch) {
            if (contactMatch[1] === 'Avail') reachable = true;
            if (contactMatch[2]) rttMs = Math.round(parseFloat(contactMatch[2]));
          }
        }
        if (regOutput) {
          const regLine = regOutput.split('\n').find((l) => l.trim().startsWith(`reg_${slug}/`) || l.trim().startsWith(`reg_${slug} `));
          if (regLine) {
            const parts = regLine.trim().split(/\s+/);
            registrationState = parts[parts.length - 1] || '';
            registered = registrationState.toLowerCase() === 'registered';
            if (registered) reachable = true;
          }
        }
      } catch (_) {}
    }

    // Network/TCP+DNS probe fallback if Asterisk didn't return qualify RTT
    let dnsResolved = false;
    if (cleanHost) {
      const start = Date.now();
      await new Promise<void>((resolve) => {
        const sock = new net.Socket();
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          try { sock.destroy(); } catch (_) {}
          if (ok) {
            dnsResolved = true;
            reachable = true;
            if (rttMs === null) rttMs = Math.max(1, Date.now() - start);
          }
          resolve();
        };
        sock.setTimeout(1800);
        sock.on('connect', () => finish(true));
        sock.on('timeout', () => finish(false));
        sock.on('error', (err: any) => {
          // ECONNREFUSED on TCP 5060 still proves host IP is reachable (SIP typically listens UDP only)
          if (err && err.code === 'ECONNREFUSED') {
            finish(true);
          } else {
            finish(false);
          }
        });
        try {
          sock.connect(targetPort, cleanHost);
        } catch (_) {
          finish(false);
        }
      });
    }

    res.json({
      success: true,
      carrier: slug || name,
      host: cleanHost,
      port: targetPort,
      reachable: reachable || dnsResolved,
      registered,
      registrationState: registrationState || (authType === 'ip_auth' ? 'IP_Auth' : 'Pendiente'),
      endpointState: endpointState || 'Verificado',
      latencyMs: rttMs,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper to parse extensions, auth passwords, callerids, and aor settings from pjsip.conf
function parseExtensionsFromPjsip(content: string): any[] {
  if (!content) return [];
  const sections: { name: string; props: Record<string, string> }[] = [];
  let currentSection: { name: string; props: Record<string, string> } | null = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(';') || !trimmed) continue;
    const secMatch = trimmed.match(/^\[([^\]]+)\]/);
    if (secMatch) {
      currentSection = { name: secMatch[1], props: {} };
      sections.push(currentSection);
      continue;
    }
    if (currentSection && trimmed.includes('=')) {
      const parts = trimmed.split('=');
      const k = parts[0].trim().toLowerCase();
      const v = parts.slice(1).join('=').trim();
      currentSection.props[k] = v;
    }
  }

  const transportPorts = new Map<string, number>();
  for (const s of sections) {
    if (s.props.type === 'transport' && s.props.bind) {
      const portMatch = String(s.props.bind).match(/:(\d{1,5})\s*$/);
      if (portMatch) {
        const parsedPort = parseInt(portMatch[1], 10);
        if (!isNaN(parsedPort) && parsedPort > 0) {
          transportPorts.set(s.name, parsedPort);
        }
      }
    }
  }

  const endpoints = sections.filter(
    (s) =>
      s.props.type === 'endpoint' &&
      !s.name.startsWith('carrier_') &&
      !s.name.startsWith('trunk_') &&
      (/^\d{3,6}$/.test(s.name) || Boolean(s.props.auth))
  );
  const auths = sections.filter((s) => s.props.type === 'auth');
  const aors = sections.filter((s) => s.props.type === 'aor');

  const exts: any[] = [];
  for (const ep of endpoints) {
    const secName = ep.name;
    const props = ep.props;
    const authSec = auths.find((a) => a.name === `${secName}-auth` || a.name === props.auth)?.props || {};
    const aorSec = aors.find((a) => a.name === `${secName}-aor` || a.name === secName)?.props || {};
    let callerIdNum = '';
    let callerIdName = '';
    if (props.callerid) {
      const m = props.callerid.match(/"?([^"<]*)"?\s*<([^>]*)>/);
      if (m) {
        callerIdName = m[1].trim();
        callerIdNum = m[2].trim();
      }
    }
    const transportName = props.transport === 'transport-udp-5060' ? 'transport-udp' : (props.transport || 'transport-udp');
    const resolvedPort = transportPorts.get(props.transport || 'transport-udp') || transportPorts.get('transport-udp') || 47923;
    exts.push({
      id: `ext-${secName}`,
      extension: secName,
      name: callerIdName || `Ext ${secName}`,
      secret: authSec.password || `SecretPass#${secName}`,
      context: props.context || 'from-internal',
      codecs: props.allow ? props.allow.split(',').map((c: string) => c.trim()) : ['ulaw', 'alaw'],
      maxContacts: parseInt(aorSec.max_contacts || props.max_contacts || '5', 10),
      transport: transportName,
      port: resolvedPort,
      callerId: props.callerid || '',
      callerIdNum: callerIdNum || secName,
      callerIdName: callerIdName || `Ext ${secName}`,
      isSpyOnly: secName === '1000',
      status: 'registered',
    });
  }
  return exts;
}

// Endpoint to get live extensions and passwords currently governing Asterisk
app.get('/api/asterisk/extensions', async (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const allowSecrets = isGlobalAdminUser(authUser);
    let pjsipContent = '';
    if (fs.existsSync('/etc/asterisk/pjsip.conf')) {
      pjsipContent = fs.readFileSync('/etc/asterisk/pjsip.conf', 'utf8');
    } else if (REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1')) {
      try {
        const resp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/config/pjsip.conf`, {
          headers: buildRemoteAuthHeaders(req),
        });
        if (resp.ok) {
          pjsipContent = await resp.text();
        }
      } catch (_) {}
    }

    if (!pjsipContent && lastGeneratedPjsip) {
      pjsipContent = lastGeneratedPjsip;
    }

    const storedExts = loadStoredExtensions();
    const storedByExt = new Map<string, any>(
      (Array.isArray(storedExts) ? storedExts : [])
        .filter((e: any) => e && e.extension)
        .map((e: any) => [String(e.extension).trim().toLowerCase(), e])
    );

    const parsedExtensions = parseExtensionsFromPjsip(pjsipContent).map((pe: any) => {
      const storedMeta = storedByExt.get(String(pe.extension).trim().toLowerCase());
      if (!storedMeta) return pe;
      return {
        ...storedMeta,
        ...pe,
        id: storedMeta.id || pe.id,
        name: storedMeta.name || pe.name,
        port: pe.port || storedMeta.port || 47923,
        recordCalls: typeof storedMeta.recordCalls === 'boolean' ? storedMeta.recordCalls : pe.recordCalls,
        isSpyOnly: typeof storedMeta.isSpyOnly === 'boolean' ? storedMeta.isSpyOnly : pe.isSpyOnly,
        carrierId: storedMeta.carrierId || pe.carrierId,
        tenantId: storedMeta.tenantId || pe.tenantId,
      };
    });
    const rawExtensions = parsedExtensions.length > 0 ? parsedExtensions : storedExts;
    const safeExtensions = allowSecrets
      ? rawExtensions
      : rawExtensions.map((ext: any) => {
          const { secret: _secret, ...rest } = ext || {};
          return rest;
        });
    res.json({
      success: true,
      extensions: safeExtensions,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Diagnostic endpoint specifically analyzing extensions 1001, 1002, 1003, 1004
app.get(['/api/asterisk/extensions/diagnostic', '/api/asterisk/diagnostic'], requireGlobalAdmin, async (req, res) => {
  try {
    const live = await queryAsteriskPjsipEndpoints();
    let currentConfig = '';
    if (fs.existsSync('/etc/asterisk/pjsip.conf')) {
      currentConfig = fs.readFileSync('/etc/asterisk/pjsip.conf', 'utf8');
    } else if (REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1')) {
      try {
        const resp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/config/pjsip.conf`, {
          headers: buildRemoteAuthHeaders(req),
        });
        if (resp.ok) {
          currentConfig = await resp.text();
        }
      } catch (_) {}
    } else if (lastGeneratedPjsip) {
      currentConfig = lastGeneratedPjsip;
    }

    const hasDuplicateSections = currentConfig.includes('[1001]\ntype = auth') || currentConfig.includes('[1001]\ntype=auth') || currentConfig.includes('[1002]\ntype = auth');

    const parsedExts = parseExtensionsFromPjsip(currentConfig);
    const activeList = parsedExts.length > 0 ? parsedExts : loadStoredExtensions();

    const softphoneCredentials = activeList.map((ext: any) => {
      const activeExtPort = parseInt(ext.port, 10) || 47923;
      const protoLabel = ext.transport === 'transport-tcp' ? 'TCP' : ext.transport === 'transport-tls' ? 'TLS' : ext.transport === 'transport-wss' ? 'WSS' : 'UDP';
      return {
        extension: ext.extension,
        name: ext.name,
        secret: ext.secret,
        transport: ext.transport,
        port: activeExtPort,
        callerId: `"${ext.callerIdName}" <${ext.callerIdNum}>`,
        setupGuide: {
          username: ext.extension,
          authorizationName: ext.extension,
          password: ext.secret,
          domain: `${ASTERISK_HOST}:${activeExtPort}`,
          port: activeExtPort,
          proxy: '',
          transport: protoLabel,
        },
      };
    });

    let recentRegisterErrors: string[] = [];
    try {
      if (fs.existsSync('/var/log/asterisk/messages')) {
        const logTail = await new Promise<string>((resolve) => {
          exec('tail -n 200 /var/log/asterisk/messages | grep -iE "pjsip.*(register|auth|failed|no matching|200)" | tail -n 15', { timeout: 1500 }, (_e, out) => {
            resolve(out ? out.trim() : '');
          });
        });
        if (logTail) {
          recentRegisterErrors = logTail.split('\n').filter(Boolean);
        }
      }
    } catch (_) {}

    res.json({
      success: true,
      hasSyntaxError: hasDuplicateSections,
      endpoints: live.parsed,
      rawOutput: live.raw,
      credentials: softphoneCredentials,
      recentRegisterErrors,
      configuredExtensionsCount: activeList.length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dedicated one-click repair and re-register endpoint
app.post('/api/asterisk/extensions/repair', requireGlobalAdmin, async (req, res) => {
  try {
    const extensionsToUse = (Array.isArray(req.body.extensions) && req.body.extensions.length > 0)
      ? req.body.extensions
      : (lastSyncedExtensions.length > 0 ? lastSyncedExtensions : loadStoredExtensions());
    const carriersToUse = (Array.isArray(req.body.carriers) && req.body.carriers.length > 0)
      ? req.body.carriers
      : (lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers());
    const storedUsers = loadStoredUsers();

    const cleanPjsip = generateCleanPjsipConf(extensionsToUse, carriersToUse, storedUsers);
    const pjsipPath = '/etc/asterisk/pjsip.conf';
    const written = await writeAsteriskConfigFile(pjsipPath, cleanPjsip);
    fs.writeFileSync(path.join(process.cwd(), 'pjsip.conf'), cleanPjsip, 'utf8');
    lastGeneratedPjsip = cleanPjsip;
    ensureAudioCodecsAndRtpConfExists();

    let cliReload = '';
    let amiReload = '';
    if (hasLocalAsterisk) {
      try {
        const bin = getAsteriskBinary();
        cliReload = await new Promise<string>((resolve) => {
          exec(`"${bin}" -rx "pjsip reload"`, { timeout: 6000 }, (err, stdout, stderr) => {
            resolve((stdout || stderr || (err ? err.message : 'PJSIP recargado en Asterisk')).trim());
          });
        });
      } catch (_) {}
    } else {
      try {
        amiReload = await sendAmiAction('127.0.0.1', AMI_PORT, AMI_USER, AMI_SECRET, ['pjsip reload']);
      } catch (_) {}
    }
    cachedPjsipEndpoints = null;
    invalidateCliCache();

    // Wait briefly then read back state
    await new Promise((r) => setTimeout(r, 600));
    const live = await queryAsteriskPjsipEndpoints();

    res.json({
      success: true,
      message: 'Extensiones y troncales reparadas exitosamente en Asterisk 20 con secciones limpias.',
      written,
      cliReload,
      amiReload,
      endpoints: live.parsed,
      rawOutput: live.raw,
    });
  } catch (err: any) {
    console.error('Error repairing PJSIP extensions:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

let lastGeneratedPjsip = '';
let lastGeneratedDialplan = '';

// Serve raw generated configuration files for easy curl / wget update on VPS
app.get('/api/asterisk/config/extensions.conf', requireInternalOrGlobalAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  const activeCarriers = lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers();
  const activeExts = lastSyncedExtensions.length > 0 ? lastSyncedExtensions : loadStoredExtensions();
  const primaryCarrier = activeCarriers.find((c) => c && c.enabled !== false && c.status !== 'disabled') || activeCarriers[0] || { name: 'carrier_default', host: 'voip.ghostcall.online' };
  const cleanDialplan = generateCleanDialplanConf(activeCarriers, primaryCarrier.host || 'voip.ghostcall.online', {}, activeExts);
  lastGeneratedDialplan = cleanDialplan;
  try {
    fs.writeFileSync(path.join(process.cwd(), 'extensions.conf'), cleanDialplan, 'utf8');
    if (fs.existsSync('/etc/asterisk')) {
      fs.writeFileSync('/etc/asterisk/extensions.conf', cleanDialplan, 'utf8');
    }
  } catch (_) {}
  return res.send(cleanDialplan);
});

app.get('/api/asterisk/config/pjsip.conf', requireInternalOrGlobalAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  const activeCarriers = lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers();
  const activeExts = lastSyncedExtensions.length > 0 ? lastSyncedExtensions : loadStoredExtensions();
  const activeUsers = loadStoredUsers();
  const cleanPjsip = generateCleanPjsipConf(activeExts, activeCarriers, activeUsers);
  lastGeneratedPjsip = cleanPjsip;
  try {
    fs.writeFileSync(path.join(process.cwd(), 'pjsip.conf'), cleanPjsip, 'utf8');
    if (fs.existsSync('/etc/asterisk')) {
      fs.writeFileSync('/etc/asterisk/pjsip.conf', cleanPjsip, 'utf8');
    }
  } catch (_) {}
  return res.send(cleanPjsip);
});

const AMI_SAFE_CMD_REGEX = /^(core show|pjsip show|pjsip send register|database (show|get|put|del|deltree)|dialplan (show|reload)|pjsip reload|manager show|moh (show|reload)|ari show|module (show|load|reload)|core reload)\b/i;

// Test AMI connection in real-time
app.post('/api/asterisk/ami/test', async (req, res) => {
  if (!isInternalAsteriskWebhook(req) && !isGlobalAdminUser((req as any).authUser)) {
    return res.status(403).json({ success: false, error: 'Solo el Super Administrador Global puede ejecutar comandos AMI.' });
  }
  const {
    host = AMI_HOST,
    port = AMI_PORT,
    user = AMI_USER,
    secret = AMI_SECRET,
    command = 'core show version',
  } = req.body || {};

  const cleanCmd = String(command || '').trim();
  if (!cleanCmd || /[!\`\r\n\0;|&$<>()]/.test(cleanCmd) || !AMI_SAFE_CMD_REGEX.test(cleanCmd)) {
    return res.status(400).json({
      success: false,
      error: 'Comando AMI bloqueado por política de seguridad.',
    });
  }
  try {
    const output = await sendAmiAction(String(host || AMI_HOST), Number(port) || AMI_PORT, String(user || AMI_USER), String(secret || AMI_SECRET), [cleanCmd]);
    res.json({ success: true, output });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Telemetry and Health monitor endpoint
app.get('/api/asterisk/telemetry/logs', requireAdminRole, (req, res) => {
  const now = Date.now();
  const remainingCooldownSec =
    amiHealthState.isCircuitOpen && amiHealthState.nextAllowedAttemptTime > now
      ? Math.max(0, Math.ceil((amiHealthState.nextAllowedAttemptTime - now) / 1000))
      : 0;

  res.json({
    success: true,
    logs: serverTelemetryLogs,
    amiHealth: {
      ...amiHealthState,
      remainingCooldownSec,
    },
    cliStats: {
      cachedKeys: cliCommandCache.size,
      isLocalCliRunning,
    },
  });
});

// Endpoint to reset AMI exponential backoff circuit breaker manually
app.post('/api/asterisk/ami/reset-backoff', requireAdminRole, (req, res) => {
  resetAmiBackoff();
  res.json({
    success: true,
    message: 'Backoff exponencial AMI reseteado exitosamente. Listo para reconectar.',
    amiHealth: amiHealthState,
  });
});

// Endpoint to clear server telemetry logs
app.post('/api/asterisk/telemetry/clear', requireAdminRole, (req, res) => {
  serverTelemetryLogs.length = 0;
  addServerTelemetryLog('SYSTEM', 'Historial de logs de telemetría limpiado por el operador.', undefined, 'success');
  res.json({ success: true, message: 'Logs de telemetría limpiados.' });
});

// ==============================================================================
// REAL-TIME SERVER TELEMETRY (CPU %, RAM MB/%, LOAD AVG, AMI PING LATENCY)
// ==============================================================================
let prevCpuSample: { idle: number; total: number; percent: number; at: number } | null = null;

function readCpuTimesAggregate(): { idle: number; total: number } {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

function getCpuUsagePercent(): number {
  const now = Date.now();
  const current = readCpuTimesAggregate();

  if (!prevCpuSample) {
    const initialPercent = current.total > 0
      ? Number((((current.total - current.idle) / current.total) * 100).toFixed(1))
      : 0;
    prevCpuSample = { idle: current.idle, total: current.total, percent: initialPercent, at: now };
    return initialPercent;
  }

  // Avoid zero-delta spikes if two clients poll within < 400ms
  if (now - prevCpuSample.at < 400) {
    return prevCpuSample.percent;
  }

  const deltaIdle = current.idle - prevCpuSample.idle;
  const deltaTotal = current.total - prevCpuSample.total;
  const percent = deltaTotal > 0
    ? Number(Math.min(100, Math.max(0, ((deltaTotal - deltaIdle) / deltaTotal) * 100)).toFixed(1))
    : prevCpuSample.percent;

  prevCpuSample = { idle: current.idle, total: current.total, percent, at: now };
  return percent;
}

function getRealMemoryStats() {
  let totalMb = Math.round(os.totalmem() / (1024 * 1024));
  let freeMb = Math.round(os.freemem() / (1024 * 1024));
  let availableMb = freeMb;
  let cachedMb = 0;
  let swapTotalMb = 0;
  let swapUsedMb = 0;

  try {
    if (fs.existsSync('/proc/meminfo')) {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const parseKb = (key: string): number | null => {
        const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, 'm'));
        return match ? Number(match[1]) : null;
      };
      const memTotalKb = parseKb('MemTotal');
      const memFreeKb = parseKb('MemFree');
      const memAvailKb = parseKb('MemAvailable');
      const buffersKb = parseKb('Buffers') ?? 0;
      const cachedKb = parseKb('Cached') ?? 0;
      const swapTotalKb = parseKb('SwapTotal');
      const swapFreeKb = parseKb('SwapFree');

      if (memTotalKb) totalMb = Math.round(memTotalKb / 1024);
      if (memFreeKb !== null) freeMb = Math.round(memFreeKb / 1024);
      if (memAvailKb !== null) {
        availableMb = Math.round(memAvailKb / 1024);
      } else {
        availableMb = Math.round(((memFreeKb ?? 0) + buffersKb + cachedKb) / 1024);
      }
      cachedMb = Math.round((buffersKb + cachedKb) / 1024);
      if (swapTotalKb !== null && swapFreeKb !== null) {
        swapTotalMb = Math.round(swapTotalKb / 1024);
        swapUsedMb = Math.max(0, Math.round((swapTotalKb - swapFreeKb) / 1024));
      }
    }
  } catch (_) {}

  const usedMb = Math.max(0, totalMb - availableMb);
  const usedPercent = totalMb > 0 ? Number(((usedMb / totalMb) * 100).toFixed(1)) : 0;
  const procMem = process.memoryUsage();

  return {
    totalMb,
    usedMb,
    freeMb,
    availableMb,
    cachedMb,
    usedPercent,
    swapTotalMb,
    swapUsedMb,
    processRssMb: Math.round(procMem.rss / (1024 * 1024)),
    processHeapUsedMb: Math.round(procMem.heapUsed / (1024 * 1024)),
  };
}

function measureAmiPingLatency(
  host = AMI_HOST,
  port = AMI_PORT,
  user = AMI_USER,
  secret = AMI_SECRET
): Promise<{ connected: boolean; latencyMs: number | null; error?: string; asteriskHost: string }> {
  const now = Date.now();
  if (amiHealthState.isCircuitOpen && now < amiHealthState.nextAllowedAttemptTime) {
    const remainingSec = Math.max(1, Math.ceil((amiHealthState.nextAllowedAttemptTime - now) / 1000));
    return Promise.resolve({
      connected: false,
      latencyMs: null,
      error: `Backoff AMI activo (${remainingSec}s): ${amiHealthState.lastError || 'Sin conexión'}`,
      asteriskHost: host,
    });
  }

  return new Promise((resolve) => {
    const startedAt = performance.now();
    const socket = new net.Socket();
    let buffer = '';
    let loggedIn = false;
    let pingSentAt = 0;
    let settled = false;

    const finish = (connected: boolean, latencyMs: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch (_) {}
      resolve({ connected, latencyMs, error, asteriskHost: host });
    };

    const timer = setTimeout(() => {
      finish(false, null, `Timeout AMI Ping (${AMI_TIMEOUT_MS}ms) en ${host}:${port}`);
    }, AMI_TIMEOUT_MS);

    socket.connect(port, host, () => {
      socket.write(`Action: Login\r\nUsername: ${user}\r\nSecret: ${secret}\r\nEvents: off\r\nActionID: tel_login\r\n\r\n`);
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString();

      if (!loggedIn && (buffer.includes('Message: Authentication accepted') || buffer.includes('ActionID: tel_login'))) {
        if (buffer.includes('Message: Authentication failed')) {
          finish(false, null, `Autenticación AMI fallida para '${user}'`);
          return;
        }
        if (buffer.includes('Authentication accepted') || buffer.includes('Response: Success')) {
          loggedIn = true;
          buffer = '';
          pingSentAt = performance.now();
          socket.write(`Action: Ping\r\nActionID: tel_ping\r\n\r\n`);
          return;
        }
      }

      if (buffer.includes('Message: Authentication failed')) {
        finish(false, null, `Autenticación AMI fallida para '${user}'`);
        return;
      }

      if (loggedIn && (buffer.includes('Ping: Pong') || buffer.includes('ActionID: tel_ping') || buffer.includes('Response: Success'))) {
        const endAt = performance.now();
        // Measure total handshake + ping or pure ping RTT (minimum 0.1ms)
        const totalMs = Number(Math.max(0.1, endAt - startedAt).toFixed(1));
        const pingOnlyMs = pingSentAt > 0 ? Number(Math.max(0.1, endAt - pingSentAt).toFixed(1)) : totalMs;
        recordAmiSuccess();
        try { socket.write('Action: Logoff\r\n\r\n'); } catch (_) {}
        finish(true, pingOnlyMs < totalMs ? totalMs : pingOnlyMs);
      }
    });

    socket.on('error', (err) => {
      finish(false, null, `${err.message} (${host}:${port})`);
    });

    socket.on('close', () => {
      if (!settled) {
        finish(false, null, `Socket AMI cerrado inesperadamente (${host}:${port})`);
      }
    });
  });
}

app.get('/api/system/telemetry', requireAdminRole, async (req, res) => {
  const localOnly = req.headers['x-telemetry-local-only'] === '1' || req.query.local === '1';

  // If running outside the VPS (e.g. AI Studio preview) and REMOTE_ASTERISK_HTTP is configured,
  // try pulling live OS + AMI telemetry directly from the VPS first.
  if (!hasLocalAsterisk && REMOTE_ASTERISK_HTTP && !localOnly) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2200);
      const remoteStart = performance.now();
      const remoteResp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/system/telemetry?local=1`, {
        headers: buildRemoteAuthHeaders(req, { 'x-telemetry-local-only': '1' }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (remoteResp.ok) {
        const remoteJson = (await remoteResp.json()) as any;
        if (remoteJson && remoteJson.success) {
          return res.json({
            ...remoteJson,
            proxyRoundTripMs: Number((performance.now() - remoteStart).toFixed(1)),
            source: 'remote-vps',
          });
        }
      }
    } catch (_) {}
  }

  const cpuPercent = getCpuUsagePercent();
  const loadAvg = os.loadavg().map((n) => Number(n.toFixed(2)));
  const cpus = os.cpus();
  const memory = getRealMemoryStats();

  // Measure real AMI Ping latency (if local Asterisk doesn't exist and REMOTE_ASTERISK_HTTP exists, measure direct AMI or remote HTTP AMI bridge)
  let amiProbe: { connected: boolean; latencyMs: number | null; error?: string; asteriskHost: string };
  if (hasLocalAsterisk) {
    if (!fs.existsSync('/var/run/asterisk/asterisk.ctl')) {
      amiProbe = {
        connected: false,
        latencyMs: null,
        error: 'Servicio Asterisk detenido (/var/run/asterisk/asterisk.ctl ausente)',
        asteriskHost: '127.0.0.1',
      };
    } else {
      amiProbe = await measureAmiPingLatency('127.0.0.1', AMI_PORT, AMI_USER, AMI_SECRET);
    }
  } else {
    amiProbe = await measureAmiPingLatency(AMI_HOST, AMI_PORT, AMI_USER, AMI_SECRET);
  }

  // Deduplicate active calls in callStatusStore (since both cleanDest and formattedDest may point to same active call)
  const uniqueActiveChannels = new Set<string>();
  for (const call of callStatusStore.values()) {
    if (call && call.status !== 'ended') {
      uniqueActiveChannels.add(call.channel || call.number);
    }
  }

  res.json({
    success: true,
    timestamp: Date.now(),
    source: hasLocalAsterisk ? 'vps-local' : 'app-host',
    host: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      nodeVersion: process.version,
      uptimeSec: Math.round(os.uptime()),
      processUptimeSec: Math.round(process.uptime()),
      pid: process.pid,
    },
    cpu: {
      percent: cpuPercent,
      cores: cpus.length,
      model: cpus[0]?.model || 'Unknown CPU',
      load1m: loadAvg[0] ?? 0,
      load5m: loadAvg[1] ?? 0,
      load15m: loadAvg[2] ?? 0,
    },
    memory,
    ami: {
      connected: amiProbe.connected,
      latencyMs: amiProbe.latencyMs,
      error: amiProbe.error || null,
      asteriskHost: amiProbe.asteriskHost,
      isCircuitOpen: amiHealthState.isCircuitOpen,
      consecutiveFailures: amiHealthState.consecutiveFailures,
      totalAttempts: amiHealthState.totalAttempts,
      successfulAttempts: amiHealthState.successfulAttempts,
      lastError: amiHealthState.lastError || null,
    },
    asteriskRuntime: {
      hasLocalAsterisk,
      asteriskCtlExists: fs.existsSync('/var/run/asterisk/asterisk.ctl'),
      activeCalls: uniqueActiveChannels.size,
      capturedOtps: capturedOtpHistory.length,
      cliCacheKeys: cliCommandCache.size,
    },
  });
});

// Endpoint to sync all extensions directly into /etc/asterisk/pjsip.conf and reload
app.post('/api/asterisk/sync/extensions', async (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const isMasterAdmin = isGlobalAdminUser(authUser);
    const canSyncExtensions = isMasterAdmin || (authUser?.role !== 'agent' && Boolean(authUser?.permissions?.canManageExtensions));
    if (!canSyncExtensions) {
      return res.status(403).json({ success: false, error: 'Permisos insuficientes para sincronizar extensiones en Asterisk.' });
    }

    const { extensions, carriers } = req.body;

    if (!Array.isArray(extensions)) {
      return res.status(400).json({ success: false, error: 'extensions must be an array' });
    }

    saveStoredExtensions(extensions);
    const persistedExtensions = loadStoredExtensions();
    lastSyncedExtensions = persistedExtensions;

    const validCarriers = (isMasterAdmin && Array.isArray(carriers))
      ? carriers
      : (lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers());
    lastSyncedCarriers = validCarriers;
    if (isMasterAdmin && Array.isArray(carriers)) {
      saveStoredCarriers(validCarriers);
    }
    const enabledCarriers = validCarriers.filter((c: any) => c && c.name && c.enabled !== false && c.status !== 'disabled');
    const primaryCarrier = enabledCarriers[0] || validCarriers[0] || { name: 'carrier_default', host: 'voip.ghostcall.online' };
    const activeCarrier = primaryCarrier.name ? primaryCarrier.name.replace(/\s+/g, '_') : 'carrier_default';
    const carrierHost = primaryCarrier.host || 'voip.ghostcall.online';
    const outboundCid = (primaryCarrier.outboundCallerId && !String(primaryCarrier.outboundCallerId).includes('5550199'))
      ? primaryCarrier.outboundCallerId
      : 'Asignado por Carrier';

    const storedUsersList = loadStoredUsers();
    let usersToInclude = storedUsersList;
    if (isMasterAdmin && Array.isArray(req.body.users) && req.body.users.length > 0) {
      const mergedList = storedUsersList.map((u) => ({ ...u }));
      const indexByKey = new Map<string, number>();
      mergedList.forEach((u, idx) => {
        if (u?.id) indexByKey.set(`id:${String(u.id).toLowerCase()}`, idx);
        if (u?.username) indexByKey.set(`un:${String(u.username).toLowerCase()}`, idx);
      });
      for (const u of req.body.users) {
        if (!u || (!u.id && !u.username)) continue;
        const idKey = u.id ? `id:${String(u.id).toLowerCase()}` : '';
        const unKey = u.username ? `un:${String(u.username).toLowerCase()}` : '';
        const matchedIdx = (idKey && indexByKey.has(idKey))
          ? indexByKey.get(idKey)!
          : (unKey && indexByKey.has(unKey) ? indexByKey.get(unKey)! : -1);
        const { effectiveMembership: _em, membership: _m, ...cleanIncoming } = u;
        if (matchedIdx >= 0) {
          const prev = mergedList[matchedIdx];
          mergedList[matchedIdx] = {
            ...prev,
            ...cleanIncoming,
            ...(prev?.membership ? { membership: prev.membership } : {}),
          };
        } else {
          const newIdx = mergedList.push(cleanIncoming) - 1;
          if (idKey) indexByKey.set(idKey, newIdx);
          if (unKey) indexByKey.set(unKey, newIdx);
        }
      }
      saveStoredUsers(mergedList);
      usersToInclude = loadStoredUsers();
      lastSyncedUsers = usersToInclude;
    }

    const storedTenantsList = loadStoredTenants();
    const tenantsToSync = (isMasterAdmin && Array.isArray(req.body.tenants) && req.body.tenants.length > 0)
      ? req.body.tenants.map((t: any) => {
          const prevT = storedTenantsList.find((st: any) => st && String(st.id) === String(t?.id));
          const { effectiveMembership: _em, membership: _m, ...cleanT } = t || {};
          return { ...cleanT, ...(prevT?.membership ? { membership: prevT.membership } : {}) };
        })
      : storedTenantsList;
    if (isMasterAdmin && Array.isArray(req.body.tenants) && req.body.tenants.length > 0) {
      saveStoredTenants(tenantsToSync);
    }

    if (!detectedExternalIp) {
      await resolvePublicIpv4Async().catch(() => '');
    }

    // Generate clean pjsip.conf using validated Asterisk 20 generator
    const pjsipContent = generateCleanPjsipConf(persistedExtensions, validCarriers, usersToInclude);

    // Generate extensions.conf (Dialplan) with outbound multi-carrier failover routing, tenant isolation and Ring-All support
    const dialplanContent = generateCleanDialplanConf(validCarriers, carrierHost, req.body, persistedExtensions);

    const asteriskPjsipPath = '/etc/asterisk/pjsip.conf';
    const asteriskDialplanPath = '/etc/asterisk/extensions.conf';
    const normalizePjsipDiff = (txt: string) => txt.replace(/^; Fecha:.*$/gm, '').trim();
    const normalizeDialplanDiff = (txt: string) => txt.replace(/^; Generado.*$/gm, '').trim();
    const prevPjsipDisk = fs.existsSync(asteriskPjsipPath) ? fs.readFileSync(asteriskPjsipPath, 'utf8') : '';
    const prevDialplanDisk = fs.existsSync(asteriskDialplanPath) ? fs.readFileSync(asteriskDialplanPath, 'utf8') : '';
    const pjsipChanged = Boolean(req.body.forceReload) || normalizePjsipDiff(prevPjsipDisk) !== normalizePjsipDiff(pjsipContent);
    const dialplanChanged = Boolean(req.body.forceReload) || normalizeDialplanDiff(prevDialplanDisk) !== normalizeDialplanDiff(dialplanContent);

    // 1. Ensure custom audio directory, native 8k WAV+ULAW audios, RTP/Codecs, and AMD config exist
    ensureCustomAudioFilesExist();
    ensureAmdConfExists();
    ensureAudioCodecsAndRtpConfExists();

    // 2. Safe write for PJSIP Configuration (only rewrite when changed)
    const pjsipWritten = pjsipChanged ? await writeAsteriskConfigFile(asteriskPjsipPath, pjsipContent) : false;

    // 3. Save each extension's assigned Carrier and Recording flag into AstDB (CallerID assigned by carrier)
    // Precedence for user_carrier AstDB: extension.carrierId (explicit) > owning user.carrierId > owning tenant.carrierId
    executeAsteriskCommand('database put spy_allowed 1000 "1"').catch(() => {});
    const extToUserCarrier = new Map<string, string>();
    if (Array.isArray(usersToInclude)) {
      for (const u of usersToInclude) {
        if (!u) continue;
        const uCarrierRaw = u.assignedCarrierId || u.carrierId || '';
        const resolvedUC = (uCarrierRaw && uCarrierRaw !== 'auto' && uCarrierRaw !== 'pool')
          ? resolveCarrierNameByRef(uCarrierRaw, validCarriers, true)
          : '';
        if (resolvedUC) {
          if (u.username) extToUserCarrier.set(String(u.username).trim().toLowerCase(), resolvedUC);
          if (Array.isArray(u.assignedExtensions)) {
            for (const ae of u.assignedExtensions) {
              const cleanAe = String(ae || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '').toLowerCase();
              if (cleanAe) extToUserCarrier.set(cleanAe, resolvedUC);
            }
          }
        }
      }
    }

    await syncTenantCarriersToAstDb(tenantsToSync, validCarriers);

    if (Array.isArray(persistedExtensions)) {
      for (const ext of persistedExtensions) {
        const extNum = ext.extension;
        const extKey = String(extNum || '').trim().toLowerCase();
        // CallerID is assigned dynamically by the SIP carrier, delete any stale extension_cid override
        executeAsteriskCommand(`database deltree extension_cid/${extNum}`).catch(() => {});
        const cId = ext.carrierId || '';
        const explicitExtCarrier = (cId && cId !== 'auto' && cId !== 'pool')
          ? resolveCarrierNameByRef(cId, validCarriers, true)
          : '';
        const inheritedUserCarrier = extToUserCarrier.get(extKey) || '';
        const tenantFallback = resolveTenantCarrierForCall({ agentExten: String(extNum) }, validCarriers).carrierName;
        const effectiveExtCarrier = explicitExtCarrier || inheritedUserCarrier || tenantFallback;
        if (effectiveExtCarrier) {
          executeAsteriskCommand(`database put user_carrier ${extNum} "${effectiveExtCarrier}"`).catch(() => {});
        } else {
          executeAsteriskCommand(`database del user_carrier ${extNum}`).catch(() => {});
        }
        if (ext.recordCalls === true) {
          executeAsteriskCommand(`database put record_ext ${extNum} "1"`).catch(() => {});
        } else {
          executeAsteriskCommand(`database del record_ext ${extNum}`).catch(() => {});
        }
      }
    }

    if (Array.isArray(usersToInclude)) {
      for (const u of usersToInclude) {
        const uName = u.username || u.id;
        const uCarrier = u.assignedCarrierId || u.carrierId || '';
        const resolvedUC = (uCarrier && uCarrier !== 'auto' && uCarrier !== 'pool')
          ? resolveCarrierNameByRef(uCarrier, validCarriers, true)
          : '';
        const tenantCarrierForUser = u.tenantId
          ? resolveTenantCarrierForCall({ tenantId: String(u.tenantId) }, validCarriers).carrierName
          : '';
        const finalUserCarrier = resolvedUC || tenantCarrierForUser;
        if (uName) {
          if (finalUserCarrier) {
            executeAsteriskCommand(`database put user_carrier ${uName} "${finalUserCarrier}"`).catch(() => {});
          } else {
            executeAsteriskCommand(`database del user_carrier ${uName}`).catch(() => {});
          }
        }
        const canSpyUser = u?.role === 'admin' || u?.role === 'supervisor' || !!u?.permissions?.canSpy;
        const targets = [u?.username, ...(Array.isArray(u?.assignedExtensions) ? u.assignedExtensions : [])].filter(Boolean);
        for (const t of targets) {
          const cleanT = String(t).trim().replace(/[^a-zA-Z0-9_\-]/g, '');
          if (!cleanT || cleanT === '1000') continue;
          if (canSpyUser) {
            executeAsteriskCommand(`database put spy_allowed ${cleanT} "1"`).catch(() => {});
          } else {
            executeAsteriskCommand(`database del spy_allowed ${cleanT}`).catch(() => {});
          }
        }
      }
    }

    // 4. Save default pre-recorded IVR audios into AstDB for fallback and extension 8888 tests
    const defaultIntro = req.body.audioIntro || 'custom/banrearreglado';
    const defaultPrompt = req.body.audioPrompt || 'custom/solicitar_codigo_otp';
    const defaultWait = req.body.audioWait || 'custom/un_momento_validando_informacion';
    const defaultSuccess = req.body.audioSuccess || 'custom/operacion_bloqueada_exito';
    const defaultAgent = req.body.audioAgent || 'custom/conectar_asesor';

    const persistedPress1Agent = press1DestinationMode === 'ringall' ? 'ringall' : press1SelectedExtensions.join('&');
    const defaultAudiosCommands = [
      `database put ivr_vars default_intro "${defaultIntro}"`,
      `database put ivr_vars default_prompt "${defaultPrompt}"`,
      `database put ivr_vars default_wait "${defaultWait}"`,
      `database put ivr_vars default_success "${defaultSuccess}"`,
      `database put ivr_vars default_agent "${defaultAgent}"`,
      `database put ivr_vars default_agent_exten "${persistedPress1Agent}"`,
      `database put ivr_vars 8888_intro "${defaultIntro}"`,
      `database put ivr_vars 8888_prompt "${defaultPrompt}"`,
      `database put ivr_vars 8888_wait "${defaultWait}"`,
      `database put ivr_vars 8888_success "${defaultSuccess}"`,
      `database put ivr_vars 8888_agent "${defaultAgent}"`,
      `database put ivr_vars 8888_agent_exten "${persistedPress1Agent}"`,
    ];

    (async () => {
      for (const dCmd of defaultAudiosCommands) {
        await executeAsteriskCommand(dCmd).catch(() => {});
      }
      await syncOtpExtensionsToAstDb().catch(() => {});
      invalidateCliCache();
    })();

    // Save in memory for download endpoints
    lastGeneratedPjsip = pjsipContent;
    lastGeneratedDialplan = dialplanContent;

    // 5. Safe write for Extensions Dialplan (only rewrite when changed)
    const dialplanWritten = dialplanChanged ? await writeAsteriskConfigFile(asteriskDialplanPath, dialplanContent) : false;

    // Also write to local app dir for safety
    try {
      fs.writeFileSync(path.join(process.cwd(), 'pjsip.conf'), pjsipContent, 'utf8');
      fs.writeFileSync(path.join(process.cwd(), 'extensions.conf'), dialplanContent, 'utf8');
    } catch (e) {}

    // 6. Send ONE hot reload only for modules whose config actually changed (prevents PJSIP registration drops)
    const reloadCmds: string[] = [];
    if (pjsipChanged) reloadCmds.push('pjsip reload');
    if (dialplanChanged) reloadCmds.push('dialplan reload');

    let amiOutput = '';
    let cliOutput = 'Sin cambios en PJSIP/Dialplan (AstDB actualizado sin interrumpir registros)';
    let reloadError = '';
    if (hasLocalAsterisk && pjsipChanged && !pjsipWritten) {
      return res.status(500).json({
        success: false,
        error: 'No se pudo escribir /etc/asterisk/pjsip.conf (verifica permisos del usuario del proceso PM2/Node).',
        pjsipWritten,
        dialplanWritten,
      });
    }

    if (reloadCmds.length > 0) {
      if (hasLocalAsterisk) {
        const bin = getAsteriskBinary();
        const reloadRes = await new Promise<{ out: string; errMsg: string }>((resolve) => {
          const timer = setTimeout(() => resolve({ out: '', errMsg: 'Timeout ejecutando recarga de Asterisk (>6s).' }), 6000);
          exec(reloadCmds.map((c) => `"${bin}" -rx "${c}"`).join(' && '), (err, stdout, stderr) => {
            clearTimeout(timer);
            const combinedOut = (stdout || '').trim();
            const combinedErr = (stderr || '').trim();
            if (err) {
              resolve({ out: combinedOut, errMsg: (combinedErr || err.message || 'Error ejecutando asterisk -rx').trim() });
            } else if (/failed|error/i.test(combinedOut) && !/reloaded successfully/i.test(combinedOut)) {
              resolve({ out: combinedOut, errMsg: combinedOut });
            } else {
              resolve({ out: combinedOut || 'Dialplan y PJSIP recargados en caliente', errMsg: '' });
            }
          });
        });
        cliOutput = reloadRes.out || reloadRes.errMsg;
        reloadError = reloadRes.errMsg;

        // Verify Asterisk actually loaded the synced endpoints into PJSIP memory (catches silent sorcery/pjsip.conf rejections)
        if (!reloadError && pjsipChanged && persistedExtensions.length > 0) {
          await new Promise((r) => setTimeout(r, 250));
          const loadedCheck = await new Promise<string>((resolve) => {
            exec(`"${bin}" -rx "pjsip show endpoints"`, { timeout: 4000 }, (_err, stdout) => {
              resolve(String(stdout || ''));
            });
          });
          const expectedExtensionIds = persistedExtensions
            .map((e: any) => String(e?.extension || e?.id || e?.number || e?.num || '').trim().replace(/[^a-zA-Z0-9_\-]/g, ''))
            .filter(Boolean);
          const expectedCarrierSlugMap = buildCarrierEndpointSlugMap(persistedExtensions, validCarriers, usersToInclude);
          const expectedCarrierIds = Array.from(expectedCarrierSlugMap.values());
          const expectedIds = Array.from(new Set([...expectedExtensionIds, ...expectedCarrierIds]));
          const missingIds = expectedIds.filter((extId) => {
            const escaped = extId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return !new RegExp(`Endpoint:\\s*${escaped}(?:\\/|\\s|$)`).test(loadedCheck);
          });
          if (missingIds.length > 0) {
            let logHint = '';
            try {
              if (fs.existsSync('/var/log/asterisk/messages')) {
                const lines = fs.readFileSync('/var/log/asterisk/messages', 'utf8').split('\n').slice(-80);
                const matches = lines.filter((l) => /res_pjsip|sorcery|pjsip\.conf|ERROR/i.test(l)).slice(-4);
                if (matches.length > 0) {
                  logHint = ` | Log Asterisk: ${matches.join(' || ')}`;
                }
              }
            } catch (_) {}
            reloadError = `Asterisk escribió /etc/asterisk/pjsip.conf pero NO cargó en memoria las extensiones (${missingIds.join(', ')}).${logHint}`;
            console.error(`[ASTERISK-SYNC] ${reloadError}`);
          }
        }
      } else {
        try {
          amiOutput = await sendAmiAction('127.0.0.1', AMI_PORT, AMI_USER, AMI_SECRET, reloadCmds);
          cliOutput = 'Dialplan y PJSIP recargados vía AMI';
        } catch (amiErr: any) {
          amiOutput = amiErr.message;
        }
      }
      cachedPjsipEndpoints = null;
      invalidateCliCache();
    }

    if (hasLocalAsterisk && reloadError) {
      return res.status(500).json({
        success: false,
        error: `pjsip.conf escrito pero falló la carga en Asterisk: ${reloadError}`,
        pjsipWritten,
        dialplanWritten,
        cliOutput,
      });
    }

    // 8. Replicate configuration to remote Asterisk VPS if running through remote bridge without local Asterisk
    let remoteSyncWarning = '';
    if (!hasLocalAsterisk && REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('localhost') && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') && !req.headers['x-governor-fwd']) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);
        const remoteSyncResp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/sync/extensions`, {
          method: 'POST',
          headers: buildRemoteAuthHeaders(req, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(req.body),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (remoteSyncResp.ok) {
          console.log(`[ASTERISK-SYNC] ✓ Replicado exitosamente en VPS Asterisk remoto: ${REMOTE_ASTERISK_HTTP}`);
        } else {
          remoteSyncWarning = `El servidor Asterisk remoto (${REMOTE_ASTERISK_HTTP}) rechazó la sincronización con HTTP ${remoteSyncResp.status}. Si estás usando la vista previa externa, abre directamente la URL de tu VPS para sincronizar Asterisk.`;
          console.warn(`[ASTERISK-SYNC] ${remoteSyncWarning}`);
        }
      } catch (fwdErr: any) {
        remoteSyncWarning = `No se pudo contactar al servidor Asterisk remoto (${REMOTE_ASTERISK_HTTP}): ${fwdErr.message}`;
        console.warn(`[ASTERISK-SYNC] Remote sync forward notice:`, fwdErr.message);
      }
    }

    console.log(`[ASTERISK-SYNC] ✓ Sincronización completa: ${extensions.length} extensiones, PJSIP=${pjsipWritten}, Dialplan=${dialplanWritten}`);

    // If restart requested or if socket re-bind is required for new transport port
    if (req.body.restartAsterisk && hasLocalAsterisk) {
      const bin = getAsteriskBinary();
      exec(`"${bin}" -rx "core restart now"`, (err) => {
        if (err) exec('systemctl restart asterisk', () => {});
      });
    }

    if (!hasLocalAsterisk && remoteSyncWarning) {
      return res.status(502).json({
        success: false,
        error: remoteSyncWarning,
        pjsipWritten,
        dialplanWritten,
      });
    }

    res.json({
      success: true,
      message: `Configuración sincronizada exitosamente con Asterisk: ${extensions.length} extensiones y ${enabledCarriers.length} troncal(es) activa(s) (${enabledCarriers.map((c: any) => c.name).join(', ') || 'ninguna'}) con failover saliente`,
      pjsipWritten,
      dialplanWritten,
      cliOutput,
      amiOutput,
    });
  } catch (error: any) {
    console.error('Error syncing extensions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to cleanly restart Asterisk to bind new ports (e.g. 47923)
app.post('/api/asterisk/restart', requireGlobalAdmin, async (req, res) => {
  try {
    if (hasLocalAsterisk) {
      exec('asterisk -rx "core restart now"', (err, stdout, stderr) => {
        if (err) {
          exec('systemctl restart asterisk', () => {});
        }
      });
    } else {
      executeAsteriskCommand('core restart now').catch(() => {});
    }
    res.json({
      success: true,
      message: 'Comando "core restart now" enviado a Asterisk. El servicio se reiniciará en menos de 1 segundo aplicando el nuevo puerto de transporte.'
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Endpoint to sync Dialplan (extensions.conf) and reload
app.post('/api/asterisk/sync/dialplan', requireGlobalAdmin, async (req, res) => {
  try {
    ensureCustomAudioFilesExist();
    let contentToWrite = req.body?.dialplan || lastGeneratedDialplan;
    if (!contentToWrite) {
      // If none generated yet, read from /etc/asterisk/extensions.conf or generate default
      try {
        if (fs.existsSync('/etc/asterisk/extensions.conf')) {
          contentToWrite = fs.readFileSync('/etc/asterisk/extensions.conf', 'utf-8');
        }
      } catch (e) {}
    }
    if (!contentToWrite) {
      const cliOutput = hasLocalAsterisk
        ? await new Promise<string>((resolve) => {
            exec('asterisk -rx "dialplan reload"', (err, stdout) => {
              resolve(stdout ? stdout.trim() : 'Dialplan recargado');
            });
          })
        : await executeAsteriskCommand('dialplan reload').catch(() => 'Dialplan recargado');
      return res.json({ success: true, message: 'Dialplan verificado y recargado', cliOutput });
    }

    const fileWritten = await writeAsteriskConfigFile('/etc/asterisk/extensions.conf', contentToWrite);

    // Forward to remote Asterisk VPS if running through remote bridge without local Asterisk
    if (!hasLocalAsterisk && REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('localhost') && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') && !req.headers['x-governor-fwd']) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/sync/dialplan`, {
          method: 'POST',
          headers: buildRemoteAuthHeaders(req, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ dialplan: contentToWrite }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (fwdErr: any) {
        console.warn('[DIALPLAN FORWARD NOTICE]:', fwdErr.message);
      }
    }

    const cliOutput = hasLocalAsterisk
      ? await new Promise<string>((resolve) => {
          exec('asterisk -rx "dialplan reload"', (err, stdout) => {
            resolve(stdout ? stdout.trim() : 'Dialplan recargado');
          });
        })
      : await executeAsteriskCommand('dialplan reload').catch(() => 'Dialplan recargado');

    res.json({
      success: true,
      fileWritten,
      cliOutput,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to originate real calls to client or extension connecting to IVR
// Guard against accidental duplicate calls to the same number within 3 seconds
const recentOriginateRequests = new Map<string, number>();
const lastOriginatePayloads = new Map<string, any>();
const callRetryAttempts = new Map<string, number>();
const pendingRetryTimers = new Map<string, NodeJS.Timeout>();
const cancelledNumbers = new Map<string, number>();
const AMD_CONFIG_FILE = path.join(DATA_DIR, 'amd_config.json');
function loadStoredAmdEnabled(): boolean {
  try {
    if (fs.existsSync(AMD_CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(AMD_CONFIG_FILE, 'utf8'));
      if (typeof parsed?.enabled === 'boolean') return parsed.enabled;
    }
  } catch (_) {}
  return true;
}
function saveStoredAmdEnabled(enabled: boolean) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(AMD_CONFIG_FILE, JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch (_) {}
}
let isAmdEnabled: boolean = loadStoredAmdEnabled();
let press1DestinationMode: 'ringall' | 'specific' = 'ringall';
let press1SelectedExtensions: string[] = ['1001'];

app.post('/api/asterisk/call/originate', requireActiveMembership, async (req, res) => {
  try {
    const rawDest = req.body.destination || req.body.exten || req.body.number;
    const {
      carrier = 'auto',
      callerId = '',
      callerIdNum = '',
      callerIdName = '',
      mode = 'press1',
      callMode,
      agentExten = 'ringall',
      audioIntro = '',
      audioPrompt = '',
      audioAgent = '',
      audioSuccess = '',
      service = 'Servicio al Cliente',
    } = req.body;

    const destination = rawDest;
    if (!destination) {
      return res.status(400).json({ success: false, error: 'El número de destino es requerido' });
    }

    const cleanDest = destination.trim().replace(/[^0-9]/g, '');
    const clean10 = cleanDest.length === 11 && cleanDest.startsWith('1') ? cleanDest.substring(1) : cleanDest;
    const formattedDestNANP = clean10.length === 10 ? `1${clean10}` : clean10;
    
    // Unblock any previous cancellation & clear stale retry timers for this number
    cancelledNumbers.delete(cleanDest);
    cancelledNumbers.delete(clean10);
    cancelledNumbers.delete(formattedDestNANP);
    [cleanDest, clean10, formattedDestNANP].forEach((k) => {
      if (k && pendingRetryTimers.has(k)) {
        const t = pendingRetryTimers.get(k);
        if (t) clearTimeout(t);
        pendingRetryTimers.delete(k);
      }
    });

    // Forward to remote Asterisk if on cloud preview without local Asterisk
    if (!hasLocalAsterisk && REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('localhost') && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') && !req.headers['x-governor-fwd']) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const remoteResp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/call/originate`, {
          method: 'POST',
          headers: buildRemoteAuthHeaders(req, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(req.body),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (remoteResp.ok) {
          const remoteJson = await remoteResp.json();
          return res.json(remoteJson);
        }
      } catch (fwdErr: any) {
        console.warn('[ORIGINATE FORWARD NOTICE]:', fwdErr.message);
      }
    }

    const rawReqCidNum = String(callerIdNum || callerId || '').trim();
    const isPlaceholderCid = !rawReqCidNum || rawReqCidNum.includes('5550199') || /asignado/i.test(rawReqCidNum);
    let effectiveCidNum = isPlaceholderCid ? '' : rawReqCidNum;
    const rawReqCidName = String(callerIdName || '').trim();
    let effectiveCidName = (!rawReqCidName || /asignado|atenci[oó]n al cliente|banreservas|seguridad bancaria/i.test(rawReqCidName))
      ? ''
      : rawReqCidName;
    const effectiveMode = callMode || mode || 'cancel_code';
    let targetContext = 'ivr-press1-cancel';
    if (effectiveMode === 'direct') {
      targetContext = 'from-internal';
    } else if (effectiveMode === 'playback' || effectiveMode === 'audio_playback') {
      targetContext = 'ivr-direct-playback';
    } else if (effectiveMode === 'audio_then_agent') {
      targetContext = 'ivr-audio-then-agent';
    } else if (effectiveMode === 'otp') {
      targetContext = 'ivr-otp';
    } else if (effectiveMode === 'hybrid') {
      targetContext = 'ivr-hybrid';
    } else if (effectiveMode === 'cancel_code' || effectiveMode === 'press1_cancel') {
      targetContext = 'ivr-press1-cancel';
    } else if (effectiveMode === 'otp_press1' || effectiveMode === 'ivr_otp_verify') {
      targetContext = 'ivr-otp-verify';
    } else {
      targetContext = 'ivr-press1';
    }

    // Prevent double-click originating duplicate calls
    const now = Date.now();
    const lastTime = recentOriginateRequests.get(cleanDest) || 0;
    if (now - lastTime < 3000) {
      return res.status(429).json({
        success: false,
        error: `Ya se está procesando una llamada a ${cleanDest}. Por favor espera unos segundos.`,
      });
    }
    recentOriginateRequests.set(cleanDest, now);

    // Normalize destination (US NANP 10 -> 1 + 10 digits unless international / carrier uses explicit format)
    let formattedDest = cleanDest;
    if (/^[2-9]\d{9}$/.test(cleanDest)) {
      formattedDest = `1${cleanDest}`;
    }

    const isInternalOrTestCall =
      ['8888', '8880', '*8888'].includes(cleanDest) ||
      /^4\d{3}$/.test(cleanDest) ||
      cleanDest.endsWith('8888') ||
      cleanDest.length <= 4;

    if (!isInternalOrTestCall && !/^\d{7,16}$/.test(formattedDest)) {
      return res.status(400).json({
        success: false,
        error: `Número destino inválido (${destination}). Ingresa entre 7 y 15 dígitos (ej. 13055551234 o 3055551234).`,
      });
    }

    // Determine effective agent destination: respect explicit 'ringall' or specific extension(s) from request
    let effectiveAgentExten = agentExten
      ? ((agentExten === 'ringall' || agentExten === 'all') ? 'ringall' : String(agentExten).trim())
      : (press1DestinationMode === 'ringall' ? 'ringall' : press1SelectedExtensions.join('&'));

    const authUser = (req as any).authUser;
    const authIsGlobalAdmin = isGlobalAdminUser(authUser);
    const effectiveTenantId = authIsGlobalAdmin
      ? req.body.tenantId
      : (authUser?.tenantId ? String(authUser.tenantId) : undefined);
    const effectiveUserId = authIsGlobalAdmin
      ? req.body.userId
      : (authUser?.id ? String(authUser.id) : undefined);

    if (!authIsGlobalAdmin && authUser && !isAdminUser(authUser) && Array.isArray(authUser.assignedExtensions) && authUser.assignedExtensions.length > 0) {
      const allowedSet = new Set(authUser.assignedExtensions.map((x: any) => String(x).trim()));
      if (effectiveAgentExten && effectiveAgentExten !== 'ringall' && effectiveAgentExten !== 'all') {
        const requestedParts = effectiveAgentExten.split('&').map((s: string) => s.trim()).filter(Boolean);
        const unauthorized = requestedParts.some((ext: string) => !allowedSet.has(ext));
        if (unauthorized) {
          return res.status(403).json({
            success: false,
            error: 'No tienes permiso para originar llamadas hacia esa extensión.',
          });
        }
      }
    }

    const explicitSuperAdminWithoutTenant = authIsGlobalAdmin && !effectiveTenantId;
    const activeCarriersForResolve = lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers();

    // Resolve Call Center Tenant & isolated extension range
    const tenantResolution = explicitSuperAdminWithoutTenant
      ? { tenant: null, carrierName: '' }
      : resolveTenantCarrierForCall(
          {
            tenantId: effectiveTenantId,
            agentExten: (effectiveAgentExten && effectiveAgentExten !== 'ringall' && effectiveAgentExten !== 'all')
              ? effectiveAgentExten
              : (req.body.callerExtension || req.body.agent),
          },
          activeCarriersForResolve
        );

    const userResolution = explicitSuperAdminWithoutTenant
      ? { user: null, carrierName: '' }
      : resolveUserCarrierForCall(
          {
            userId: effectiveUserId,
            agentExten: effectiveAgentExten,
            callerExtension: req.body.callerExtension || req.body.agent,
          },
          activeCarriersForResolve
        );

    const callerIsSuperAdmin = authIsGlobalAdmin;

    // Enforce admin-only permission for Centro de Llamadas Masivas
    const isMassCampaignCall = req.body.isMassCampaign === true || req.body.isMassCampaign === 'true';
    if (isMassCampaignCall && !callerIsSuperAdmin) {
      const massAllowed = isMassCallsAllowedForUser(userResolution.user || authUser, tenantResolution.tenant);
      if (!massAllowed) {
        return res.status(403).json({
          success: false,
          error: 'Acceso denegado: Solo el Administrador puede habilitar el Centro de Llamadas Masivas para clientes.',
        });
      }
    }

    // Enforce admin-assigned dialing plan (Plan de Marcación) for non-global-admin clients
    let enforcedMode = effectiveMode;
    const isManualDialerOnlyMode =
      effectiveMode === 'direct' ||
      effectiveMode === 'playback' ||
      effectiveMode === 'audio_playback' ||
      effectiveMode === 'audio_then_agent';
    if (!callerIsSuperAdmin && !isManualDialerOnlyMode) {
      const planScope = resolveClientDialingPlanScope(userResolution.user || authUser, tenantResolution.tenant);
      const normalizedReqMode = normalizeCallFlowMode(effectiveMode);
      enforcedMode = planScope.allowedModes.includes(normalizedReqMode)
        ? normalizedReqMode
        : planScope.assignedMode;
      targetContext =
        enforcedMode === 'otp'
          ? 'ivr-otp'
          : enforcedMode === 'hybrid'
          ? 'ivr-hybrid'
          : enforcedMode === 'cancel_code'
          ? 'ivr-press1-cancel'
          : enforcedMode === 'otp_press1'
          ? 'ivr-otp-verify'
          : 'ivr-press1';
    }

    if (tenantResolution.tenant && tenantResolution.tenant.status === 'suspended' && !callerIsSuperAdmin) {
      return res.status(403).json({
        success: false,
        error: `El Call Center "${tenantResolution.tenant.name}" se encuentra suspendido. Contacta al Super Administrador.`,
      });
    }

    if (tenantResolution.tenant && !callerIsSuperAdmin) {
      const t = tenantResolution.tenant;
      if (t.cutoffOnZero !== false && Number(t.dollarBalance ?? 1) <= 0) {
        return res.status(403).json({
          success: false,
          error: `Saldo agotado ($0.00) para "${t.name}". Recarga minutos para continuar marcando.`,
        });
      }
      const maxConc = Number(t.maxConcurrentCalls) || 0;
      if (maxConc > 0) {
        const activeSet = new Set<string>();
        const staleLimit = Date.now() - 12 * 60 * 1000;
        for (const [k, c] of callStatusStore.entries()) {
          if (!c || (c.timestamp && c.timestamp < staleLimit)) {
            callStatusStore.delete(k);
            continue;
          }
          if (c.tenantId === t.id && c.status !== 'ended' && c.status !== 'machine') {
            activeSet.add(c.number);
          }
        }
        if (activeSet.size >= maxConc) {
          return res.status(429).json({
            success: false,
            error: `Límite de llamadas simultáneas alcanzado (${activeSet.size}/${maxConc}) para "${t.name}".`,
          });
        }
      }
    } else if (userResolution.user && !callerIsSuperAdmin) {
      const mSettings = loadMembershipSettings();
      if (!mSettings.enforceMembershipSystem) {
        const cli = resellerStore.clients.find(
          (c) => c.id === userResolution.user.id || c.sipUsername === String(userResolution.user.username || '').toLowerCase()
        );
        if (cli && cli.cutoffOnZero === true && Number(cli.balance ?? 1) <= 0) {
          return res.status(403).json({
            success: false,
            error: `Saldo agotado ($0.00) para la cuenta "${cli.name || cli.sipUsername}". Recarga saldo para continuar.`,
          });
        }
      }
    }

    // AISLAMIENTO RING-ALL POR CALL CENTER:
    // Si el modo es 'ringall' y pertenece a un Call Center (tenant) con rango [extensionStart, extensionEnd],
    // limitar estrictamente el timbrado a las extensiones de ese Call Center y NUNCA a todos los Call Centers.
    if ((effectiveAgentExten === 'ringall' || effectiveAgentExten === 'all') && tenantResolution.tenant && !explicitSuperAdminWithoutTenant) {
      const tStart = Number(tenantResolution.tenant.extensionStart);
      const tEnd = Number(tenantResolution.tenant.extensionEnd);
      if (!isNaN(tStart) && !isNaN(tEnd) && tEnd >= tStart) {
        const allExts = (Array.isArray(lastSyncedExtensions) && lastSyncedExtensions.length > 0)
          ? lastSyncedExtensions
          : loadStoredExtensions();
        const tenantExts = allExts
          .filter((e: any) => {
            if (!e || e.enabled === false) return false;
            const n = parseInt(String(e.extension || e.id || '').trim(), 10);
            return !isNaN(n) && n >= tStart && n <= tEnd;
          })
          .map((e: any) => String(e.extension || e.id).trim());

        if (tenantExts.length > 0) {
          effectiveAgentExten = tenantExts.join('&');
        } else if (Array.isArray(req.body.tenantExtensions) && req.body.tenantExtensions.length > 0) {
          effectiveAgentExten = req.body.tenantExtensions.map((x: any) => String(x).trim()).filter(Boolean).join('&');
        } else if (tEnd - tStart <= 50) {
          const rangeExts: string[] = [];
          for (let n = tStart; n <= tEnd; n++) rangeExts.push(String(n));
          effectiveAgentExten = rangeExts.join('&');
        }
      }
    }

    // Save payload for automatic retry ONLY if explicitly requested (e.g. mass campaign with AMD active)
    const shouldAutoRetry = req.body.autoRetry === true || req.body.autoRetry === 'true' || req.body.autoRetry === 1;
    if (!shouldAutoRetry) {
      lastOriginatePayloads.delete(cleanDest);
      lastOriginatePayloads.delete(formattedDest);
      callRetryAttempts.delete(cleanDest);
      callRetryAttempts.delete(formattedDest);
    }

    // Enforce assigned outbound carrier for non-SuperAdmin clients (User explicit > Tenant > Pool)
    const authUserCarrierDirect = (!explicitSuperAdminWithoutTenant && authUser)
      ? resolveCarrierNameByRef(authUser.carrierId || authUser.assignedCarrierId || '', activeCarriersForResolve, true)
      : '';
    const defaultAssignedCarrier = userResolution.carrierName || authUserCarrierDirect || tenantResolution.carrierName;
    let cleanCarrier = callerIsSuperAdmin
      ? String(carrier || '').trim()
      : (defaultAssignedCarrier || '');
    if (callerIsSuperAdmin && !cleanCarrier && defaultAssignedCarrier) {
      cleanCarrier = defaultAssignedCarrier;
    }

    const activePool = activeCarriersForResolve
      .filter((c: any) => c && c.name && c.host && c.enabled !== false && c.status !== 'disabled');
    let resolvedCarrierObj: any = null;

    if (!isInternalOrTestCall) {
      if (activePool.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No hay ningún Carrier SIP habilitado en el sistema. Activa o agrega un Carrier antes de lanzar llamadas.',
        });
      }
      if (cleanCarrier && cleanCarrier !== 'auto' && cleanCarrier !== 'pool') {
        const refSlug = cleanCarrier.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        const matchedCarrier = activePool.find((c: any) => {
          const cSlug = String(c.name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
          return String(c.id || '').toLowerCase() === cleanCarrier.toLowerCase() || String(c.name || '').toLowerCase() === cleanCarrier.toLowerCase() || cSlug === refSlug;
        });
        if (!matchedCarrier) {
          return res.status(400).json({
            success: false,
            error: `El Carrier asignado ("${cleanCarrier}") está deshabilitado o no existe. Habilítalo o selecciona otro Carrier activo.`,
          });
        }
        resolvedCarrierObj = matchedCarrier;
        cleanCarrier = String(matchedCarrier.name).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      }
    }

    // If carrier expects raw 10 digits or specific pattern, preserve 10-digit cleanDest instead of forcing leading 1
    if (resolvedCarrierObj && !isInternalOrTestCall) {
      const cPat = String(resolvedCarrierObj.dialplanPattern || '').trim().toLowerCase();
      if ((cPat === '_xxxxxxxxxx' || cPat === '10_digits' || cPat === '10') && cleanDest.length === 10) {
        formattedDest = cleanDest;
      }
    }

    // Caller ID assigned by the SIP provider (use carrier's explicit outboundCallerId only if configured on that carrier)
    const carrierExplicitCid = resolvedCarrierObj?.outboundCallerId && !String(resolvedCarrierObj.outboundCallerId).includes('5550199') && !/asignado/i.test(String(resolvedCarrierObj.outboundCallerId))
      ? String(resolvedCarrierObj.outboundCallerId).trim()
      : '';
    if (carrierExplicitCid) {
      effectiveCidNum = carrierExplicitCid;
      effectiveCidName = resolvedCarrierObj?.outboundCallerName || resolvedCarrierObj?.outboundCallerIdName || '';
    } else {
      // Let the provider assign Caller ID natively on the SIP trunk
      effectiveCidNum = '';
      effectiveCidName = '';
    }

    // Save campaign-selected audio, CallerID and Carrier configuration to AstDB for this destination number
    const astDbCommands: string[] = [
      `database del ivr_vars ${cleanDest}_cancelled`,
      `database del ivr_vars ${clean10}_cancelled`,
      `database del ivr_vars ${formattedDest}_cancelled`,
      `database put call_status ${cleanDest} "dialing"`,
      `database put call_status ${formattedDest} "dialing"`,
      `database put ivr_vars ${cleanDest}_mode "${mode || 'press1'}"`,
      `database put ivr_vars ${cleanDest}_agent_exten "${effectiveAgentExten}"`,
      `database put ivr_vars ${formattedDest}_mode "${mode || 'press1'}"`,
      `database put ivr_vars ${formattedDest}_agent_exten "${effectiveAgentExten}"`,
      `database put test_client_number "${cleanDest}"`,
      `database put ivr_vars default_action "${targetContext}"`,
    ];

    if (effectiveCidNum) {
      astDbCommands.push(`database put ivr_vars ${cleanDest}_cid_num "${effectiveCidNum}"`);
      astDbCommands.push(`database put ivr_vars ${cleanDest}_cid_name "${effectiveCidName}"`);
      astDbCommands.push(`database put ivr_vars ${formattedDest}_cid_num "${effectiveCidNum}"`);
      astDbCommands.push(`database put ivr_vars ${formattedDest}_cid_name "${effectiveCidName}"`);
    } else {
      astDbCommands.push(`database put ivr_vars ${cleanDest}_cid_num ""`);
      astDbCommands.push(`database put ivr_vars ${cleanDest}_cid_name ""`);
      astDbCommands.push(`database put ivr_vars ${formattedDest}_cid_num ""`);
      astDbCommands.push(`database put ivr_vars ${formattedDest}_cid_name ""`);
    }

    const singleAgentExts = (effectiveAgentExten && effectiveAgentExten !== 'ringall' && effectiveAgentExten !== 'all')
      ? effectiveAgentExten.split('&').map((s: string) => s.trim()).filter(Boolean)
      : [];

    if (cleanCarrier && cleanCarrier !== 'auto' && cleanCarrier !== 'pool') {
      astDbCommands.push(`database put ivr_vars ${cleanDest}_carrier "${cleanCarrier}"`);
      astDbCommands.push(`database put ivr_vars ${formattedDest}_carrier "${cleanCarrier}"`);
      for (const ext of singleAgentExts) {
        astDbCommands.push(`database put user_carrier ${ext} "${cleanCarrier}"`);
      }
    } else {
      astDbCommands.push(`database put ivr_vars ${cleanDest}_carrier ""`);
      astDbCommands.push(`database put ivr_vars ${formattedDest}_carrier ""`);
    }

    // Fallback entity resolution from server master catalog if client omitted or sent empty audio paths
    let fallbackEntity: any = null;
    try {
      const masterEntities = getMasterEntitiesFromDisk(authUser);
      const reqEntId = String(req.body.entityId || req.body.selectedService || req.body.service || '').trim();
      const userAssigned: string[] | null = Array.isArray(authUser?.assignedEntityIds) ? authUser.assignedEntityIds.map(String) : null;
      const tenantAssigned: string[] | null = Array.isArray(tenantResolution.tenant?.assignedEntityIds) ? tenantResolution.tenant.assignedEntityIds.map(String) : null;
      const scopedMaster = masterEntities.filter((e: any) => {
        if (!e || e.isActive === false) return false;
        if (callerIsSuperAdmin) return true;
        if (userAssigned && !userAssigned.includes(String(e.id))) return false;
        if (tenantAssigned && !tenantAssigned.includes(String(e.id))) return false;
        return true;
      });
      fallbackEntity = scopedMaster.find((e: any) => e.id === reqEntId || e.name === reqEntId) || scopedMaster[0] || masterEntities[0] || null;
    } catch (_) {}

    const reqIntroRaw = String(audioIntro || req.body.intro || fallbackEntity?.introAudioPath || '').trim();
    const reqPromptRaw = String(audioPrompt || req.body.prompt || fallbackEntity?.promptAudioPath || '').trim();
    const reqAgentRaw = String(audioAgent || req.body.agentAudio || fallbackEntity?.agentAudioPath || '').trim();
    const reqSuccessRaw = String(audioSuccess || req.body.success || fallbackEntity?.successAudioPath || '').trim();
    const reqWaitRaw = String(req.body.wait || fallbackEntity?.waitAudioPath || '').trim();
    const reqCancelWaitRaw = String(req.body.audioCancelWait || req.body.cancelWait || fallbackEntity?.cancelCodeAudioPath || '').trim();
    const reqOtpVerifyWaitRaw = String(req.body.audioOtpVerifyWait || req.body.otpVerifyWait || fallbackEntity?.otpVerifyWaitAudioPath || '').trim();

    const defaultIntroFallback = (enforcedMode === 'cancel_code' || enforcedMode === 'otp_press1')
      ? 'custom/bienvenida_press1'
      : 'custom/bienvenida_corporativa';
    const defaultPromptFallback = (enforcedMode === 'cancel_code')
      ? 'custom/digite_codigo_cancelacion'
      : (enforcedMode === 'otp_press1')
      ? 'custom/digite_codigo_verificacion'
      : 'custom/solicitar_codigo_otp';
    const defaultSuccessFallback = (enforcedMode === 'cancel_code')
      ? 'custom/operacion_cancelada_exito'
      : (enforcedMode === 'otp_press1')
      ? 'custom/otp_validado_exito'
      : 'custom/operacion_bloqueada_exito';

    const cleanIntro = resolveVerifiedAsteriskSoundPath(reqIntroRaw, defaultIntroFallback);
    const cleanPrompt = resolveVerifiedAsteriskSoundPath(reqPromptRaw, defaultPromptFallback);
    const cleanAgent = resolveVerifiedAsteriskSoundPath(reqAgentRaw, 'custom/conectar_asesor');
    const cleanSuccess = resolveVerifiedAsteriskSoundPath(reqSuccessRaw, defaultSuccessFallback);
    const cleanWait = resolveVerifiedAsteriskSoundPath(reqWaitRaw, 'custom/un_momento_validando_informacion');
    const cleanCancelWait = resolveVerifiedAsteriskSoundPath(reqCancelWaitRaw, 'custom/enviando_codigo_cancelacion');
    const cleanOtpVerifyWait = resolveVerifiedAsteriskSoundPath(reqOtpVerifyWaitRaw, 'custom/enviando_codigo_verificacion');
    const clean10Ast = cleanDest.length === 11 && cleanDest.startsWith('1') ? cleanDest.substring(1) : cleanDest;

    // Reset any stale otp_status for this destination so a fresh call starts pending
    astDbCommands.push(`database put otp_status "${cleanDest}" "pending"`);
    if (clean10Ast) {
      astDbCommands.push(`database put otp_status "${clean10Ast}" "pending"`);
      astDbCommands.push(`database put otp_status "1${clean10Ast}" "pending"`);
    }

    const dbKeyPrefixTargets = [cleanDest, formattedDest];
    if (tenantResolution.tenant?.id) {
      dbKeyPrefixTargets.push(`tenant_${String(tenantResolution.tenant.id).trim()}`);
    }
    if (singleAgentExts[0]) {
      dbKeyPrefixTargets.push(`agent_${singleAgentExts[0]}`);
    }
    if (cleanDest === '8888' && callerIsSuperAdmin && !tenantResolution.tenant?.id) {
      dbKeyPrefixTargets.push('8888', 'default');
    }

    for (const prefix of Array.from(new Set(dbKeyPrefixTargets.filter(Boolean)))) {
      if (cleanIntro) astDbCommands.push(`database put ivr_vars ${prefix}_intro "${cleanIntro}"`);
      if (cleanPrompt) astDbCommands.push(`database put ivr_vars ${prefix}_prompt "${cleanPrompt}"`);
      if (cleanWait) astDbCommands.push(`database put ivr_vars ${prefix}_wait "${cleanWait}"`);
      if (cleanAgent) astDbCommands.push(`database put ivr_vars ${prefix}_agent "${cleanAgent}"`);
      if (cleanSuccess) astDbCommands.push(`database put ivr_vars ${prefix}_success "${cleanSuccess}"`);
      if (cleanCancelWait) astDbCommands.push(`database put ivr_vars ${prefix}_cancel_wait "${cleanCancelWait}"`);
      if (cleanOtpVerifyWait) astDbCommands.push(`database put ivr_vars ${prefix}_otp_verify_wait "${cleanOtpVerifyWait}"`);
    }

    const rawHoldMusic = (req.body.holdMusic || req.body.audioHold || '').trim().replace(/\.wav$/i, '');
    const holdMusic = rawHoldMusic
      ? (LEGACY_CUSTOM_HOLD_PATHS.has(rawHoldMusic) ? 'default' : rawHoldMusic)
      : '';
    if (holdMusic) {
      astDbCommands.push(`database put ivr_vars ${cleanDest}_hold_music "${holdMusic}"`);
      astDbCommands.push(`database put ivr_vars ${formattedDest}_hold_music "${holdMusic}"`);
      if (tenantResolution.tenant?.id) {
        astDbCommands.push(`database put ivr_vars tenant_${tenantResolution.tenant.id}_hold_music "${holdMusic}"`);
      }
      if (callerIsSuperAdmin) {
        astDbCommands.push(`database put ivr_vars default_hold_music "${holdMusic}"`);
        activeAudioAssignments.hold_music = holdMusic;
        saveActiveAudioAssignments(activeAudioAssignments);
      }
    }

    // Sync AstDB variables right before originating (bounded 250ms wait prevents race conditions without stalling)
    if (hasLocalAsterisk && astDbCommands.length > 0) {
      await Promise.race([
        Promise.all(astDbCommands.map((c) => executeAsteriskCommand(c).catch(() => ''))),
        new Promise((resolve) => setTimeout(resolve, 250)),
      ]);
    }

    // Ensure Asterisk PJSIP configuration has standard transports and valid AORs ready before dialing
    try {
      const pjsipPath = '/etc/asterisk/pjsip.conf';
      if (fs.existsSync(pjsipPath)) {
        const curContent = fs.readFileSync(pjsipPath, 'utf8');
        if ((!curContent.includes('type = transport') && !curContent.includes('type=transport')) || curContent.includes('1001-aor')) {
          const activeExts = lastSyncedExtensions.length > 0 ? lastSyncedExtensions : loadStoredExtensions();
          const activeCarriers = lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers();
          const fixedPjsip = generateCleanPjsipConf(activeExts, activeCarriers, loadStoredUsers());
          fs.writeFileSync(pjsipPath, fixedPjsip, 'utf8');
          fs.writeFileSync(path.join(process.cwd(), 'pjsip.conf'), fixedPjsip, 'utf8');
          if (hasLocalAsterisk) {
            exec('asterisk -rx "pjsip reload"', () => {});
          }
        }
      }
    } catch (_) {}

    // Determine channel:
    // If destination is an internal IVR test extension (8888, 4001+, etc.), route to the agent softphone (PJSIP/1001)
    // so the softphone actually rings, answers, and connects to the IVR for audio testing!
    // If <= 4 digits (and not IVR extension), direct SIP endpoint (e.g. agent phone 1001)
    // Otherwise standard outbound call via Local NANP routing
    let channel = '';
    const firstSingleAgent = (effectiveAgentExten && effectiveAgentExten !== 'ringall' && effectiveAgentExten !== 'all')
      ? effectiveAgentExten.split('&')[0].trim()
      : '1001';
    if (['8888', '8880', '*8888'].includes(cleanDest) || /^4\d{3}$/.test(cleanDest) || cleanDest.endsWith('8888')) {
      channel = `PJSIP/${firstSingleAgent || '1001'}`;
    } else if (cleanDest.length <= 4) {
      channel = `PJSIP/${cleanDest}`;
    } else if (effectiveMode === 'direct' && effectiveAgentExten && effectiveAgentExten !== 'ringall' && effectiveAgentExten !== 'all') {
      channel = `PJSIP/${firstSingleAgent}`;
    } else {
      channel = `Local/${formattedDest}@from-internal/n`;
    }

    // Register active call in status store
    const initialCallState: CallState = {
      number: cleanDest,
      channel,
      status: 'dialing',
      agent: agentExten || 'ringall',
      agentName: (agentExten === 'ringall' || agentExten === 'all')
        ? '⚡ Todas las Extensiones (Ring-All)'
        : (agentExten === '1001' ? 'Operador Principal (Ext. 1001)' : `Ext. ${agentExten}`),
      clientName: req.body.victimName || req.body.clientName || 'Cliente',
      entityName: service || 'Servicio al Cliente',
      entityId: req.body.entityId || 'bank',
      holdMusic: req.body.holdMusic || activeAudioAssignments.hold_music || 'default',
      holdMusicName:
        !req.body.holdMusic || req.body.holdMusic === 'default'
          ? 'Asterisk Default (MOH)'
          : path.basename(req.body.holdMusic),
      trunk: cleanCarrier || 'auto',
      callerId: effectiveCidNum || 'Asignado por Proveedor',
      tenantId: tenantResolution.tenant?.id,
      userId: effectiveUserId || authUser?.id,
      mode: enforcedMode,
      startTime: Date.now(),
      timestamp: Date.now(),
      duration: 0,
    };
    callStatusStore.set(cleanDest, initialCallState);
    callStatusStore.set(formattedDest, initialCallState);

    // Fast AMI Originate (Under 20ms asynchronous dispatch)
    // NEVER send an empty CallerID when originating to PJSIP extensions (1001/1002) or Local channels,
    // otherwise Asterisk sends "Anonymous" <anonymous@anonymous.invalid> in the SIP INVITE From header!
    const callerLabelExt = (req.body.callerExtension && /^[a-zA-Z0-9_\-]{2,12}$/.test(String(req.body.callerExtension).trim()))
      ? String(req.body.callerExtension).trim()
      : '1001';
    const isIvrTestExten = ['8888', '8880', '*8888'].includes(cleanDest) || /^4\d{3}$/.test(cleanDest) || cleanDest.endsWith('8888');
    const originateCallerId = channel.startsWith('PJSIP/')
      ? (cleanDest.length > 4 && !isIvrTestExten
          ? `"${cleanDest}" <${cleanDest}>`
          : `"Sistema Web (${cleanDest})" <${effectiveCidNum || callerLabelExt}>`)
      : (effectiveCidNum
          ? `"${effectiveCidName || effectiveCidNum}" <${effectiveCidNum}>`
          : `"Sistema Web" <${callerLabelExt}>`);
    const effectiveAmdEnabled = (typeof req.body.amdEnabled === 'boolean') ? req.body.amdEnabled : isAmdEnabled;
    const retryCallAgent = cleanAgent;
    const retryCallIntro = cleanIntro;
    const retryCallPrompt = cleanPrompt;
    const retryCallWait = cleanWait;
    const retryCallSuccess = cleanSuccess;
    const retryHoldMusic = holdMusic || '';

    if (shouldAutoRetry) {
      const retryPayload = {
        ...req.body,
        mode: enforcedMode,
        callMode: enforcedMode,
        agentExten: effectiveAgentExten,
        tenantId: tenantResolution.tenant?.id || effectiveTenantId,
        userId: effectiveUserId || authUser?.id,
        carrier: cleanCarrier || req.body.carrier || 'auto',
        callerIdNum: effectiveCidNum,
        callerIdName: effectiveCidName,
        amdEnabled: effectiveAmdEnabled,
        audioIntro: retryCallIntro,
        audioPrompt: retryCallPrompt,
        wait: retryCallWait,
        audioSuccess: retryCallSuccess,
        audioAgent: retryCallAgent,
        audioCancelWait: cleanCancelWait,
        audioOtpVerifyWait: cleanOtpVerifyWait,
        holdMusic: retryHoldMusic,
        autoRetry: true,
      };
      lastOriginatePayloads.set(cleanDest, retryPayload);
      lastOriginatePayloads.set(formattedDest, retryPayload);
      callRetryAttempts.set(cleanDest, 1);
      callRetryAttempts.set(formattedDest, 1);
    }

    const primaryCallingAgent = singleAgentExts[0] || callerLabelExt || '1001';
    const originateVars: Record<string, string> = {
      TARGET_DEST: cleanDest,
      CALL_DEST: cleanDest,
      TARGET_NUM: cleanDest,
      __TARGET_NUM: cleanDest,
      __TARGET_DEST: cleanDest,
      __CALL_DEST: cleanDest,
      ...(tenantResolution.tenant?.id ? { TENANT_ID: String(tenantResolution.tenant.id), __TENANT_ID: String(tenantResolution.tenant.id) } : {}),
      AUTO_RETRY: shouldAutoRetry ? '1' : '0',
      __AUTO_RETRY: shouldAutoRetry ? '1' : '0',
      AMD_ENABLED: effectiveAmdEnabled ? '1' : '0',
      __AMD_ENABLED: effectiveAmdEnabled ? '1' : '0',
      IVR_AGENT_EXTEN: effectiveAgentExten || 'ringall',
      __IVR_AGENT_EXTEN: effectiveAgentExten || 'ringall',
      CALLING_AGENT: primaryCallingAgent,
      __CALLING_AGENT: primaryCallingAgent,
      ...(retryCallIntro ? { CALL_INTRO: retryCallIntro, __CALL_INTRO: retryCallIntro } : {}),
      ...(retryCallPrompt ? { CALL_PROMPT: retryCallPrompt, __CALL_PROMPT: retryCallPrompt } : {}),
      ...(retryCallWait ? { CALL_WAIT: retryCallWait, __CALL_WAIT: retryCallWait } : {}),
      ...(retryCallSuccess ? { CALL_SUCCESS: retryCallSuccess, __CALL_SUCCESS: retryCallSuccess } : {}),
      ...(retryCallAgent ? { CALL_AGENT: retryCallAgent, __CALL_AGENT: retryCallAgent } : {}),
      ...(cleanCancelWait ? { CALL_CANCEL_WAIT: cleanCancelWait, __CALL_CANCEL_WAIT: cleanCancelWait } : {}),
      ...(cleanOtpVerifyWait ? { CALL_OTP_VERIFY_WAIT: cleanOtpVerifyWait, __CALL_OTP_VERIFY_WAIT: cleanOtpVerifyWait } : {}),
      ...(retryHoldMusic ? { CALL_HOLD_MUSIC: retryHoldMusic, __CALL_HOLD_MUSIC: retryHoldMusic } : {}),
      IVR_MODE: enforcedMode || 'press1',
      __IVR_MODE: enforcedMode || 'press1',
      ...(effectiveUserId || authUser?.id ? { CALL_USER_ID: String(effectiveUserId || authUser?.id), __CALL_USER_ID: String(effectiveUserId || authUser?.id) } : {}),
      ASSIGNED_CARRIER: (cleanCarrier && cleanCarrier !== 'auto' && cleanCarrier !== 'pool') ? cleanCarrier : '',
      __ASSIGNED_CARRIER: (cleanCarrier && cleanCarrier !== 'auto' && cleanCarrier !== 'pool') ? cleanCarrier : '',
      OUTBOUND_CARRIER: (cleanCarrier && cleanCarrier !== 'auto' && cleanCarrier !== 'pool') ? cleanCarrier : '',
      __OUTBOUND_CARRIER: (cleanCarrier && cleanCarrier !== 'auto' && cleanCarrier !== 'pool') ? cleanCarrier : '',
    };

    const targetExten = (targetContext === 'from-internal') ? formattedDest : 's';

    amiFastOriginate(channel, targetContext, targetExten, originateCallerId, originateVars)
      .then((fastResult) => {
        if (fastResult.success) {
          console.log(`[FAST ORIGINATE SUCCESS] Llamada enviada a Asterisk vía AMI socket para ${channel} (${cleanDest})`);
        } else {
          console.warn('[FAST ORIGINATE FALLBACK] AMI retornó advertencia, disparando fallback:', fastResult.message);
          fallbackOriginate(channel, targetContext, targetExten, originateCallerId, originateVars);
        }
      })
      .catch((err) => {
        console.warn('[FAST ORIGINATE EXCEPTION] Ejecutando fallback de llamada:', err.message);
        fallbackOriginate(channel, targetContext, targetExten, originateCallerId, originateVars);
      });

    res.json({
      success: true,
      message: `Llamada originada instantáneamente hacia ${cleanDest} con CallerID "${effectiveCidName}" <${effectiveCidNum}>.`,
      channel,
      callerId: {
        num: effectiveCidNum,
        name: effectiveCidName,
      },
      assignedAudios: {
        intro: audioIntro || 'beep (predeterminado)',
        prompt: audioPrompt || 'beep (predeterminado)',
        agent: audioAgent || 'inmediato',
        success: audioSuccess || 'SayDigits (predeterminado)',
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint for agent to mark captured OTP as valid or invalid
app.post('/api/asterisk/otp/verify', requireActiveMembership, (req, res) => {
  try {
    const { id, number, status } = req.body;
    if (!status || !['valid', 'invalid', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status debe ser valid, invalid o pending' });
    }

    const authUser = (req as any).authUser;
    const item = capturedOtpHistory.find((r) => r.id === id || (number && r.number === number));
    if (item) {
      if (!isGlobalAdminUser(authUser)) {
        if (authUser?.tenantId && item.tenantId && String(item.tenantId) !== String(authUser.tenantId)) {
          return res.status(403).json({ success: false, error: 'No autorizado para modificar OTP de otro Call Center.' });
        }
        if (!isAdminUser(authUser) && Array.isArray(authUser?.assignedExtensions) && authUser.assignedExtensions.length > 0 && item.agent) {
          if (!authUser.assignedExtensions.map(String).includes(String(item.agent))) {
            return res.status(403).json({ success: false, error: 'No autorizado para modificar OTP de otra extensión.' });
          }
        }
      }
      item.status = status;
      saveStoredOtpHistory(capturedOtpHistory);
      console.log(`[VERIFICACIÓN AGENTE] OTP ${item.otp} de ${item.number} marcado como ${status.toUpperCase()}`);
      return res.json({ success: true, item, message: `Código ${item.otp} marcado como ${status}` });
    }

    // If item not found by id/number, respond ok
    res.json({ success: true, message: `Estado actualizado a ${status}` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint for direct 1-click update of Agent Extension CallerID (Num & Name) into AstDB
app.post('/api/asterisk/extension/callerid', requireAdminRole, (req, res) => {
  try {
    const { extension, callerIdNum, callerIdName } = req.body || {};
    if (!extension || !callerIdNum) {
      return res.status(400).json({ success: false, error: 'Faltan parámetros: extension y callerIdNum son requeridos.' });
    }

    const cleanExt = String(extension).trim().replace(/[^a-zA-Z0-9_\-]/g, '');
    const cleanNum = String(callerIdNum).trim().replace(/[^0-9+*#]/g, '');
    const cleanName = String(callerIdName || cleanExt).trim().replace(/[^a-zA-Z0-9 _\-.]/g, '').slice(0, 40) || cleanExt;

    if (!cleanExt || !cleanNum) {
      return res.status(400).json({ success: false, error: 'Parámetros de extensión o CallerID inválidos.' });
    }

    // Store in Asterisk DB safely via execFile and AMI
    const putNumCmd = `database put extension_cid ${cleanExt}/number "${cleanNum}"`;
    const putNameCmd = `database put extension_cid ${cleanExt}/name "${cleanName}"`;

    executeAsteriskCommand(putNumCmd).catch(() => {});
    executeAsteriskCommand(putNameCmd).catch(() => {});

    sendAmiAction('127.0.0.1', AMI_PORT, AMI_USER, AMI_SECRET, [
      putNumCmd,
      putNameCmd,
    ]).catch(() => {});

    res.json({
      success: true,
      message: `CallerID de la extensión ${cleanExt} actualizado a "${cleanName}" <${cleanNum}> en Asterisk AstDB.`,
      extension: cleanExt,
      callerIdNum: cleanNum,
      callerIdName: cleanName,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// ENDPOINTS PARA GESTIÓN DE AUDIOS PREGRABADOS
// ==========================================

// List available audio files on server
app.get('/api/asterisk/audio/list', (req, res) => {
  try {
    if (!fs.existsSync(SOUNDS_CUSTOM_DIR)) {
      try {
        fs.mkdirSync(SOUNDS_CUSTOM_DIR, { recursive: true });
      } catch (e) {}
    }

    if (fs.existsSync(SOUNDS_CUSTOM_DIR)) {
      const files = fs.readdirSync(SOUNDS_CUSTOM_DIR);
      const audioFiles = files
        .filter((f) => f.endsWith('.wav') || f.endsWith('.gsm') || f.endsWith('.mp3'))
        .map((f) => {
          const stats = fs.statSync(path.join(SOUNDS_CUSTOM_DIR, f));
          const baseName = f.replace(/\.[^/.]+$/, '');
          return {
            fileName: f,
            asteriskPath: `custom/${baseName}`,
            sizeBytes: stats.size,
            sizeKb: (stats.size / 1024).toFixed(1) + ' KB',
            modifiedAt: stats.mtime.toISOString(),
          };
        });
      return res.json({ success: true, files: audioFiles, directory: SOUNDS_CUSTOM_DIR });
    }

    res.json({ success: true, files: [], directory: SOUNDS_CUSTOM_DIR });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload and convert audio file to Asterisk format (WAV 8000Hz PCM 16-bit Mono)
app.post('/api/asterisk/audio/upload', requireActiveMembership, express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const authUser = (req as any).authUser;
    if (!isAdminUser(authUser) && !authUser?.permissions?.canUploadAudio) {
      return res.status(403).json({ success: false, error: 'No tienes permiso para subir audios IVR.' });
    }
    const { name, fileName, category, dataUrl } = req.body;

    if (!dataUrl) {
      return res.status(400).json({ success: false, error: 'No se envió contenido de audio (dataUrl requerido)' });
    }

    // Clean base name for Asterisk
    const rawName = (fileName || name || 'audio_' + Date.now())
      .toLowerCase()
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_');

    const cleanBaseName = rawName.slice(0, 40) || `prompt_${Date.now()}`;
    const targetWavName = `${cleanBaseName}.wav`;
    const targetPath = path.join(SOUNDS_CUSTOM_DIR, targetWavName);

    // Extract base64 payload
    const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    const buffer = matches && matches[2]
      ? Buffer.from(matches[2], 'base64')
      : Buffer.from(dataUrl, 'base64');

    // Ensure custom sounds directory exists without insecure 777 permissions
    try {
      if (!fs.existsSync(SOUNDS_CUSTOM_DIR)) {
        fs.mkdirSync(SOUNDS_CUSTOM_DIR, { recursive: true, mode: 0o775 });
      }
    } catch (_) {}

    // Save temporary raw file
    const tempRawPath = `/tmp/raw_${cleanBaseName}_${Date.now()}`;
    fs.writeFileSync(tempRawPath, buffer, { mode: 0o600 });

    const onAudioSavedSuccess = (method: string) => {
      console.log(`[AUDIO SAVED via ${method}] custom/${cleanBaseName}.wav`);
      if (category === 'hold_music') {
        applyAudioAssignmentToAsterisk('hold_music', `custom/${cleanBaseName}`);
      } else if (category && category !== 'custom') {
        applyAudioAssignmentToAsterisk(category, `custom/${cleanBaseName}`);
      }

      // Replicate upload to remote VPS if available (only from web client without local Asterisk)
      if (!hasLocalAsterisk && REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('localhost') && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') && !req.headers['x-governor-fwd']) {
        try {
          fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/audio/upload`, {
            method: 'POST',
            headers: buildRemoteAuthHeaders(req, { 'Content-Type': 'application/json' }),
            body: JSON.stringify(req.body),
          }).catch(() => {});
        } catch (_) {}
      }
    };

    const mirrorUploadedWav = (srcWav: string) => {
      try { fs.chmodSync(srcWav, 0o644); } catch (_) {}
      for (const dstDir of ['/var/lib/asterisk/sounds/es/custom', '/var/lib/asterisk/sounds/en/custom', '/var/lib/asterisk/sounds']) {
        try {
          if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true, mode: 0o755 });
          const dstWav = path.join(dstDir, targetWavName);
          fs.copyFileSync(srcWav, dstWav);
          try { fs.chmodSync(dstWav, 0o644); } catch (_) {}
        } catch (_) {}
      }
      ensureNativeUlawFromWav(srcWav, ['/var/lib/asterisk/sounds/es/custom', '/var/lib/asterisk/sounds/en/custom', '/var/lib/asterisk/sounds']);
      for (const staleGsm of [
        srcWav.replace(/\.wav$/i, '.gsm'),
        path.join('/var/lib/asterisk/sounds/es/custom', `${cleanBaseName}.gsm`),
        path.join('/var/lib/asterisk/sounds/en/custom', `${cleanBaseName}.gsm`),
        path.join('/var/lib/asterisk/sounds', `${cleanBaseName}.gsm`),
      ]) {
        try { if (fs.existsSync(staleGsm)) fs.unlinkSync(staleGsm); } catch (_) {}
      }
    };

    execFile('ffmpeg', ['-y', '-i', tempRawPath, '-ar', '8000', '-ac', '1', '-c:a', 'pcm_s16le', targetPath], (ffmpegErr) => {
      if (!ffmpegErr) {
        try { fs.unlinkSync(tempRawPath); } catch (e) {}
        mirrorUploadedWav(targetPath);
        console.log(`[AUDIO OK - ffmpeg] Convertido a ${targetPath} (+ .ulaw nativo)`);
        onAudioSavedSuccess('ffmpeg');
        return res.json({
          success: true,
          asteriskPath: `custom/${cleanBaseName}`,
          fileName: targetWavName,
          format: 'WAV 8000Hz PCM 16-bit Mono + ULAW',
          message: `Audio guardado y optimizado para Asterisk (sin transcodificación) en custom/${cleanBaseName}`,
        });
      }

      // Try with Sox if ffmpeg failed
      execFile('sox', [tempRawPath, '-r', '8000', '-c', '1', '-b', '16', targetPath], (soxErr) => {
        if (!soxErr) {
          try { fs.unlinkSync(tempRawPath); } catch (e) {}
          mirrorUploadedWav(targetPath);
          console.log(`[AUDIO OK - sox] Convertido a ${targetPath} (+ .ulaw nativo)`);
          onAudioSavedSuccess('sox');
          return res.json({
            success: true,
            asteriskPath: `custom/${cleanBaseName}`,
            fileName: targetWavName,
            format: 'WAV 8000Hz PCM 16-bit Mono + ULAW',
            message: `Audio guardado y optimizado con sox (sin transcodificación) en custom/${cleanBaseName}`,
          });
        }

        // Fallback: direct write of the buffer
        try {
          fs.writeFileSync(targetPath, buffer, { mode: 0o644 });
          try { fs.unlinkSync(tempRawPath); } catch (e) {}
          mirrorUploadedWav(targetPath);
          onAudioSavedSuccess('direct');
          return res.json({
            success: true,
            asteriskPath: `custom/${cleanBaseName}`,
            fileName: targetWavName,
            format: 'Direct Write (WAV)',
            message: `Audio guardado en custom/${cleanBaseName}`,
          });
        } catch (directErr: any) {
          try { fs.unlinkSync(tempRawPath); } catch (e) {}
          return res.status(500).json({ success: false, error: directErr.message });
        }
      });
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Centralized Audio Assignment Manager for Asterisk ---
const ACTIVE_AUDIOS_FILE = path.join(process.cwd(), 'data', 'active_audios.json');
const AUDIO_LOCKS_FILE = path.join(process.cwd(), 'data', 'audio_locks.json');

const LEGACY_OTP_KEY_RE = /^(welcome|wait|success|failure|prompt|lock)_(3333|4444|5555|6666|7777|333|444|555|666|777)$/;

const DEFAULT_AUDIO_ASSIGNMENTS: Record<string, string> = {
  press1_welcome: 'custom/bienvenida_corporativa',
  agent_transfer: 'custom/conectar_asesor',
  press1_invalid: 'custom/opcion_invalida',

  // Generic system fallbacks (las extensiones dinámicas usan 4001+)
  otp_welcome: 'custom/solicitar_codigo_otp',
  otp_wait: 'custom/un_momento_validando_informacion',
  otp_verify_wait: 'custom/enviando_codigo_verificacion',
  otp_success: 'custom/operacion_bloqueada_exito',
  otp_failure: 'custom/token_invalido_reintente',
  hold_music: 'default',
};

function loadManualAudioLocks(): Record<string, boolean> {
  try {
    if (fs.existsSync(AUDIO_LOCKS_FILE)) {
      const raw = fs.readFileSync(AUDIO_LOCKS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const cleaned: Record<string, boolean> = {};
        let stripped = false;
        for (const [k, v] of Object.entries(parsed)) {
          if (LEGACY_OTP_KEY_RE.test(k)) {
            stripped = true;
            continue;
          }
          cleaned[k] = Boolean(v);
        }
        if (stripped) {
          saveManualAudioLocks(cleaned);
        }
        return cleaned;
      }
    }
  } catch (e) {}
  return {
    ivr_entity: false,
  };
}

function saveManualAudioLocks(data: Record<string, boolean>) {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(AUDIO_LOCKS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[AUDIO] Error guardando audio_locks.json:', e);
  }
}

let manualAudioLocks: Record<string, boolean> = loadManualAudioLocks();

const LEGACY_CUSTOM_HOLD_PATHS = new Set([
  'custom/voz_comercial_para_barrick_pueblo_viejo_',
  'custom/moh_banco_elegante',
  'custom/moh_corporate_loop',
  'custom/moh_digital_hold',
  'custom/moh_jazz_telecom',
]);

function loadActiveAudioAssignments(): Record<string, string> {
  try {
    if (fs.existsSync(ACTIVE_AUDIOS_FILE)) {
      const raw = fs.readFileSync(ACTIVE_AUDIOS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      const merged: Record<string, string> = { ...DEFAULT_AUDIO_ASSIGNMENTS };
      let strippedLegacy = false;
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (LEGACY_OTP_KEY_RE.test(k)) {
            strippedLegacy = true;
            continue;
          }
          if (typeof v === 'string') {
            merged[k] = v;
          }
        }
      }
      if (!merged.hold_music || LEGACY_CUSTOM_HOLD_PATHS.has(merged.hold_music)) {
        merged.hold_music = 'default';
        strippedLegacy = true;
      }
      if (strippedLegacy) {
        try {
          saveActiveAudioAssignments(merged);
        } catch (_) {}
      }
      return merged;
    }
  } catch (e) {
    console.warn('[AUDIO] Error leyendo active_audios.json, usando predeterminados:', e);
  }
  return { ...DEFAULT_AUDIO_ASSIGNMENTS };
}

function saveActiveAudioAssignments(data: Record<string, string>) {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(ACTIVE_AUDIOS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[AUDIO] Error guardando active_audios.json:', e);
  }
}

let activeAudioAssignments: Record<string, string> = loadActiveAudioAssignments();

let lastMohReloadTime = 0;
let lastMohAppliedPath = '';

// Restore Asterisk's native default Music on Hold (/var/lib/asterisk/moh)
// IMPORTANT: Never invoke apt-get from Node runtime as dpkg hooks restart asterisk.service and drop PJSIP extensions.
function restoreDefaultAsteriskMoh() {
  const mohDir = '/var/lib/asterisk/moh';
  const shareMohDir = '/usr/share/asterisk/moh';

  try {
    if (!fs.existsSync(mohDir)) {
      fs.mkdirSync(mohDir, { recursive: true, mode: 0o775 });
    }
  } catch (_) {}

  // Remove any previously injected non-Asterisk custom files from /var/lib/asterisk/moh
  const injectedCustomFiles = [
    'custom_moh.wav',
    'default_hold.wav',
    '01_hold_music.wav',
    'hold_music.wav',
    'active_hold.wav',
    'moh_corporate_loop.wav',
    'moh_digital_hold.wav',
    'moh_jazz_telecom.wav',
    'mi_audio.wav',
    'banrearreglado.wav',
    'alerta_banco_antifraude.wav',
    'conectar_asesor_banco.wav',
    'acceso_restringido_exito.wav',
    'bienvenida_corporativa.wav',
    'bienvenida_press1.wav',
    'solicitar_codigo_otp.wav',
    'un_momento_validando_informacion.wav',
    'voz_comercial_para_barrick_pueblo_viejo_.wav',
  ];
  for (const fname of injectedCustomFiles) {
    try {
      const target = path.join(mohDir, fname);
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
    } catch (_) {}
  }

  // Copy original Asterisk default tracks if /usr/share/asterisk/moh is separate and target is missing
  const nativeAsteriskTracks = [
    'macroform-cold_day.wav',
    'manolo_camp-morning_coffee.wav',
    'macroform-the_simplicity.wav',
    'macroform-robot_dity.wav',
    'reno_project-system.wav',
  ];
  try {
    const mohReal = fs.existsSync(mohDir) ? fs.realpathSync(mohDir) : mohDir;
    const shareReal = fs.existsSync(shareMohDir) ? fs.realpathSync(shareMohDir) : shareMohDir;
    if (mohReal !== shareReal && fs.existsSync(shareMohDir)) {
      for (const track of nativeAsteriskTracks) {
        const srcTrack = path.join(shareMohDir, track);
        const dstTrack = path.join(mohDir, track);
        if (fs.existsSync(srcTrack) && !fs.existsSync(dstTrack)) {
          fs.copyFileSync(srcTrack, dstTrack);
        }
      }
    }
  } catch (_) {}

  ensureMusiconholdConfExists(false);

  executeAsteriskCommand('database put ivr_vars default_hold_music "default"').catch(() => {});
  executeAsteriskCommand('database put ivr_vars hold_music "default"').catch(() => {});
  executeAsteriskCommand('database put ivr_vars global_hold_music "default"').catch(() => {});

  const now = Date.now();
  if (lastMohAppliedPath !== 'default' && (now - lastMohReloadTime > 15000)) {
    lastMohAppliedPath = 'default';
    lastMohReloadTime = now;
    executeAsteriskCommand('moh reload').catch(() => {});
  } else if (!lastMohAppliedPath) {
    lastMohAppliedPath = 'default';
  }

  console.log('[ASTERISK-MOH] ✓ Música de Hold configurada con música por defecto de Asterisk (/var/lib/asterisk/moh).');
}

// Helper to synchronize Asterisk Music on Hold (default or isolated custom directory)
function applyHoldMusicToAsteriskMoh(asteriskPath: string) {
  const cleanPath = String(asteriskPath || 'default').trim().replace(/\.wav$/, '');
  if (
    !cleanPath ||
    cleanPath === 'default' ||
    cleanPath === 'asterisk/default' ||
    cleanPath === 'moh/default' ||
    cleanPath === 'custom/default'
  ) {
    restoreDefaultAsteriskMoh();
    return;
  }

  const baseName = cleanPath.replace(/^custom\//, '');
  const srcFile = path.join(SOUNDS_CUSTOM_DIR, `${baseName}.wav`);
  const customMohDir = '/var/lib/asterisk/moh_custom';

  try {
    if (!fs.existsSync(customMohDir)) {
      fs.mkdirSync(customMohDir, { recursive: true, mode: 0o775 });
    }
  } catch (_) {}

  if (fs.existsSync(srcFile)) {
    try {
      for (const existingFile of fs.readdirSync(customMohDir)) {
        if (existingFile.endsWith('.wav')) {
          try { fs.unlinkSync(path.join(customMohDir, existingFile)); } catch (_) {}
        }
      }
      fs.copyFileSync(srcFile, path.join(customMohDir, `${baseName}.wav`));
    } catch (_) {}
    ensureMusiconholdConfExists(true);
  } else {
    restoreDefaultAsteriskMoh();
    return;
  }

  // Update AstDB keys
  executeAsteriskCommand(`database put ivr_vars default_hold_music "${cleanPath}"`).catch(() => {});
  executeAsteriskCommand(`database put ivr_vars hold_music "${cleanPath}"`).catch(() => {});
  executeAsteriskCommand(`database put ivr_vars global_hold_music "${cleanPath}"`).catch(() => {});

  // Reload MOH in Asterisk ONLY if the track has actually changed (strict protection against reload loops)
  const now = Date.now();
  if (lastMohAppliedPath !== cleanPath && (now - lastMohReloadTime > 15000)) {
    lastMohAppliedPath = cleanPath;
    lastMohReloadTime = now;
    executeAsteriskCommand('moh reload').catch(() => {});
  } else if (!lastMohAppliedPath) {
    lastMohAppliedPath = cleanPath;
  }

  console.log(`[ASTERISK-MOH] ✓ Música de Hold personalizada sincronizada en ${customMohDir}: ${cleanPath}`);
}

function sanitizeAsteriskSoundPath(rawPath: string | undefined, fallback = 'custom/solicitar_codigo_otp'): string {
  const cleaned = String(rawPath || '')
    .trim()
    .replace(/^\/?(?:var\/lib|usr\/share)\/asterisk\/sounds\/(?:[a-z]{2}\/)?/i, '')
    .replace(/\.(?:wav|ulaw|alaw|gsm|sln16|sln)$/i, '')
    .replace(/^(?:custom\/)+/i, 'custom/')
    .replace(/[^a-zA-Z0-9_\/\-]/g, '');
  return cleaned || fallback;
}

function asteriskSoundFileExistsOnDisk(cleanRelPath: string): boolean {
  if (!cleanRelPath || !fs.existsSync('/var/lib/asterisk/sounds')) return true;
  const normalized = cleanRelPath.replace(/^\/+/, '');
  const baseNoCustom = normalized.replace(/^custom\//, '');
  const dirsToCheck = [
    '/var/lib/asterisk/sounds',
    '/var/lib/asterisk/sounds/es',
    '/var/lib/asterisk/sounds/en',
  ];
  for (const dir of dirsToCheck) {
    for (const ext of ['.ulaw', '.wav', '.gsm']) {
      if (fs.existsSync(path.join(dir, `${normalized}${ext}`))) return true;
    }
  }
  if (SOUNDS_CUSTOM_DIR) {
    for (const ext of ['.ulaw', '.wav', '.gsm']) {
      if (fs.existsSync(path.join(SOUNDS_CUSTOM_DIR, `${baseNoCustom}${ext}`))) return true;
    }
  }
  return false;
}

function resolveVerifiedAsteriskSoundPath(rawPath: string | undefined, fallback: string): string {
  const cleanFallback = sanitizeAsteriskSoundPath(fallback, 'custom/bienvenida_corporativa');
  const candidate = sanitizeAsteriskSoundPath(rawPath, cleanFallback);
  if (asteriskSoundFileExistsOnDisk(candidate)) {
    return candidate;
  }
  if (asteriskSoundFileExistsOnDisk(cleanFallback)) {
    return cleanFallback;
  }
  return candidate;
}

async function syncOtpExtensionsToAstDb(listInput?: any[]) {
  const list = Array.isArray(listInput) ? listInput : loadStoredOtpExtensions();
  for (const item of list) {
    const extStr = String(item?.extension || '').replace(/[^0-9]/g, '');
    if (!extStr || Number(extStr) < 4001) continue;
    const pAudio = sanitizeAsteriskSoundPath((activeAudioAssignments as any)[`welcome_${extStr}`] || item?.promptAudio, 'custom/solicitar_codigo_otp');
    const wAudio = sanitizeAsteriskSoundPath((activeAudioAssignments as any)[`wait_${extStr}`] || item?.waitAudio, 'custom/un_momento_validando_informacion');
    const sAudio = sanitizeAsteriskSoundPath((activeAudioAssignments as any)[`success_${extStr}`] || item?.successAudio, 'custom/operacion_bloqueada_exito');
    const fAudio = sanitizeAsteriskSoundPath((activeAudioAssignments as any)[`failure_${extStr}`] || item?.failureAudio, 'custom/token_invalido_reintente');

    await executeAsteriskCommand(`database put ivr_vars "${extStr}_prompt" "${pAudio}"`).catch(() => {});
    await executeAsteriskCommand(`database put ivr_vars "${extStr}_intro" "${pAudio}"`).catch(() => {});
    await executeAsteriskCommand(`database put ivr_vars "${extStr}_wait" "${wAudio}"`).catch(() => {});
    await executeAsteriskCommand(`database put ivr_vars "${extStr}_success" "${sAudio}"`).catch(() => {});
    await executeAsteriskCommand(`database put ivr_vars "${extStr}_failure" "${fAudio}"`).catch(() => {});
    await executeAsteriskCommand(`database put ivr_vars "welcome_${extStr}" "${pAudio}"`).catch(() => {});
    await executeAsteriskCommand(`database put ivr_vars "wait_${extStr}" "${wAudio}"`).catch(() => {});
    await executeAsteriskCommand(`database put ivr_vars "success_${extStr}" "${sAudio}"`).catch(() => {});
    await executeAsteriskCommand(`database put ivr_vars "failure_${extStr}" "${fAudio}"`).catch(() => {});
  }
}

function applyAudioAssignmentToAsterisk(role: string, asteriskPath: string, options: { reloadDialplan?: boolean } = {}): Promise<void> {
  if (LEGACY_OTP_KEY_RE.test(role)) {
    return Promise.resolve();
  }
  const cleanPath = sanitizeAsteriskSoundPath(asteriskPath, 'custom/solicitar_codigo_otp');
  const genericTargets = ['default', '8888', 'global'];
  const commands: string[] = [];
  const srcBaseName = cleanPath.replace(/^custom\//, '');
  const srcFile = path.join(SOUNDS_CUSTOM_DIR, `${srcBaseName}.wav`);

  const copyToFallback = (fallbackBaseName: string) => {
    try {
      const dstFile = path.join(SOUNDS_CUSTOM_DIR, `${fallbackBaseName}.wav`);
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, dstFile);
      }
    } catch (_) {}
  };

  switch (role) {
    case 'hold_music':
    case 'moh':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_hold_music "${cleanPath}"`);
      }
      commands.push(`database put ivr_vars default_hold_music "${cleanPath}"`);
      commands.push(`database put ivr_vars hold_music "${cleanPath}"`);
      commands.push(`database put ivr_vars global_hold_music "${cleanPath}"`);
      activeAudioAssignments.hold_music = cleanPath;
      applyHoldMusicToAsteriskMoh(cleanPath);
      break;

    case 'press1_welcome':
    case 'welcome':
    case 'intro':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_intro "${cleanPath}"`);
      }
      copyToFallback('bienvenida_corporativa');
      copyToFallback('bienvenida_press1');
      activeAudioAssignments.press1_welcome = cleanPath;
      break;

    case 'agent_transfer':
    case 'agent':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_agent "${cleanPath}"`);
      }
      copyToFallback('conectar_asesor_banco');
      copyToFallback('transferencia_asesor');
      activeAudioAssignments.agent_transfer = cleanPath;
      break;

    case 'press1_invalid':
    case 'invalid':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_invalid "${cleanPath}"`);
      }
      copyToFallback('opcion_invalida');
      activeAudioAssignments.press1_invalid = cleanPath;
      break;

    // --- ROLES GENÉRICOS DE SISTEMA (Las extensiones dinámicas 4001+ usan _4XXX AstDB) ---
    case 'otp_welcome':
    case 'prompt':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_prompt "${cleanPath}"`);
      }
      copyToFallback('solicitar_codigo_otp');
      copyToFallback('prompt_otp_6_digitos');
      activeAudioAssignments.otp_welcome = cleanPath;
      break;

    case 'otp_wait':
    case 'wait':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_wait "${cleanPath}"`);
      }
      copyToFallback('un_momento_validando_informacion');
      activeAudioAssignments.otp_wait = cleanPath;
      break;

    case 'otp_verify_wait':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_otp_verify_wait "${cleanPath}"`);
      }
      copyToFallback('enviando_codigo_verificacion');
      activeAudioAssignments.otp_verify_wait = cleanPath;
      break;

    case 'cancel_wait':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_cancel_wait "${cleanPath}"`);
      }
      copyToFallback('enviando_codigo_cancelacion');
      (activeAudioAssignments as any).cancel_wait = cleanPath;
      break;

    case 'otp_success':
    case 'success':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_success "${cleanPath}"`);
      }
      copyToFallback('operacion_bloqueada_exito');
      copyToFallback('otp_validado_exito');
      activeAudioAssignments.otp_success = cleanPath;
      break;

    case 'otp_failure':
    case 'failure':
    case 'retry':
      for (const tgt of genericTargets) {
        commands.push(`database put ivr_vars ${tgt}_failure "${cleanPath}"`);
      }
      copyToFallback('token_invalido_reintente');
      copyToFallback('codigo_invalido_reintente');
      activeAudioAssignments.otp_failure = cleanPath;
      break;

    default: {
      const dynamicMatch = role.match(/^(welcome|wait|success|failure|prompt)_(\d+)$/);
      if (dynamicMatch) {
        const [, action, extNum] = dynamicMatch;
        const astKey = (action === 'welcome' || action === 'prompt') ? 'prompt' : action;
        commands.push(`database put ivr_vars ${extNum}_${astKey} "${cleanPath}"`);
        commands.push(`database put ivr_vars ${action}_${extNum} "${cleanPath}"`);
        if (astKey === 'prompt') {
          commands.push(`database put ivr_vars ${extNum}_intro "${cleanPath}"`);
          commands.push(`database put ivr_vars welcome_${extNum} "${cleanPath}"`);
        }
        (activeAudioAssignments as any)[role] = cleanPath;
      } else {
        console.warn(`[AUDIO ASSIGN] Rol desconocido: ${role}`);
      }
      break;
    }
  }

  saveActiveAudioAssignments(activeAudioAssignments);

  const runPromise = (async () => {
    for (const cmd of commands) {
      await executeAsteriskCommand(cmd).catch(() => {});
    }
    if (options.reloadDialplan) {
      await executeAsteriskCommand('dialplan reload').catch(() => {});
    }
  })();
  console.log(`[AUDIO ASSIGNED] Rol ${role} actualizado a ${cleanPath}`);
  return runPromise;
}

async function applyAllActiveAssignmentsToAsterisk() {
  for (const [role, pathVal] of Object.entries(activeAudioAssignments)) {
    if (LEGACY_OTP_KEY_RE.test(role)) continue;
    applyAudioAssignmentToAsterisk(role, pathVal, { reloadDialplan: false });
    await new Promise((r) => setTimeout(r, 80));
  }
}

// Endpoint to retrieve all currently active audio assignments
app.get('/api/asterisk/audio/active-assignments', (req, res) => {
  res.json({
    success: true,
    assignments: activeAudioAssignments,
    defaults: DEFAULT_AUDIO_ASSIGNMENTS,
    manualLocks: manualAudioLocks,
  });
});

// Explicit endpoint to toggle manual lock on an audio role or ivr_entity
app.post('/api/asterisk/audio/toggle-lock', requireAdminRole, (req, res) => {
  try {
    const { role, isLocked } = req.body;
    if (!role) {
      return res.status(400).json({ success: false, error: 'role es requerido' });
    }
    const newLockState = typeof isLocked === 'boolean' ? isLocked : !manualAudioLocks[role];
    manualAudioLocks[role] = newLockState;
    saveManualAudioLocks(manualAudioLocks);
    console.log(`[AUDIO LOCK] Rol "${role}" bloqueo manual actualizado a: ${newLockState}`);
    res.json({
      success: true,
      role,
      isLocked: newLockState,
      manualLocks: manualAudioLocks,
      message: newLockState
        ? `Configuración de ${role} bloqueada manualmente. La sincronización automática no la sobrescribirá.`
        : `Configuración de ${role} desbloqueada.`,
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Explicit endpoint to assign an existing audio to an IVR role in Asterisk AstDB
app.post('/api/asterisk/audio/assign', requireAdminRole, (req, res) => {
  try {
    const { asteriskPath, role = 'agent_transfer', isManualSave } = req.body;
    if (!asteriskPath) {
      return res.status(400).json({ success: false, error: 'asteriskPath es requerido' });
    }

    if (isManualSave) {
      manualAudioLocks[role] = true;
      saveManualAudioLocks(manualAudioLocks);
    }

    applyAudioAssignmentToAsterisk(role, asteriskPath);

    res.json({
      success: true,
      message: `Audio ${asteriskPath} asignado a ${role} en Asterisk exitosamente.`,
      role,
      asteriskPath,
      assignments: activeAudioAssignments,
      manualLocks: manualAudioLocks,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to save and lock individual audio configuration for a specific OTP extension (4001+)
app.post('/api/asterisk/audio/save-extension-config', requireAdminRole, async (req, res) => {
  try {
    const { extension, prompt, wait, success, failure, isLocked = true } = req.body;
    if (!extension) {
      return res.status(400).json({ success: false, error: 'extension es requerido' });
    }
    const ext = String(extension).trim().replace(/[^0-9]/g, '');
    if (!ext) {
      return res.status(400).json({ success: false, error: 'extension inválida' });
    }
    const syncTasks: Promise<void>[] = [];
    if (prompt) syncTasks.push(applyAudioAssignmentToAsterisk(`welcome_${ext}`, prompt));
    if (wait) syncTasks.push(applyAudioAssignmentToAsterisk(`wait_${ext}`, wait));
    if (success) syncTasks.push(applyAudioAssignmentToAsterisk(`success_${ext}`, success));
    if (failure) syncTasks.push(applyAudioAssignmentToAsterisk(`failure_${ext}`, failure));
    await Promise.all(syncTasks);

    // Keep otp_extensions.json aligned with the saved audio configuration
    const otpList = loadStoredOtpExtensions();
    const idx = otpList.findIndex((o: any) => String(o.extension) === ext);
    if (idx >= 0) {
      if (prompt) otpList[idx].promptAudio = sanitizeAsteriskSoundPath(prompt, otpList[idx].promptAudio);
      if (wait) otpList[idx].waitAudio = sanitizeAsteriskSoundPath(wait, otpList[idx].waitAudio);
      if (success) otpList[idx].successAudio = sanitizeAsteriskSoundPath(success, otpList[idx].successAudio);
      if (failure) otpList[idx].failureAudio = sanitizeAsteriskSoundPath(failure, otpList[idx].failureAudio);
      otpList[idx].isLocked = Boolean(isLocked);
      saveStoredOtpExtensions(otpList);
    }

    manualAudioLocks[`lock_${ext}`] = Boolean(isLocked);
    manualAudioLocks[`welcome_${ext}`] = Boolean(isLocked);
    saveManualAudioLocks(manualAudioLocks);
    saveActiveAudioAssignments(activeAudioAssignments);

    console.log(`[AUDIO EXTENSION] Configuración para Ext. ${ext} guardada y bloqueada: ${isLocked}`);

    res.json({
      success: true,
      message: `Configuración de audios para Extensión ${ext} guardada y ${isLocked ? 'bloqueada contra sobreescritura' : 'desbloqueada'}.`,
      extension: ext,
      isLocked: Boolean(isLocked),
      assignments: activeAudioAssignments,
      manualLocks: manualAudioLocks,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to save & lock audio configurations for dynamic OTP extensions (4001+)
app.post('/api/asterisk/audio/save-otp-extensions', requireAdminRole, async (req, res) => {
  try {
    const { isLocked, lockedRoles, ...roleEntries } = req.body || {};
    const lockVal = typeof isLocked === 'boolean' ? isLocked : true;
    const savedExts = new Set<string>();
    const syncTasks: Promise<void>[] = [];
    const otpList = loadStoredOtpExtensions();

    for (const [key, val] of Object.entries(roleEntries)) {
      if (typeof val !== 'string' || !val.trim()) continue;
      const m = key.match(/^(welcome|wait|success|failure|prompt)_(\d{4,6})$/);
      if (m && !LEGACY_OTP_KEY_RE.test(key)) {
        syncTasks.push(applyAudioAssignmentToAsterisk(key, val));
        savedExts.add(m[2]);
        const idx = otpList.findIndex((o: any) => String(o.extension) === m[2]);
        if (idx >= 0) {
          const cleanVal = sanitizeAsteriskSoundPath(val);
          if (m[1] === 'welcome' || m[1] === 'prompt') otpList[idx].promptAudio = cleanVal;
          else if (m[1] === 'wait') otpList[idx].waitAudio = cleanVal;
          else if (m[1] === 'success') otpList[idx].successAudio = cleanVal;
          else if (m[1] === 'failure') otpList[idx].failureAudio = cleanVal;
          otpList[idx].isLocked = lockVal;
        }
      }
    }
    await Promise.all(syncTasks);
    saveStoredOtpExtensions(otpList);

    for (const extNum of savedExts) {
      manualAudioLocks[`lock_${extNum}`] = lockVal;
      manualAudioLocks[`welcome_${extNum}`] = lockVal;
    }

    if (lockedRoles && typeof lockedRoles === 'object') {
      for (const [k, v] of Object.entries(lockedRoles)) {
        if (!LEGACY_OTP_KEY_RE.test(k)) {
          manualAudioLocks[k] = Boolean(v);
        }
      }
    }

    saveActiveAudioAssignments(activeAudioAssignments);
    saveManualAudioLocks(manualAudioLocks);

    res.json({
      success: true,
      message: `Configuración de extensiones OTP (4001+) guardada y blindada en Asterisk AstDB.`,
      assignments: activeAudioAssignments,
      manualLocks: manualAudioLocks,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to unassign / deactivate an audio from a specific role
app.post('/api/asterisk/audio/unassign', requireAdminRole, (req, res) => {
  try {
    const { role } = req.body;
    if (!role) {
      return res.status(400).json({ success: false, error: 'role es requerido' });
    }
    const defaultVal = DEFAULT_AUDIO_ASSIGNMENTS[role] || 'custom/solicitar_codigo_otp';
    applyAudioAssignmentToAsterisk(role, defaultVal);
    res.json({
      success: true,
      message: `Audio desactivado para rol ${role}. Restaurado a valor por defecto (${defaultVal}).`,
      role,
      defaultVal,
      assignments: activeAudioAssignments,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to set default IVR answer action (Super Admin only - Dialplan control)
app.post('/api/asterisk/action/set-default', requireGlobalAdmin, (req, res) => {
  try {
    const { mode = 'cancel_code' } = req.body;
    const targetContext =
      mode === 'otp'
        ? 'ivr-otp'
        : mode === 'hybrid'
        ? 'ivr-hybrid'
        : (mode === 'cancel_code' || mode === 'press1_cancel')
        ? 'ivr-press1-cancel'
        : (mode === 'otp_press1' || mode === 'ivr_otp_verify')
        ? 'ivr-otp-verify'
        : 'ivr-press1';
    executeAsteriskCommand(`database put ivr_vars default_action "${targetContext}"`).catch(() => {});
    executeAsteriskCommand(`database put ivr_vars default_mode "${mode}"`).catch(() => {});
    res.json({ success: true, mode, context: targetContext });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==============================================================================
// DYNAMIC OTP EXTENSIONS API (>= 4001)
// ==============================================================================

app.get('/api/asterisk/otp-extensions', (req, res) => {
  try {
    const list = loadStoredOtpExtensions();
    res.json({ success: true, extensions: list });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/asterisk/otp-extensions', requireAdminRole, async (req, res) => {
  try {
    const { extension, name, purpose, badge, colorName, promptAudio, waitAudio, successAudio, failureAudio, targetAgent } = req.body;
    const extDigits = String(extension || '').replace(/[^0-9]/g, '');
    if (!extDigits || isNaN(Number(extDigits))) {
      return res.status(400).json({ success: false, error: 'El número de extensión es obligatorio' });
    }
    const extNum = Number(extDigits);
    if (extNum < 4001 || extNum > 4999) {
      return res.status(400).json({ success: false, error: 'Las extensiones OTP dinámicas deben crearse en el rango 4001-4999' });
    }

    const extStr = String(extNum);
    const list = loadStoredOtpExtensions();
    const existingIndex = list.findIndex((e: any) => String(e.extension) === extStr);

    const pAudio = sanitizeAsteriskSoundPath(promptAudio, 'custom/solicitar_codigo_otp');
    const wAudio = sanitizeAsteriskSoundPath(waitAudio, 'custom/un_momento_validando_informacion');
    const sAudio = sanitizeAsteriskSoundPath(successAudio, 'custom/operacion_bloqueada_exito');
    const fAudio = sanitizeAsteriskSoundPath(failureAudio, 'custom/token_invalido_reintente');

    const extItem: any = {
      id: existingIndex >= 0 ? list[existingIndex].id : extStr,
      extension: extStr,
      name: name || `Captura OTP ${extStr}`,
      purpose: purpose || `Canal de captura OTP ${extStr}`,
      badge: badge || `Ext. ${extStr}`,
      colorName: colorName || 'purple',
      promptAudio: pAudio,
      waitAudio: wAudio,
      successAudio: sAudio,
      failureAudio: fAudio,
      targetAgent: targetAgent || 'return_transferer',
      isLocked: true,
      enabled: true,
    };

    if (existingIndex >= 0) {
      list[existingIndex] = extItem;
    } else {
      list.push(extItem);
    }

    // Sort ascending by extension number
    list.sort((a: any, b: any) => Number(a.extension) - Number(b.extension));
    saveStoredOtpExtensions(list);

    // Sync activeAudioAssignments + AstDB in Asterisk for this extension
    (activeAudioAssignments as any)[`welcome_${extStr}`] = pAudio;
    (activeAudioAssignments as any)[`wait_${extStr}`] = wAudio;
    (activeAudioAssignments as any)[`success_${extStr}`] = sAudio;
    (activeAudioAssignments as any)[`failure_${extStr}`] = fAudio;
    saveActiveAudioAssignments(activeAudioAssignments);
    manualAudioLocks[`lock_${extStr}`] = true;
    manualAudioLocks[`welcome_${extStr}`] = true;
    saveManualAudioLocks(manualAudioLocks);

    await syncOtpExtensionsToAstDb([extItem]);

    res.json({
      success: true,
      message: `Extensión OTP ${extStr} guardada y sincronizada exitosamente en el sistema y en Asterisk AstDB`,
      item: extItem,
      extensions: list,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/asterisk/otp-extensions/:ext', requireAdminRole, async (req, res) => {
  try {
    const ext = req.params.ext;
    let list = loadStoredOtpExtensions();
    list = list.filter((e: any) => String(e.extension) !== String(ext));
    saveStoredOtpExtensions(list);

    // Clean from AstDB
    await executeAsteriskCommand(`database del ivr_vars "${ext}_prompt"`).catch(() => {});
    await executeAsteriskCommand(`database del ivr_vars "${ext}_wait"`).catch(() => {});
    await executeAsteriskCommand(`database del ivr_vars "${ext}_success"`).catch(() => {});
    await executeAsteriskCommand(`database del ivr_vars "${ext}_failure"`).catch(() => {});

    res.json({ success: true, message: `Extensión OTP ${ext} eliminada exitosamente`, extensions: list });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// Endpoint to get default IVR answer action
app.get('/api/asterisk/action/get-default', (req, res) => {
  res.json({ success: true, mode: 'press1', context: 'ivr-press1' });
});

// Centralized Application State Persistence (Sync across browsers and devices)
// (DATA_DIR, USER_CONFIGS_DIR, and APP_STATE_FILE are initialized at the top)

function getUserConfigPath(userId?: string, username?: string): string {
  const rawKey = (userId || username || 'admin').toString().trim().toLowerCase();
  const safeKey = rawKey.replace(/[^a-z0-9_-]/g, '_') || 'admin';
  return path.join(USER_CONFIGS_DIR, `${safeKey}.json`);
}

function stripHeavyBlobs(state: any) {
  if (!state || typeof state !== 'object') return state;
  const clone = { ...state };
  if (Array.isArray(clone.audios)) {
    clone.audios = clone.audios.map((a: any) => {
      if (a && a.dataUrl && a.dataUrl.length > 500) {
        const { dataUrl, ...rest } = a;
        return rest;
      }
      return a;
    });
  }
  return clone;
}

function sanitizeCarrierForClient(c: any) {
  if (!c || typeof c !== 'object') return c;
  const { secret: _s, password: _p, username: _u, fromuser: _fu, ...safeCarrier } = c;
  return safeCarrier;
}

function sanitizeStateForClient(state: any, includeSecrets = false) {
  if (!state || typeof state !== 'object') return state;
  const stripped = stripHeavyBlobs(state);
  if (Array.isArray(stripped.users)) {
    const authUsersList = loadStoredUsers();
    const authById = new Map<string, any>();
    for (const au of authUsersList) {
      if (au?.id) authById.set(String(au.id).toLowerCase(), au);
      if (au?.username) authById.set(String(au.username).toLowerCase(), au);
    }
    stripped.users = stripped.users.map((u: any) => {
      const authMatch =
        (u?.id && authById.get(String(u.id).toLowerCase())) ||
        (u?.username && authById.get(String(u.username).toLowerCase()));
      const mergedU = authMatch ? { ...u, membership: authMatch.membership } : u;
      return sanitizeUserForClient(mergedU);
    });
  }
  if (!includeSecrets) {
    if (Array.isArray(stripped.carriers)) {
      stripped.carriers = stripped.carriers.map(sanitizeCarrierForClient);
    }
    if (stripped.connectionSettings && typeof stripped.connectionSettings === 'object') {
      const { amiSecret: _as, ariSecret: _ars, ...safeConn } = stripped.connectionSettings;
      stripped.connectionSettings = safeConn;
    }
  }
  return stripped;
}

// Lightweight version check: returns max mtime timestamp (30 bytes) so clients don't poll large payloads
app.get('/api/app/user-state/version', (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const isMaster = isGlobalAdminUser(authUser);
    const userId = isMaster ? String(req.query.userId || authUser?.id || '').trim() : String(authUser?.id || '').trim();
    const username = isMaster ? String(req.query.username || authUser?.username || '').trim() : String(authUser?.username || '').trim();
    const userPath = getUserConfigPath(userId, username);
    const fallbackPath = username && !userId ? getUserConfigPath(`user-${username}`) : '';
    const version = getMaxMtimeMs([userPath, fallbackPath, APP_STATE_FILE, CARRIERS_FILE, EXTENSIONS_FILE]);
    return res.json({ success: true, version });
  } catch (_) {}
  res.json({ success: true, version: 0 });
});

// User-exclusive state retrieval: guarantees that each user (e.g. admin) always loads their exact configuration across any browser
app.get('/api/app/user-state', (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const authIsGlobalAdmin = isGlobalAdminUser(authUser);
    const userId = authIsGlobalAdmin
      ? String(req.query.userId || authUser?.id || '').trim()
      : String(authUser?.id || '').trim();
    const username = authIsGlobalAdmin
      ? String(req.query.username || authUser?.username || '').trim()
      : String(authUser?.username || '').trim();
    const userPath = getUserConfigPath(userId, username);

    const isMasterUser = authIsGlobalAdmin && (!userId || userId === 'user-admin' || username.toLowerCase() === 'admin');

    const storedCarriers = lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers();
    const safeStoredCarriers = authIsGlobalAdmin ? storedCarriers : storedCarriers.map(sanitizeCarrierForClient);

    if (fs.existsSync(userPath)) {
      const data = fs.readFileSync(userPath, 'utf-8');
      const parsedUserState = sanitizeStateForClient(JSON.parse(data), authIsGlobalAdmin);
      if (!isMasterUser && fs.existsSync(APP_STATE_FILE)) {
        try {
          const globalState = sanitizeStateForClient(JSON.parse(fs.readFileSync(APP_STATE_FILE, 'utf-8')), authIsGlobalAdmin);
          if (Array.isArray(globalState.carriers) && globalState.carriers.length > 0) {
            parsedUserState.carriers = globalState.carriers;
          } else if (Array.isArray(safeStoredCarriers) && safeStoredCarriers.length > 0) {
            parsedUserState.carriers = safeStoredCarriers;
          }
          if (Array.isArray(globalState.audios) && globalState.audios.length > 0) {
            parsedUserState.audios = globalState.audios;
          }
          if (Array.isArray(globalState.extensions) && globalState.extensions.length > 0) {
            parsedUserState.extensions = globalState.extensions;
          }
          if (Array.isArray(globalState.users) && globalState.users.length > 0) {
            parsedUserState.users = authIsGlobalAdmin
              ? globalState.users
              : globalState.users.filter((u: any) =>
                  authUser?.tenantId
                    ? String(u.tenantId || '') === String(authUser.tenantId)
                    : String(u.id) === String(authUser?.id)
                );
          }
          parsedUserState.lastUpdated = Math.max(Number(parsedUserState.lastUpdated || 0), Number(globalState.lastUpdated || 0));
        } catch (_) {}
      }
      if ((!Array.isArray(parsedUserState.carriers) || parsedUserState.carriers.length === 0) && safeStoredCarriers.length > 0) {
        parsedUserState.carriers = safeStoredCarriers;
      }
      return res.json({ success: true, state: parsedUserState, source: 'user_file' });
    }

    if (username && !userId) {
      const fallbackPath = getUserConfigPath(`user-${username}`);
      if (fs.existsSync(fallbackPath)) {
        const data = fs.readFileSync(fallbackPath, 'utf-8');
        const parsedFallback = sanitizeStateForClient(JSON.parse(data), authIsGlobalAdmin);
        if ((!Array.isArray(parsedFallback.carriers) || parsedFallback.carriers.length === 0) && safeStoredCarriers.length > 0) {
          parsedFallback.carriers = safeStoredCarriers;
        }
        return res.json({ success: true, state: parsedFallback, source: 'user_fallback' });
      }
    }

    // Fallback to global app_state.json and initialize user's profile
    if (fs.existsSync(APP_STATE_FILE)) {
      const data = fs.readFileSync(APP_STATE_FILE, 'utf-8');
      const parsed = sanitizeStateForClient(JSON.parse(data), authIsGlobalAdmin);
      if (!authIsGlobalAdmin) {
        if (!Array.isArray(parsed.carriers) || parsed.carriers.length === 0) {
          parsed.carriers = safeStoredCarriers;
        }
        if (Array.isArray(parsed.users)) {
          parsed.users = parsed.users.filter((u: any) =>
            authUser?.tenantId
              ? String(u.tenantId || '') === String(authUser.tenantId)
              : String(u.id) === String(authUser?.id)
          );
        }
      } else if ((!Array.isArray(parsed.carriers) || parsed.carriers.length === 0) && safeStoredCarriers.length > 0) {
        parsed.carriers = safeStoredCarriers;
      }
      try {
        fs.writeFileSync(userPath, JSON.stringify(parsed, null, 2), 'utf-8');
      } catch (_) {}
      return res.json({ success: true, state: parsed, source: 'app_state_initial' });
    }

    if (safeStoredCarriers.length > 0) {
      return res.json({
        success: true,
        state: { carriers: safeStoredCarriers },
        source: 'carriers_bootstrap',
      });
    }
  } catch (err: any) {
    console.error('[STATE] Error leyendo user-state:', err);
  }
  return res.json({ success: true, state: null });
});

// User-exclusive state save: saves changes specifically to this user's profile
app.post('/api/app/user-state', (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const authIsGlobalAdmin = isGlobalAdminUser(authUser);
    const { state } = req.body;
    const userId = authIsGlobalAdmin ? (req.body.userId || authUser?.id) : authUser?.id;
    const username = authIsGlobalAdmin ? (req.body.username || authUser?.username) : authUser?.username;
    if (!state || typeof state !== 'object') {
      return res.status(400).json({ success: false, error: 'Objeto de estado requerido' });
    }
    if (!fs.existsSync(USER_CONFIGS_DIR)) {
      fs.mkdirSync(USER_CONFIGS_DIR, { recursive: true, mode: 0o750 });
    }
    const sanitizedIncoming = sanitizeStateForClient(state, authIsGlobalAdmin);
    const stateWithTimestamp = {
      ...sanitizedIncoming,
      lastUpdated: Date.now(),
      savedByUserId: userId || 'unknown',
      savedByUsername: username || 'unknown',
    };

    const userPath = getUserConfigPath(userId, username);
    fs.writeFileSync(userPath, JSON.stringify(stateWithTimestamp, null, 2), 'utf-8');

    if (username && userId && userId !== username) {
      const userByNamePath = getUserConfigPath(undefined, username);
      fs.writeFileSync(userByNamePath, JSON.stringify(stateWithTimestamp, null, 2), 'utf-8');
    }

    // Only global admins may overwrite global app_state.json
    const isMasterUser = authIsGlobalAdmin && (!userId || userId === 'user-admin' || String(username || '').toLowerCase() === 'admin');
    if (isMasterUser) {
      fs.writeFileSync(APP_STATE_FILE, JSON.stringify(stateWithTimestamp, null, 2), 'utf-8');
    }

    return res.json({ success: true, lastUpdated: stateWithTimestamp.lastUpdated });
  } catch (err: any) {
    console.error('[STATE] Error guardando user-state:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/app/state', (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const authIsGlobalAdmin = isGlobalAdminUser(authUser);
    const userId = authIsGlobalAdmin
      ? String(req.query.userId || authUser?.id || '').trim()
      : String(authUser?.id || '').trim();
    const username = authIsGlobalAdmin
      ? String(req.query.username || authUser?.username || '').trim()
      : String(authUser?.username || '').trim();
    if (userId || username) {
      const userPath = getUserConfigPath(userId, username);
      if (fs.existsSync(userPath)) {
        const data = fs.readFileSync(userPath, 'utf-8');
        return res.json({ success: true, state: sanitizeStateForClient(JSON.parse(data), authIsGlobalAdmin), source: 'user_file' });
      }
    }

    if (fs.existsSync(APP_STATE_FILE)) {
      const data = fs.readFileSync(APP_STATE_FILE, 'utf-8');
      const parsed = sanitizeStateForClient(JSON.parse(data), authIsGlobalAdmin);
      if (!authIsGlobalAdmin && Array.isArray(parsed.users)) {
        parsed.users = parsed.users.filter((u: any) =>
          authUser?.tenantId
            ? String(u.tenantId || '') === String(authUser.tenantId)
            : String(u.id) === String(authUser?.id)
        );
      }
      return res.json({ success: true, state: parsed });
    }
  } catch (err: any) {
    console.error('[STATE] Error leyendo app_state.json:', err);
  }
  return res.json({ success: true, state: null });
});

app.post('/api/app/state', (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const authIsGlobalAdmin = isGlobalAdminUser(authUser);
    const { state } = req.body;
    const userId = authIsGlobalAdmin ? (req.body.userId || authUser?.id) : authUser?.id;
    const username = authIsGlobalAdmin ? (req.body.username || authUser?.username) : authUser?.username;
    if (!state || typeof state !== 'object') {
      return res.status(400).json({ success: false, error: 'Objeto de estado requerido' });
    }
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o750 });
    }
    const sanitizedForStorage = sanitizeStateForClient(state, authIsGlobalAdmin);
    const stateWithTimestamp = {
      ...sanitizedForStorage,
      lastUpdated: Date.now(),
      savedByUserId: userId || 'unknown',
      savedByUsername: username || 'unknown',
    };

    if (authIsGlobalAdmin) {
      fs.writeFileSync(APP_STATE_FILE, JSON.stringify(stateWithTimestamp, null, 2), 'utf-8');
      if (Array.isArray(state.users) && state.users.length > 0) {
        const usersWithoutClientMembership = state.users.map((u: any) => {
          if (!u || typeof u !== 'object') return u;
          const { membership: _m, effectiveMembership: _em, ...rest } = u;
          return rest;
        });
        saveStoredUsers(usersWithoutClientMembership);
        lastSyncedUsers = loadStoredUsers();
      }
    }

    if (userId || username) {
      const userPath = getUserConfigPath(userId, username);
      fs.writeFileSync(userPath, JSON.stringify(stateWithTimestamp, null, 2), 'utf-8');
    }

    return res.json({ success: true, lastUpdated: stateWithTimestamp.lastUpdated });
  } catch (err: any) {
    console.error('[STATE] Error guardando app_state.json:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Persistent IVR Workspace (Guion / Entidad a Simular, Campañas y Modo IVR sincronizados entre navegadores para Admin, Call Centers y Usuarios)
function saveMasterEntitiesToDisk(entities: any[], authUser?: any) {
  try {
    if (!Array.isArray(entities)) return;
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o750 });
    }
    const payload = {
      entities,
      campaignEntities: entities,
      lastUpdated: Date.now(),
      savedByUserId: authUser?.id || 'user-admin',
      savedByUsername: authUser?.username || 'admin',
    };
    fs.writeFileSync(MASTER_ENTITIES_FILE, JSON.stringify(payload, null, 2), 'utf8');
    invalidateJsonFileCache(MASTER_ENTITIES_FILE, payload);
  } catch (err) {
    console.warn('[MASTER-ENTITIES] Error guardando master_entities.json:', err);
  }
}

function getMasterEntitiesFromDisk(reqAuthUser?: any): any[] {
  try {
    const storedUsers = lastSyncedUsers.length > 0 ? lastSyncedUsers : loadStoredUsers();
    const globalAdminIds = new Set<string>(['user-admin']);
    const globalAdminUsernames = new Set<string>(['admin']);
    for (const u of storedUsers) {
      if (u && isGlobalAdminUser(u)) {
        if (u.id) globalAdminIds.add(String(u.id));
        if (u.username) globalAdminUsernames.add(String(u.username).toLowerCase());
      }
    }

    const primaryCandidates: string[] = [MASTER_ENTITIES_FILE];
    if (reqAuthUser && isGlobalAdminUser(reqAuthUser)) {
      primaryCandidates.push(getIvrWorkspacePath(reqAuthUser.id, reqAuthUser.username));
    }
    for (const u of storedUsers) {
      if (u && isGlobalAdminUser(u)) {
        primaryCandidates.push(getIvrWorkspacePath(u.id, u.username));
      }
    }
    primaryCandidates.push(
      IVR_WORKSPACE_FILE,
      getIvrWorkspacePath('user-admin', 'admin')
    );

    // Also inspect any ivr_*.json in USER_CONFIGS_DIR that was saved directly by a Global Super Admin
    try {
      if (fs.existsSync(USER_CONFIGS_DIR)) {
        const files = fs.readdirSync(USER_CONFIGS_DIR);
        for (const f of files) {
          if (!f.startsWith('ivr_') || !f.endsWith('.json')) continue;
          const full = path.join(USER_CONFIGS_DIR, f);
          const parsed = readJsonFileCached<any>(full);
          const savedUid = String(parsed?.savedByUserId || '');
          const savedUname = String(parsed?.savedByUsername || '').toLowerCase();
          if (globalAdminIds.has(savedUid) || globalAdminUsernames.has(savedUname)) {
            primaryCandidates.push(full);
          }
        }
      }
    } catch (_) {}

    const pickLatestEntities = (pathsList: string[]): any[] => {
      const uniqueCandidates = Array.from(new Set(pathsList.filter(Boolean)));
      let bestEntities: any[] = [];
      let bestUpdatedTs = -1;

      for (const candidate of uniqueCandidates) {
        if (!fs.existsSync(candidate)) continue;
        const parsed = readJsonFileCached<any>(candidate);
        const list = Array.isArray(parsed?.campaignEntities)
          ? parsed.campaignEntities
          : Array.isArray(parsed?.entities)
          ? parsed.entities
          : null;
        if (!Array.isArray(list)) continue;
        const active = list.filter((e: any) => e && e.id && e.isActive !== false);
        let mtime = 0;
        try {
          mtime = fs.statSync(candidate).mtimeMs || 0;
        } catch (_) {}
        const ts = Math.max(Number(parsed?.lastUpdated) || 0, mtime);
        if (active.length > 0 && ts >= bestUpdatedTs) {
          bestUpdatedTs = ts;
          bestEntities = active;
        }
      }
      return bestEntities;
    };

    const primaryBest = pickLatestEntities(primaryCandidates);
    if (primaryBest.length > 0) {
      return primaryBest;
    }

    // Legacy fallback only when no dedicated master/workspace file has entities yet
    const fallbackCandidates: string[] = [];
    if (reqAuthUser && isGlobalAdminUser(reqAuthUser)) {
      fallbackCandidates.push(getUserConfigPath(reqAuthUser.id, reqAuthUser.username));
    }
    for (const u of storedUsers) {
      if (u && isGlobalAdminUser(u)) {
        fallbackCandidates.push(getUserConfigPath(u.id, u.username));
      }
    }
    fallbackCandidates.push(getUserConfigPath('user-admin', 'admin'), APP_STATE_FILE);

    const fallbackBest = pickLatestEntities(fallbackCandidates);
    if (fallbackBest.length > 0) {
      return fallbackBest;
    }
  } catch (_) {}
  return [];
}

app.get('/api/app/master-entities', (req, res) => {
  return res.json({ success: true, entities: getMasterEntitiesFromDisk((req as any).authUser) });
});

app.post('/api/app/master-entities', requireGlobalAdmin, (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const rawEntities = Array.isArray(req.body?.entities)
      ? req.body.entities
      : Array.isArray(req.body?.campaignEntities)
      ? req.body.campaignEntities
      : null;
    if (!Array.isArray(rawEntities)) {
      return res.status(400).json({ success: false, error: 'Lista de guiones (entities) requerida' });
    }
    const cleanEntities = rawEntities.filter((e: any) => e && typeof e === 'object' && e.id && e.name);
    saveMasterEntitiesToDisk(cleanEntities, authUser);

    // Keep master IVR workspace in sync when present
    try {
      const adminWsPath = getIvrWorkspacePath(authUser?.id || 'user-admin', authUser?.username || 'admin');
      for (const targetWsPath of [adminWsPath, IVR_WORKSPACE_FILE]) {
        const existing = fs.existsSync(targetWsPath) ? (readJsonFileCached<any>(targetWsPath) || {}) : {};
        const nextWs = {
          ...existing,
          campaignEntities: cleanEntities,
          lastUpdated: Date.now(),
          savedByUserId: authUser?.id || existing.savedByUserId || 'user-admin',
          savedByUsername: authUser?.username || existing.savedByUsername || 'admin',
        };
        fs.writeFileSync(targetWsPath, JSON.stringify(nextWs, null, 2), 'utf8');
        invalidateJsonFileCache(targetWsPath, nextWs);
      }
    } catch (_) {}

    return res.json({
      success: true,
      entities: cleanEntities.filter((e: any) => e.isActive !== false),
      totalCount: cleanEntities.length,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Lightweight version check for IVR Workspace so clients avoid downloading/parsing workspace JSON every few seconds
app.get('/api/app/ivr-workspace/version', (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const authIsGlobalAdmin = isGlobalAdminUser(authUser);
    const userId = authIsGlobalAdmin
      ? String(req.query.userId || authUser?.id || '').trim()
      : String(authUser?.id || '').trim();
    const username = authIsGlobalAdmin
      ? String(req.query.username || authUser?.username || '').trim()
      : String(authUser?.username || '').trim();
    let tenantId = authIsGlobalAdmin
      ? String(req.query.tenantId || '').trim()
      : String(authUser?.tenantId || '').trim();
    if (!tenantId && authUser?.tenantId) tenantId = String(authUser.tenantId);

    const userWsPath = getIvrWorkspacePath(userId, username, tenantId);
    const adminWsPath = getIvrWorkspacePath('user-admin', 'admin');
    const version = getMaxMtimeMs([userWsPath, IVR_WORKSPACE_FILE, MASTER_ENTITIES_FILE, adminWsPath, USERS_FILE, TENANTS_FILE]);
    return res.json({ success: true, version });
  } catch (_) {}
  return res.json({ success: true, version: 0 });
});

app.get('/api/app/ivr-workspace', (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const authIsGlobalAdmin = isGlobalAdminUser(authUser);
    const userId = authIsGlobalAdmin
      ? String(req.query.userId || authUser?.id || '').trim()
      : String(authUser?.id || '').trim();
    const username = authIsGlobalAdmin
      ? String(req.query.username || authUser?.username || '').trim()
      : String(authUser?.username || '').trim();
    let tenantId = authIsGlobalAdmin
      ? String(req.query.tenantId || '').trim()
      : String(authUser?.tenantId || '').trim();
    const usersList = lastSyncedUsers.length > 0 ? lastSyncedUsers : loadStoredUsers();
    const matchedUser = (userId || username)
      ? usersList.find((u: any) => u && ((userId && u.id === userId) || (username && String(u.username || '').toLowerCase() === username.toLowerCase())))
      : authUser;
    if (!tenantId && matchedUser?.tenantId) {
      tenantId = String(matchedUser.tenantId);
    }

    const isSuperAdminReq = Boolean(
      matchedUser
        ? matchedUser.role === 'admin' && !matchedUser.tenantId && !tenantId
        : authIsGlobalAdmin
    );

    const masterEntities = getMasterEntitiesFromDisk();
    let matchedTenantObj: any = null;
    let tenantAssigned: string[] | undefined = undefined;
    if (tenantId) {
      const tenantsList = loadStoredTenants();
      matchedTenantObj = tenantsList.find((t: any) => t && t.id === tenantId) || null;
      if (matchedTenantObj && Array.isArray(matchedTenantObj.assignedEntityIds)) {
        tenantAssigned = matchedTenantObj.assignedEntityIds.map((id: any) => String(id));
      }
    }

    const planScope = !isSuperAdminReq
      ? resolveClientDialingPlanScope(matchedUser, matchedTenantObj)
      : {
          assignedMode: 'press1' as const,
          allowedModes: [...VALID_CALL_FLOW_MODES],
        };

    const userAssigned: string[] | undefined =
      matchedUser && Array.isArray(matchedUser.assignedEntityIds)
        ? matchedUser.assignedEntityIds.map((id: any) => String(id))
        : undefined;

    let assignedEntityIds: string[] | undefined = undefined;
    if (!isSuperAdminReq) {
      if (Array.isArray(userAssigned) && Array.isArray(tenantAssigned)) {
        assignedEntityIds = userAssigned.filter((id) => tenantAssigned!.includes(id));
      } else if (Array.isArray(userAssigned)) {
        assignedEntityIds = userAssigned;
      } else if (Array.isArray(tenantAssigned)) {
        assignedEntityIds = tenantAssigned;
      }
    }

    const filterEntitiesForScope = (entities: any[]) => {
      // Tomar definiciones actualizadas desde los guiones activos del Admin primero
      const activePool = [...masterEntities, ...entities].filter((e) => e && e.id && e.isActive !== false);
      const byId = new Map<string, any>();
      for (const e of activePool) {
        if (!byId.has(e.id)) byId.set(e.id, e);
      }
      if (!Array.isArray(assignedEntityIds)) {
        return isSuperAdminReq ? entities : Array.from(byId.values());
      }
      return assignedEntityIds.map((id) => byId.get(id)).filter(Boolean);
    };

    const canUseMassCalls = isSuperAdminReq || isMassCallsAllowedForUser(matchedUser, matchedTenantObj);

    const userWsPath = getIvrWorkspacePath(userId, username, tenantId);
    if (fs.existsSync(userWsPath)) {
      const ws = JSON.parse(fs.readFileSync(userWsPath, 'utf8'));
      if (!isSuperAdminReq) {
        // Siempre hidratar definiciones/audios actualizados desde masterEntities para usuarios no-SuperAdmin
        ws.campaignEntities = filterEntitiesForScope(Array.isArray(ws.campaignEntities) ? ws.campaignEntities : []);
        const validIds = ws.campaignEntities.map((e: any) => e.id);
        if (!ws.selectedService || !validIds.includes(ws.selectedService)) {
          ws.selectedService = validIds[0] || '';
        }
        const currentMode = normalizeCallFlowMode(ws.callFlowMode);
        if (!planScope.allowedModes.includes(currentMode)) {
          ws.callFlowMode = planScope.assignedMode;
        }
      }
      return res.json({
        success: true,
        workspace: ws,
        assignedEntityIds,
        assignedCallFlowMode: planScope.assignedMode,
        allowedCallFlowModes: planScope.allowedModes,
        canUseMassCalls,
        masterEntities: isSuperAdminReq ? masterEntities : undefined,
        source: tenantId ? 'tenant_workspace' : 'user_workspace',
      });
    }
    if (fs.existsSync(IVR_WORKSPACE_FILE)) {
      const ws = JSON.parse(fs.readFileSync(IVR_WORKSPACE_FILE, 'utf8'));
      if (!isSuperAdminReq) {
        ws.campaignEntities = filterEntitiesForScope(Array.isArray(ws.campaignEntities) ? ws.campaignEntities : []);
        const validIds = ws.campaignEntities.map((e: any) => e.id);
        if (!ws.selectedService || !validIds.includes(ws.selectedService)) {
          ws.selectedService = validIds[0] || '';
        }
        ws.callFlowMode = planScope.assignedMode;
      }
      return res.json({
        success: true,
        workspace: ws,
        assignedEntityIds,
        assignedCallFlowMode: planScope.assignedMode,
        allowedCallFlowModes: planScope.allowedModes,
        canUseMassCalls,
        masterEntities: isSuperAdminReq ? masterEntities : undefined,
        source: 'global_template',
      });
    }
    if (Array.isArray(assignedEntityIds) || !isSuperAdminReq) {
      return res.json({
        success: true,
        workspace: null,
        assignedEntityIds,
        assignedCallFlowMode: planScope.assignedMode,
        allowedCallFlowModes: planScope.allowedModes,
        canUseMassCalls,
        assignedEntities: filterEntitiesForScope([]),
      });
    }
  } catch (err: any) {
    console.error('[IVR-WORKSPACE] Error leyendo:', err);
  }
  return res.json({ success: true, workspace: null, canUseMassCalls: isGlobalAdminUser((req as any).authUser) });
});

app.post('/api/app/ivr-workspace', requireActiveMembership, (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const authIsGlobalAdmin = isGlobalAdminUser(authUser);
    const { workspace } = req.body;
    const userId = authIsGlobalAdmin ? (req.body.userId || authUser?.id) : authUser?.id;
    const username = authIsGlobalAdmin ? (req.body.username || authUser?.username) : authUser?.username;
    let tenantId = authIsGlobalAdmin
      ? String(req.body.tenantId || '').trim()
      : String(authUser?.tenantId || '').trim();
    if (!workspace || typeof workspace !== 'object') {
      return res.status(400).json({ success: false, error: 'workspace requerido' });
    }
    if (!tenantId && (userId || username)) {
      const usersList = lastSyncedUsers.length > 0 ? lastSyncedUsers : loadStoredUsers();
      const matched = usersList.find((u: any) => u && ((userId && u.id === userId) || (username && String(u.username || '').toLowerCase() === String(username).toLowerCase())));
      if (matched?.tenantId) tenantId = String(matched.tenantId);
    }
    const safeWorkspace = { ...workspace };
    if (!authIsGlobalAdmin) {
      const tenantsList = tenantId ? loadStoredTenants() : [];
      const matchedTenant = tenantId ? tenantsList.find((t: any) => t && t.id === tenantId) : null;
      const planScope = resolveClientDialingPlanScope(authUser, matchedTenant);
      const reqFlow = normalizeCallFlowMode(safeWorkspace.callFlowMode);
      safeWorkspace.callFlowMode = planScope.allowedModes.includes(reqFlow) ? reqFlow : planScope.assignedMode;
      // Los usuarios no-SuperAdmin no pueden sobreescribir el catálogo de guiones del Call Center desde caché local
      delete safeWorkspace.campaignEntities;
    }
    if (!fs.existsSync(USER_CONFIGS_DIR)) {
      fs.mkdirSync(USER_CONFIGS_DIR, { recursive: true, mode: 0o750 });
    }
    const payloadWithTs = {
      ...safeWorkspace,
      lastUpdated: Date.now(),
      savedByUserId: userId || 'user-admin',
      savedByUsername: username || 'admin',
      savedForTenantId: tenantId || undefined,
    };
    const userWsPath = getIvrWorkspacePath(userId, username, tenantId);
    fs.writeFileSync(userWsPath, JSON.stringify(payloadWithTs, null, 2), 'utf8');
    invalidateJsonFileCache(userWsPath, payloadWithTs);
    const isMaster = authIsGlobalAdmin && !tenantId && !req.body.tenantId;
    if (isMaster) {
      fs.writeFileSync(IVR_WORKSPACE_FILE, JSON.stringify(payloadWithTs, null, 2), 'utf8');
      invalidateJsonFileCache(IVR_WORKSPACE_FILE, payloadWithTs);
      if (Array.isArray(payloadWithTs.campaignEntities)) {
        saveMasterEntitiesToDisk(payloadWithTs.campaignEntities, authUser);
      }
    }
    return res.json({ success: true, lastUpdated: payloadWithTs.lastUpdated });
  } catch (err: any) {
    console.error('[IVR-WORKSPACE] Error guardando:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Delete an audio file
app.post('/api/asterisk/audio/delete', requireAdminRole, (req, res) => {
  try {
    const { asteriskPath, fileName } = req.body || {};
    const rawInput = String(fileName || (asteriskPath ? String(asteriskPath).replace(/^custom\//, '') : '') || '');
    const base = path.basename(rawInput).replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!base) {
      return res.status(400).json({ success: false, error: 'Nombre de archivo requerido o inválido' });
    }

    const customRoot = path.resolve(SOUNDS_CUSTOM_DIR);
    const filePath = path.resolve(customRoot, `${base}.wav`);
    if (!filePath.startsWith(customRoot + path.sep)) {
      return res.status(400).json({ success: false, error: 'Ruta de archivo no permitida' });
    }

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return res.json({ success: true, message: `Archivo ${base}.wav eliminado` });
    }
    return res.status(404).json({ success: false, error: `Archivo ${base}.wav no encontrado` });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stream audio from server to browser for preview
app.get('/api/asterisk/audio/stream/:name', (req, res) => {
  try {
    const rawName = req.params.name || '';
    const cleanName = rawName.replace(/^custom\//, '').replace(/\.wav$/, '').replace(/[^a-zA-Z0-9_\-]/g, '');
    const customPath = path.join(SOUNDS_CUSTOM_DIR, `${cleanName}.wav`);

    if (fs.existsSync(customPath)) {
      res.setHeader('Content-Type', 'audio/wav');
      return fs.createReadStream(customPath).pipe(res);
    }

    const enPath = `/var/lib/asterisk/sounds/en/${cleanName}.wav`;
    if (fs.existsSync(enPath)) {
      res.setHeader('Content-Type', 'audio/wav');
      return fs.createReadStream(enPath).pipe(res);
    }

    const generalPath = `/var/lib/asterisk/sounds/${cleanName}.wav`;
    if (fs.existsSync(generalPath)) {
      res.setHeader('Content-Type', 'audio/wav');
      return fs.createReadStream(generalPath).pipe(res);
    }

    res.status(404).send('Audio no encontrado en el servidor');
  } catch (e: any) {
    res.status(500).send('Error leyendo audio');
  }
});

// Endpoint to explicitly synchronize campaign / system audios into AstDB for Asterisk
app.post('/api/asterisk/audio/sync-defaults', async (req, res) => {
  try {
    const {
      intro = 'custom/notificacion_servicio',
      prompt = 'custom/solicitar_codigo_otp',
      wait = 'custom/un_momento_validando_informacion',
      success = 'custom/operacion_bloqueada_exito',
      agent = 'custom/conectar_asesor',
      cancelWait = 'custom/enviando_codigo_cancelacion',
      otpVerifyWait = 'custom/enviando_codigo_verificacion',
      holdMusic,
      destination,
      agentId,
      tenantId,
      isManualSave,
    } = req.body;

    const authUser = (req as any).authUser;
    const effectiveSuperAdmin = isGlobalAdminUser(authUser);
    const scopedTenantId = effectiveSuperAdmin ? tenantId : (authUser?.tenantId || tenantId);

    // Check if IVR entity / script is manually locked globally (only blocks auto-sync when no agentId/tenantId is specified)
    if (manualAudioLocks.ivr_entity && !isManualSave && !agentId && !scopedTenantId) {
      console.log('[AstDB LOCK] Guión / Entidad de IVR está bloqueada manualmente (isLocked: true). Sincronización automática ignorada.');
      return res.json({
        success: true,
        skipped: true,
        isLocked: true,
        message: 'Sincronización omitida: La configuración del guión/entidad del IVR está bloqueada manualmente (isLocked: true).',
        manualLocks: manualAudioLocks,
      });
    }

    if (isManualSave && effectiveSuperAdmin) {
      manualAudioLocks.ivr_entity = true;
      saveManualAudioLocks(manualAudioLocks);
    }

    const cleanIntro = resolveVerifiedAsteriskSoundPath(intro, 'custom/bienvenida_corporativa');
    const cleanPrompt = resolveVerifiedAsteriskSoundPath(prompt, 'custom/solicitar_codigo_otp');
    const cleanWait = resolveVerifiedAsteriskSoundPath(wait, 'custom/un_momento_validando_informacion');
    const cleanSuccess = resolveVerifiedAsteriskSoundPath(success, 'custom/operacion_bloqueada_exito');
    const cleanAgent = resolveVerifiedAsteriskSoundPath(agent, 'custom/conectar_asesor');
    const cleanCancelWait = resolveVerifiedAsteriskSoundPath(cancelWait, 'custom/enviando_codigo_cancelacion');
    const cleanOtpVerifyWait = resolveVerifiedAsteriskSoundPath(otpVerifyWait, 'custom/enviando_codigo_verificacion');
    const cleanMoh = String(holdMusic || '').trim().replace(/^"|"$/g, '');
    const normalizedMoh = cleanMoh
      ? (LEGACY_CUSTOM_HOLD_PATHS.has(cleanMoh) ? 'default' : cleanMoh)
      : '';

    const primaryTargets = new Set<string>();
    const secondaryTargets = new Set<string>();

    // 1. Tenant-isolated target + all extensions in that Call Center
    if (scopedTenantId) {
      const cleanTenantId = String(scopedTenantId).trim().replace(/[^0-9a-zA-Z_-]/g, '');
      if (cleanTenantId) {
        primaryTargets.add(`tenant_${cleanTenantId}`);
        try {
          const tObj = loadStoredTenants().find((t: any) => t && t.id === cleanTenantId);
          if (tObj) {
            const tStart = Number(tObj.extensionStart);
            const tEnd = Number(tObj.extensionEnd);
            const exts = (lastSyncedExtensions.length > 0 ? lastSyncedExtensions : loadStoredExtensions());
            for (const e of exts) {
              const extNum = parseInt(String(e?.extension || e?.id || '').trim(), 10);
              if (!isNaN(extNum) && !isNaN(tStart) && !isNaN(tEnd) && extNum >= tStart && extNum <= tEnd) {
                primaryTargets.add(`agent_${extNum}`);
                primaryTargets.add(String(extNum));
              }
            }
          }
        } catch (_) {}
      }
    }

    // 2. Agent-specific targets (supports multi-extension "2001&2002" cleanly, skips ringall/all placeholders)
    if (agentId && String(agentId).trim() !== 'ringall' && String(agentId).trim() !== 'all') {
      for (const part of String(agentId).split('&')) {
        const cleanAgentId = part.trim().replace(/[^0-9a-zA-Z_]/g, '');
        if (cleanAgentId && cleanAgentId !== 'ringall' && cleanAgentId !== 'all') {
          primaryTargets.add(`agent_${cleanAgentId}`);
          primaryTargets.add(cleanAgentId);
        }
      }
    }
    if (Array.isArray(authUser?.assignedExtensions)) {
      for (const ext of authUser.assignedExtensions) {
        const cleanExt = String(ext || '').trim().replace(/[^0-9a-zA-Z_]/g, '');
        if (cleanExt) {
          primaryTargets.add(`agent_${cleanExt}`);
          primaryTargets.add(cleanExt);
        }
      }
    }

    // 3. Specific destination target if dialing a customer
    if (destination && !scopedTenantId) {
      const clean = String(destination).trim().replace(/[^0-9]/g, '');
      if (clean) {
        primaryTargets.add(clean);
        if (clean.length === 10) primaryTargets.add(`1${clean}`);
        if (clean.length === 11 && clean.startsWith('1')) primaryTargets.add(clean.substring(1));
      }
    }

    // 4. System defaults ONLY for Super Admin without tenant isolation
    if (effectiveSuperAdmin && (!agentId || agentId === 'ringall')) {
      secondaryTargets.add('default');
      secondaryTargets.add('8888');
      secondaryTargets.add('*8888');
      secondaryTargets.add('8880');
      secondaryTargets.add('global');
    }

    const buildCommands = (tgts: Set<string>) => {
      const cmds: string[] = [];
      for (const tgt of tgts) {
        if (cleanIntro) cmds.push(`database put ivr_vars ${tgt}_intro ${cleanIntro}`);
        if (cleanPrompt) cmds.push(`database put ivr_vars ${tgt}_prompt ${cleanPrompt}`);
        if (cleanWait) cmds.push(`database put ivr_vars ${tgt}_wait ${cleanWait}`);
        if (cleanSuccess) cmds.push(`database put ivr_vars ${tgt}_success ${cleanSuccess}`);
        if (cleanAgent) cmds.push(`database put ivr_vars ${tgt}_agent ${cleanAgent}`);
        if (cleanCancelWait) cmds.push(`database put ivr_vars ${tgt}_cancel_wait ${cleanCancelWait}`);
        if (cleanOtpVerifyWait) cmds.push(`database put ivr_vars ${tgt}_otp_verify_wait ${cleanOtpVerifyWait}`);
        if (normalizedMoh) cmds.push(`database put ivr_vars ${tgt}_hold_music ${normalizedMoh}`);
      }
      return cmds;
    };

    const primaryCommands = buildCommands(primaryTargets);
    const secondaryCommands = buildCommands(secondaryTargets);

    if (normalizedMoh && effectiveSuperAdmin) {
      secondaryCommands.push(`database put ivr_vars default_hold_music ${normalizedMoh}`);
      if (normalizedMoh !== activeAudioAssignments.hold_music) {
        applyHoldMusicToAsteriskMoh(normalizedMoh);
        activeAudioAssignments.hold_music = normalizedMoh;
        saveActiveAudioAssignments(activeAudioAssignments);
      }
    }

    // Await primary agent/destination commands so immediate test calls (like 8888) read fresh AstDB values
    for (const cmd of primaryCommands) {
      try {
        await executeAsteriskCommand(cmd);
      } catch (_) {}
    }

    // Run secondary default/system updates sequentially in background
    if (secondaryCommands.length > 0) {
      (async () => {
        for (const cmd of secondaryCommands) {
          try {
            await executeAsteriskCommand(cmd);
          } catch (_) {}
        }
        invalidateCliCache('database show ivr_vars');
      })();
    } else {
      invalidateCliCache('database show ivr_vars');
    }

    const targets = new Set<string>([...primaryTargets, ...secondaryTargets]);

    console.log('[AstDB SUCCESS] Audios sincronizados en Asterisk AstDB:', {
      agentId: agentId || 'global',
      targets: Array.from(targets),
      intro: cleanIntro,
      prompt: cleanPrompt,
      wait: cleanWait,
      success: cleanSuccess,
      agent: cleanAgent,
      holdMusic: cleanMoh,
    });

    res.json({
      success: true,
      message: agentId
        ? `Audios del IVR sincronizados y aislados para el agente/extensión ${agentId} y destinos asociados.`
        : 'Audios del IVR sincronizados permanentemente en Asterisk AstDB.',
      assigned: { intro: cleanIntro, prompt: cleanPrompt, wait: cleanWait, success: cleanSuccess, agent: cleanAgent },
      agentId,
      targets: Array.from(targets),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to retrieve active audio configuration from Asterisk AstDB
app.get('/api/asterisk/audio/config', async (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const scopedTenantId = isGlobalAdminUser(authUser)
      ? String(req.query.tenantId || '').trim()
      : String(authUser?.tenantId || '').trim();
    const stdout = await executeAsteriskCommand('database show ivr_vars');
    const audios: Record<string, string> = {};
    if (stdout) {
      const lines = stdout.split('\n');
      for (const line of lines) {
        // Line format: /ivr_vars/key : value
        const match = line.match(/^\/ivr_vars\/([^\s:]+)\s*:\s*(.+)$/);
        if (match) {
          const key = match[1].trim();
          const val = match[2].trim().replace(/^"|"$/g, '');
          audios[key] = val;
        }
      }
    }
    const tPrefix = scopedTenantId ? `tenant_${scopedTenantId}_` : '';

    res.json({
      success: true,
      audios: {
        intro: (tPrefix && audios[`${tPrefix}intro`]) || audios['default_intro'] || audios['8888_intro'] || audios['global_intro'] || 'custom/bienvenida_corporativa',
        prompt: (tPrefix && audios[`${tPrefix}prompt`]) || audios['default_prompt'] || audios['8888_prompt'] || audios['global_prompt'] || 'custom/solicitar_codigo_otp',
        wait: (tPrefix && audios[`${tPrefix}wait`]) || audios['default_wait'] || audios['8888_wait'] || audios['global_wait'] || 'custom/un_momento_validando_informacion',
        success: (tPrefix && audios[`${tPrefix}success`]) || audios['default_success'] || audios['8888_success'] || audios['global_success'] || 'custom/operacion_bloqueada_exito',
        agent: (tPrefix && audios[`${tPrefix}agent`]) || audios['default_agent'] || audios['8888_agent'] || audios['global_agent'] || 'custom/conectar_asesor',
      },
      allKeys: audios,
    });
  } catch (err: any) {
    res.json({ success: false, error: err.message, audios: {} });
  }
});

// Verify if an audio file exists physically in Asterisk sounds directory
app.all('/api/asterisk/audio/verify', (req, res) => {
  const audioPath = (req.query.path as string) || (req.body && req.body.path) || '';
  if (!audioPath) {
    return res.status(400).json({ success: false, exists: false, error: 'Ruta no especificada' });
  }

  // Asterisk sounds typically reside in SOUNDS_CUSTOM_DIR or /var/lib/asterisk/sounds/
  const cleanName = path
    .basename(String(audioPath).replace(/^custom\//, ''))
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_\-]/g, '')
    .trim();
  if (!cleanName) {
    return res.status(400).json({ success: false, exists: false, error: 'Nombre de audio inválido' });
  }
  const candidates = [
    path.join(SOUNDS_CUSTOM_DIR, `${cleanName}.wav`),
    path.join(SOUNDS_CUSTOM_DIR, `${cleanName}.gsm`),
    path.join(SOUNDS_CUSTOM_DIR, `${cleanName}.sln`),
    path.join(SOUNDS_CUSTOM_DIR, `${cleanName}.mp3`),
    path.join('/var/lib/asterisk/sounds/en', `${cleanName}.wav`),
    path.join('/var/lib/asterisk/sounds/es', `${cleanName}.wav`),
    path.join('/var/lib/asterisk/sounds', `${cleanName}.wav`),
  ];

  let found = false;
  let matchedPath = '';
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      found = true;
      matchedPath = c;
      break;
    }
  }

  // If HEAD request, set headers and return immediately
  if (req.method === 'HEAD') {
    if (found) {
      res.setHeader('X-Audio-Exists', 'true');
      res.setHeader('X-Audio-Path', matchedPath);
      return res.status(200).end();
    } else {
      res.setHeader('X-Audio-Exists', 'false');
      return res.status(404).end();
    }
  }

  return res.json({
    success: true,
    exists: found,
    path: audioPath,
    cleanName,
    matchedPath: found ? matchedPath : null,
  });
});

// Download raw audio file for Asterisk sounds directory (/var/lib/asterisk/sounds/custom/...)
app.get(['/api/asterisk/audio/raw', '/api/asterisk/audio/raw/:name'], (req, res) => {
  const inputName = String(req.params.name || req.query.file || '');
  const rawName = path.basename(inputName).replace(/^custom\//, '').replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!rawName) {
    return res.status(400).json({ success: false, error: 'Nombre de archivo inválido' });
  }
  const assetWav = path.join(process.cwd(), 'public/assets', `${rawName}.wav`);
  const assetGsm = path.join(process.cwd(), 'public/assets', `${rawName}.gsm`);
  const wavPath = path.join(SOUNDS_CUSTOM_DIR, `${rawName}.wav`);
  const gsmPath = path.join(SOUNDS_CUSTOM_DIR, `${rawName}.gsm`);

  // 1. Priority: Pre-recorded human Spanish voice assets in public/assets
  if (fs.existsSync(assetWav) && fs.statSync(assetWav).size > 1000) {
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `attachment; filename="${rawName}.wav"`);
    return res.sendFile(assetWav);
  }
  if (fs.existsSync(assetGsm) && fs.statSync(assetGsm).size > 500) {
    res.setHeader('Content-Type', 'audio/x-gsm');
    res.setHeader('Content-Disposition', `attachment; filename="${rawName}.gsm"`);
    return res.sendFile(assetGsm);
  }

  // 2. Sounds custom dir if size is greater than the old 56KB sine beep
  if (fs.existsSync(wavPath) && fs.statSync(wavPath).size > 60000) {
    res.setHeader('Content-Type', 'audio/wav');
    return res.sendFile(wavPath);
  }
  if (fs.existsSync(gsmPath) && fs.statSync(gsmPath).size > 1000) {
    res.setHeader('Content-Type', 'audio/x-gsm');
    return res.sendFile(gsmPath);
  }

  if (fs.existsSync(wavPath)) {
    return res.sendFile(wavPath);
  }
  if (fs.existsSync(gsmPath)) {
    return res.sendFile(gsmPath);
  }

  // Fallback: Generate Asterisk 8kHz PCM WAV
  let freq = 520;
  if (rawName.includes('otp')) freq = 680;
  if (rawName.includes('validando') || rawName.includes('wait')) freq = 440;
  if (rawName.includes('exito') || rawName.includes('success')) freq = 880;
  if (rawName.includes('asesor') || rawName.includes('agent')) freq = 587;

  const wavBuffer = generatePcm8kWaveBuffer(3.5, freq);
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Disposition', `attachment; filename="${rawName}.wav"`);
  res.send(wavBuffer);
});

// Universal 1-liner bash updater for remote VPS
app.get('/api/vps/update.sh', requireInternalOrGlobalAdmin, (req, res) => {
  const host = req.get('host') || 'localhost:3000';
  const proto = req.protocol || 'http';
  const baseUrl = `${proto}://${host}`;

  const bashScript = `#!/usr/bin/env bash
# ==========================================================
# ACTUALIZADOR TOTAL AUTOMATICO PARA VPS ASTERISK 20
# ==========================================================
set -e

echo ""
echo "=========================================================="
echo "    INICIANDO ACTUALIZACION COMPLETA EN TU VPS"
echo "=========================================================="
echo ""

APP_DIR=""
if [ -d "/var/www/sistema-otp" ]; then
  APP_DIR="/var/www/sistema-otp"
elif [ -d "/var/www/black-hat-dialer" ]; then
  APP_DIR="/var/www/black-hat-dialer"
elif [ -f "$(pwd)/package.json" ]; then
  APP_DIR="$(pwd)"
elif [ -d "/root/sistema-otp" ]; then
  APP_DIR="/root/sistema-otp"
fi

if [ -n "$APP_DIR" ] && [ -d "$APP_DIR" ]; then
  echo "=== [1/6] Entrando al directorio del proyecto: $APP_DIR ==="
  cd "$APP_DIR"

  echo "=== [2/6] Descargando ultimos cambios de GitHub (git pull) ==="
  mkdir -p /tmp/ast20_db_backup
  [ -f .env ] && cp -f .env /tmp/ast20_db_backup/.env 2>/dev/null || true
  [ -f reseller_data.json ] && cp -f reseller_data.json /tmp/ast20_db_backup/reseller_data.json 2>/dev/null || true
  [ -d data ] && cp -rf data /tmp/ast20_db_backup/ 2>/dev/null || true

  if [ -d ".git" ]; then
    git fetch --all || true
    BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
    [ "$BRANCH" = "HEAD" ] && BRANCH="main"
    git reset --hard "origin/$BRANCH" 2>/dev/null || git reset --hard origin/main 2>/dev/null || git pull --force || true
  fi

  # Restaurar .env, bases de datos de clientes y saldos para que ninguna actualizacion los sobreescriba
  if [ -f /tmp/ast20_db_backup/.env ]; then
    cp -f /tmp/ast20_db_backup/.env ./.env 2>/dev/null || true
  fi
  if [ -f /tmp/ast20_db_backup/reseller_data.json ]; then
    cp -f /tmp/ast20_db_backup/reseller_data.json ./reseller_data.json 2>/dev/null || true
  fi
  if [ -d /tmp/ast20_db_backup/data ]; then
    mkdir -p ./data
    cp -rn /tmp/ast20_db_backup/data/* ./data/ 2>/dev/null || true
  fi

  echo "=== [3/6] Instalando dependencias de Node.js ==="
  npm install --prefer-offline --no-audit 2>/dev/null || npm install || true

  echo "=== [4/6] Compilando nueva version del sistema (npm run build) ==="
  npm run build
fi

echo "=== [5/6] Sincronizando configuracion pura Asterisk 20 ==="
mkdir -p /etc/asterisk
mkdir -p /var/lib/asterisk/sounds/custom /var/lib/asterisk/sounds/es/custom /var/lib/asterisk/sounds/en/custom
mkdir -p /var/spool/asterisk/outgoing
chmod 750 /var/spool/asterisk/outgoing 2>/dev/null || true

curl -sSLk -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "${baseUrl}/api/asterisk/config/pjsip.conf" -o /etc/asterisk/pjsip.conf || true
curl -sSLk -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "${baseUrl}/api/asterisk/config/extensions.conf" -o /etc/asterisk/extensions.conf || true

cat << 'EOF_MGR' > /etc/asterisk/manager.conf
[general]
enabled = yes
port = ${AMI_PORT}
bindaddr = 127.0.0.1

[${AMI_USER}]
secret = ${AMI_SECRET}
read = all
write = all

[admin]
secret = ${AMI_ADMIN_SECRET}
read = all
write = all
EOF_MGR
chmod 640 /etc/asterisk/manager.conf 2>/dev/null || true

echo "Recargando Asterisk PJSIP, RTP, AMD, Dialplan y Audio Natural..."
asterisk -rx "database deltree voice_changer" 2>/dev/null || true
asterisk -rx "module load res_timing_timerfd.so" 2>/dev/null || true
asterisk -rx "module reload res_rtp_asterisk.so" 2>/dev/null || true
asterisk -rx "module reload app_amd.so" 2>/dev/null || true
asterisk -rx "pjsip reload" 2>/dev/null || true
asterisk -rx "dialplan reload" 2>/dev/null || true
asterisk -rx "manager reload" 2>/dev/null || true

echo "=== [6/6] Reiniciando servicio de la aplicacion en el VPS ==="
if command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null | grep -qE "online|stopped|errored"; then
  pm2 restart all
  pm2 save 2>/dev/null || true
  echo "✓ Proceso PM2 reiniciado exitosamente."
elif systemctl is-active --quiet asterisk-web 2>/dev/null; then
  systemctl restart asterisk-web
  echo "✓ Servicio systemd asterisk-web reiniciado."
elif systemctl is-active --quiet dialer 2>/dev/null; then
  systemctl restart dialer
  echo "✓ Servicio systemd dialer reiniciado."
elif systemctl is-active --quiet otp 2>/dev/null; then
  systemctl restart otp
  echo "✓ Servicio systemd otp reiniciado."
else
  fuser -k 3000/tcp 2>/dev/null || true
  pkill -9 -f "dist/server.cjs" 2>/dev/null || true
  pkill -9 -f "tsx server.ts" 2>/dev/null || true
  sleep 1
  if [ -n "$APP_DIR" ]; then
    cd "$APP_DIR"
    nohup npm start > app.log 2>&1 &
    echo "✓ Aplicacion iniciada con 'npm start' en segundo plano (PID: $!)."
  fi
fi

echo ""
echo "=========================================================="
echo "    ¡ACTUALIZACION COMPLETADA EXITOSAMENTE!"
echo "=========================================================="
echo " 1. Codigo compilado en dist/ (Reventa de Minutos y MicroSIP activos)."
echo " 2. Asterisk 20 actualizado en puerto 47923."
echo " 3. Servicio Node.js reiniciado y escuchando en el puerto 3000."
echo ""
echo " >>> ATENCION CRITICA <<<"
echo " En tu navegador presiona CTRL + F5 (o abre una ventana de incógnito)"
echo " para limpiar la caché del navegador y ver todos los cambios nuevos."
echo "=========================================================="
`;

  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  res.send(bashScript);
});

// Universal 1-liner bash installer for remote VPS vmi3461829
app.get('/api/asterisk/install.sh', requireInternalOrGlobalAdmin, (req, res) => {
  const host = req.get('host') || 'localhost:3000';
  const proto = req.protocol || 'http';
  const baseUrl = `${proto}://${host}`;

  const bashScript = `#!/usr/bin/env bash
# ==========================================================
# Sincronización Automática Asterisk con Plataforma Web
# Servidor: ${baseUrl}
# ==========================================================
set -e

echo "=== [1/5] Preparando directorios de Asterisk ==="
mkdir -p /etc/asterisk
mkdir -p /var/lib/asterisk/sounds/custom

echo "=== [2/5] Descargando dialplan extensions.conf y pjsip.conf actualizado ==="
if [ -f /etc/asterisk/extensions.conf ]; then
  cp /etc/asterisk/extensions.conf /etc/asterisk/extensions.conf.bak_$(date +%s)
fi
curl -sSLk -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "${baseUrl}/api/asterisk/config/extensions.conf" -o /etc/asterisk/extensions.conf

if [ -f /etc/asterisk/pjsip.conf ]; then
  cp /etc/asterisk/pjsip.conf /etc/asterisk/pjsip.conf.bak_$(date +%s)
fi
curl -sSLk -H "X-Internal-Webhook-Key: ${INTERNAL_WEBHOOK_KEY}" "${baseUrl}/api/asterisk/config/pjsip.conf" -o /etc/asterisk/pjsip.conf

# Configuración segura de AMI (solo loopback)
cat << 'EOF_MGR' > /etc/asterisk/manager.conf
[general]
enabled = yes
port = ${AMI_PORT}
bindaddr = 127.0.0.1

[${AMI_USER}]
secret = ${AMI_SECRET}
read = all
write = all

[admin]
secret = ${AMI_ADMIN_SECRET}
read = all
write = all
EOF_MGR
chmod 640 /etc/asterisk/manager.conf 2>/dev/null || true

echo "=== [3/5] Descargando y verificando audios de IVR en /var/lib/asterisk/sounds/custom/ ==="
AUDIOS=("banrearreglado" "alerta_banco_antifraude" "solicitar_codigo_otp" "digite_token_6_digitos" "token_invalido_reintente" "un_momento_validando_informacion" "operacion_bloqueada_exito" "conectar_asesor_banco" "bienvenida_corporativa" "prompt_otp_6_digitos")
for aud in "\${AUDIOS[@]}"; do
  file_size=0
  if [ -f "/var/lib/asterisk/sounds/custom/\${aud}.wav" ]; then
    file_size=$(stat -c%s "/var/lib/asterisk/sounds/custom/\${aud}.wav" 2>/dev/null || echo 0)
  fi
  if [ ! -s "/var/lib/asterisk/sounds/custom/\${aud}.wav" ] || [ "\$file_size" -le 60000 ]; then
    echo "  -> Obteniendo audio de voz humana: \${aud}.wav..."
    curl -sSLk "\${baseUrl}/api/asterisk/audio/raw/\${aud}" -o "/var/lib/asterisk/sounds/custom/\${aud}.wav" || true
  fi
done
chmod -R 775 /var/lib/asterisk/sounds 2>/dev/null || true

echo "=== [4/5] Configurando base de datos interna AstDB ==="
asterisk -rx 'database put ivr_vars default_intro custom/banrearreglado' || true
asterisk -rx 'database put ivr_vars 8888_intro custom/banrearreglado' || true
asterisk -rx 'database put ivr_vars default_action ivr-press1' || true
asterisk -rx 'database put ivr_vars default_prompt custom/solicitar_codigo_otp' || true
asterisk -rx 'database put ivr_vars default_wait custom/un_momento_validando_informacion' || true
asterisk -rx 'database put ivr_vars default_success custom/operacion_bloqueada_exito' || true
asterisk -rx 'database put ivr_vars default_agent custom/conectar_asesor' || true
asterisk -rx 'database put ivr_vars 8888_agent_exten 1001' || true

asterisk -rx 'database put ivr_vars 8888_intro custom/notificacion_servicio' || true
asterisk -rx 'database put ivr_vars 8888_prompt custom/solicitar_codigo_otp' || true
asterisk -rx 'database put ivr_vars 8888_wait custom/un_momento_validando_informacion' || true
asterisk -rx 'database put ivr_vars 8888_success custom/operacion_bloqueada_exito' || true
asterisk -rx 'database put ivr_vars 8888_agent custom/conectar_asesor' || true
asterisk -rx 'database put ivr_vars 8888_agent_exten 1001' || true

asterisk -rx 'database deltree extension_cid/1001' || true

echo "=== [5/5] Recargando Manager, Dialplan y PJSIP en caliente ==="
asterisk -rx 'manager reload' || true
asterisk -rx 'dialplan reload' || true
asterisk -rx 'pjsip reload' || true

echo ""
echo "=========================================================="
echo " ¡SINCRONIZACION EXITOSA CON ASTERISK!"
echo " 1. Dialplan /etc/asterisk/extensions.conf cargado."
echo " 2. Eliminado 'Anonymous' con subrutina pre-dial de PJSIP."
echo " 3. Audios de IVR activos en /var/lib/asterisk/sounds/custom/."
echo " 4. Flujo OTP configurado para validacion manual del asesor."
echo " Puedes probar marcando 8888 desde el softphone o desde la web."
echo "=========================================================="
`;

  res.setHeader('Content-Type', 'text/x-shellscript');
  res.send(bashScript);
});

// In-memory buffer for captured OTPs in production
interface CapturedOtpItem {
  id: string;
  number: string;
  otp: string;
  timestamp: string;
  createdAt?: number;
  channel?: string;
  service?: string;
  status: 'valid' | 'invalid' | 'pending';
  agent?: string;
  tenantId?: string; // Call Center / Tenant ID para partición de base de datos
}

function loadStoredOtpHistory(): CapturedOtpItem[] {
  try {
    if (fs.existsSync(OTP_HISTORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(OTP_HISTORY_FILE, 'utf8'));
      if (Array.isArray(parsed)) return parsed.slice(0, 300);
    }
  } catch (_) {}
  return [];
}

function saveStoredOtpHistory(list: CapturedOtpItem[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o750 });
    fs.writeFileSync(OTP_HISTORY_FILE, JSON.stringify((list || []).slice(0, 300), null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (_) {}
}

let capturedOtpHistory: CapturedOtpItem[] = loadStoredOtpHistory();
let lastAstDbSyncTime = 0;
let isSyncingAstDb = false;

// Endpoint to receive OTP captures from Asterisk curl (GET or POST) or AMI
app.all('/api/asterisk/otp/capture', requireInternalOrGlobalAdmin, (req, res) => {
  const number = req.body?.number || req.query?.number;
  const callerid = req.body?.callerid || req.query?.callerid;
  const otp = req.body?.otp || req.query?.otp;
  const channel = req.body?.channel || req.query?.channel;
  const exten = req.body?.exten || req.query?.exten;
  const service = req.body?.service || req.query?.service || (exten ? `Captura OTP (Ext. ${exten})` : 'Servicio al Cliente');
  const status = req.body?.status || req.query?.status || 'pending';
  let agent = req.body?.agent || req.query?.agent;
  let tenantId = req.body?.tenantId || req.query?.tenantId || req.body?.tenant || req.query?.tenant;
  const userId = req.body?.userId || req.query?.userId || req.body?.userid || req.query?.userid;

  // Fallback: si el canal es PJSIP de una extensión interna (ej. PJSIP/1002-000001), extraer la extensión real
  if ((!agent || agent === 'ringall' || agent === 'all') && channel) {
    const chanMatch = String(channel).match(/^PJSIP\/([0-9]{3,5})-/i);
    if (chanMatch) {
      agent = chanMatch[1];
    }
  }
  if ((!agent || agent === 'ringall' || agent === 'all') && callerid && /^[0-9]{3,5}$/.test(String(callerid).trim())) {
    const cidTrim = String(callerid).trim();
    if (!/^4\d{3}$/.test(cidTrim) && cidTrim !== '8888') {
      agent = cidTrim;
    }
  }

  const rawNumForCall = (number && number !== '<unknown>') ? String(number).trim().replace(/[^0-9]/g, '') : '';
  const clean10ForCall = rawNumForCall.length === 11 && rawNumForCall.startsWith('1') ? rawNumForCall.substring(1) : rawNumForCall;
  const activeCallRef = rawNumForCall
    ? (callStatusStore.get(rawNumForCall) || callStatusStore.get(clean10ForCall) || callStatusStore.get(`1${clean10ForCall}`))
    : undefined;

  if ((!agent || agent === 'ringall' || agent === 'all') && activeCallRef?.agent && activeCallRef.agent !== 'ringall' && activeCallRef.agent !== 'all') {
    agent = activeCallRef.agent;
  }
  if (!tenantId && activeCallRef?.tenantId) {
    tenantId = activeCallRef.tenantId;
  }

  // Auto-resolve tenantId if not provided: match agent extension(s) with tenant ranges
  if (!tenantId && agent) {
    const firstAgentExt = String(agent).split('&')[0]?.trim() || '';
    const extNum = parseInt(firstAgentExt, 10);
    if (!isNaN(extNum)) {
      const storedTenants = loadStoredTenants();
      const matched = storedTenants.find((t: any) => extNum >= t.extensionStart && extNum <= t.extensionEnd);
      if (matched) {
        tenantId = matched.id;
      }
    }
  }

  if (otp) {
    const rawNumber = (number && number !== '<unknown>') ? String(number).trim() : '8888';
    const digitsOnlyNum = rawNumber.replace(/[^0-9]/g, '');
    const cleanNumber = digitsOnlyNum || rawNumber || '8888';
    const clean10 = cleanNumber.length === 11 && cleanNumber.startsWith('1') ? cleanNumber.substring(1) : cleanNumber;
    const norm10 = (v: string) => {
      const d = String(v || '').replace(/[^0-9]/g, '');
      return d.length >= 10 ? d.slice(-10) : d;
    };
    const cleanOtp = String(otp).replace(/[^0-9*#]/g, '').trim() || String(otp).trim();
    const cleanStatus = (status === 'valid' || status === 'invalid') ? status : 'pending';
    const cleanAgent = (agent && agent !== 'ringall' && agent !== 'all') ? String(agent).trim() : undefined;
    const cleanTenantId = tenantId ? String(tenantId).trim() : undefined;

    // Bring or create to the very top (index 0), keeping separate records per agent
    const existingIndex = capturedOtpHistory.findIndex(
      (r) =>
        (r.number === cleanNumber || (norm10(r.number) && norm10(r.number) === norm10(cleanNumber))) &&
        r.otp === cleanOtp &&
        (!cleanAgent || !r.agent || r.agent === cleanAgent)
    );
    let record: CapturedOtpItem;
    if (existingIndex >= 0) {
      record = capturedOtpHistory.splice(existingIndex, 1)[0];
      record.number = cleanNumber;
      record.timestamp = new Date().toLocaleTimeString();
      record.createdAt = Date.now();
      record.status = cleanStatus;
      record.channel = channel ? String(channel) : record.channel;
      if (service) record.service = String(service);
      if (cleanAgent) record.agent = cleanAgent;
      if (cleanTenantId) record.tenantId = cleanTenantId;
      if (userId || activeCallRef?.userId) (record as any).userId = String(userId || activeCallRef?.userId);
    } else {
      record = {
        id: 'otp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        number: cleanNumber,
        otp: cleanOtp,
        timestamp: new Date().toLocaleTimeString(),
        createdAt: Date.now(),
        channel: channel ? String(channel) : (exten ? `Ext. ${exten}` : 'PJSIP'),
        service: service ? String(service) : 'Servicio al Cliente',
        status: cleanStatus,
        agent: cleanAgent,
        tenantId: cleanTenantId,
        ...(userId || activeCallRef?.userId ? { userId: String(userId || activeCallRef?.userId) } : {}),
      } as any;
    }
    capturedOtpHistory.unshift(record);
    if (capturedOtpHistory.length > 300) capturedOtpHistory.pop();
    saveStoredOtpHistory(capturedOtpHistory);
    lastAstDbSyncTime = 0; // Invalidate cache so polling gets updated immediately

    // Sync captured OTP directly into active callStatusStore entries so call/status & live/calls update instantly
    if (cleanStatus === 'pending') {
      const storeKeys = Array.from(new Set([rawNumForCall, cleanNumber, clean10, clean10.length === 10 ? `1${clean10}` : ''].filter(Boolean)));
      for (const sk of storeKeys) {
        const entry = callStatusStore.get(sk);
        if (entry && entry.status !== 'ended' && entry.status !== 'machine' && entry.status !== 'machine_detected') {
          (entry as any).capturedOtp = cleanOtp;
          (entry as any).otpStatus = cleanStatus;
          if (entry.status === 'asking_otp' || entry.status === 'asking_cancel_code' || entry.status === 'pressed_1' || entry.status === 'in_ivr') {
            entry.status = 'otp_captured';
          }
          if (cleanAgent) entry.agent = cleanAgent;
          entry.timestamp = Date.now();
        }
      }
    }

    console.log(`[PRODUCCIÓN] ⭐ ¡NUEVO CÓDIGO OTP CAPTURADO!: [${cleanOtp}] - Tel: ${cleanNumber} (Ext: ${exten || 'IVR'}, Agente: ${record.agent || 'pendiente'}, Call Center Tenant: ${record.tenantId || 'Global'})`);

    // Synchronize to Asterisk AstDB in background across normalized phone keys + OTP key
    const numKeys = Array.from(new Set([rawNumber, cleanNumber, clean10, clean10.length === 10 ? `1${clean10}` : ''].filter(Boolean)));
    for (const nk of numKeys) {
      executeAsteriskCommand(`database put otp_codes "${nk}" "${cleanOtp}"`).catch(() => {});
      executeAsteriskCommand(`database put otp_status "${nk}" "${cleanStatus}"`).catch(() => {});
      if (record.agent) {
        executeAsteriskCommand(`database put otp_agent "${nk}" "${record.agent}"`).catch(() => {});
        executeAsteriskCommand(`database put otp_status "${nk}_${record.agent}" "${cleanStatus}"`).catch(() => {});
        executeAsteriskCommand(`database put last_picked_agent "${nk}" "${record.agent}"`).catch(() => {});
        executeAsteriskCommand(`database put last_agent_call "${nk}" "${record.agent}"`).catch(() => {});
      }
    }
    if (cleanOtp) {
      executeAsteriskCommand(`database put otp_status "${cleanOtp}" "${cleanStatus}"`).catch(() => {});
    }
  }
  res.json({ success: true, count: capturedOtpHistory.length, records: capturedOtpHistory.slice(0, 10) });
});

// Endpoint for agent to decide if captured OTP is valid or invalid
app.post('/api/asterisk/otp/decision', requireActiveMembership, async (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const { id, otp, number, status, action, agent } = req.body;
    if (!status || (status !== 'valid' && status !== 'invalid')) {
      return res.status(400).json({ success: false, error: 'El estado debe ser "valid" o "invalid"' });
    }

    // Forward to remote Asterisk if running in cloud preview mode without local Asterisk
    if (!hasLocalAsterisk && REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('localhost') && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') && !req.headers['x-governor-fwd']) {
      try {
        const remoteResp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/otp/decision`, {
          method: 'POST',
          headers: buildRemoteAuthHeaders(req, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(req.body),
        });
        if (remoteResp.ok) {
          const remoteJson = await remoteResp.json();
          return res.json(remoteJson);
        }
      } catch (_) {}
    }

    const normDigits = (v: any) => String(v || '').replace(/[^0-9]/g, '');
    const normLast10 = (v: any) => {
      const d = normDigits(v);
      return d.length >= 10 ? d.slice(-10) : d;
    };
    const reqNum10 = normLast10(number);
    const reqOtp = otp ? String(otp).replace(/[^0-9*#]/g, '').trim() : '';

    let targetRecord: CapturedOtpItem | undefined;
    if (id) {
      targetRecord = capturedOtpHistory.find((r) => r.id === id);
    }
    if (!targetRecord && number && reqOtp) {
      targetRecord = capturedOtpHistory.find((r) =>
        (r.number === number || (reqNum10 && normLast10(r.number) === reqNum10)) && r.otp === reqOtp
      );
    }
    if (!targetRecord && number) {
      targetRecord = capturedOtpHistory.find((r) =>
        r.number === number || (reqNum10 && normLast10(r.number) === reqNum10)
      );
    }
    if (!targetRecord && reqOtp) {
      targetRecord = capturedOtpHistory.find((r) => r.otp === reqOtp);
    }

    if (targetRecord && !isGlobalAdminUser(authUser)) {
      if (authUser?.tenantId && targetRecord.tenantId && String(targetRecord.tenantId) !== String(authUser.tenantId)) {
        return res.status(403).json({ success: false, error: 'No autorizado para validar códigos de otro Call Center.' });
      }
      if (!isAdminUser(authUser) && Array.isArray(authUser?.assignedExtensions) && authUser.assignedExtensions.length > 0 && targetRecord.agent && targetRecord.agent !== 'ringall' && targetRecord.agent !== 'all') {
        const assignedSet = new Set(authUser.assignedExtensions.map((x: any) => String(x).trim()));
        const agentParts = String(targetRecord.agent).split('&').map((s: string) => s.trim()).filter(Boolean);
        if (agentParts.length > 0 && !agentParts.some((ext: string) => assignedSet.has(ext))) {
          return res.status(403).json({ success: false, error: 'No autorizado para validar códigos de otra extensión.' });
        }
      }
    }

    if (targetRecord) {
      targetRecord.status = status;
      saveStoredOtpHistory(capturedOtpHistory);
    }

    lastAstDbSyncTime = 0; // Force immediate refresh

    const cleanNum = normDigits(number) || normDigits(targetRecord?.number);
    const clean10 = cleanNum.length === 11 && cleanNum.startsWith('1') ? cleanNum.substring(1) : (cleanNum.length > 10 ? cleanNum.slice(-10) : cleanNum);
    const effectiveOtp = reqOtp || (targetRecord?.otp ? String(targetRecord.otp).replace(/[^0-9*#]/g, '').trim() : '');

    // Determine the exact agent/extension that originally answered the call
    const cleanAgentParam = (agent && agent !== 'ringall' && agent !== 'all') ? String(agent).replace(/[^a-zA-Z0-9_\-&]/g, '') : undefined;
    let returnAgent = cleanAgentParam;
    if (!returnAgent && targetRecord?.agent && targetRecord.agent !== 'ringall' && targetRecord.agent !== 'all') {
      returnAgent = String(targetRecord.agent).replace(/[^a-zA-Z0-9_\-&]/g, '');
    }
    if (!returnAgent && cleanNum) {
      const callInfo = callStatusStore.get(cleanNum) || callStatusStore.get(clean10) || callStatusStore.get(`1${clean10}`);
      if (callInfo?.agent && callInfo.agent !== 'ringall' && callInfo.agent !== 'all') {
        returnAgent = String(callInfo.agent).replace(/[^a-zA-Z0-9_\-&]/g, '');
      }
    }

    // Build complete set of possible AstDB number keys (raw, digits, 10-digit, 11-digit, targetRecord.number)
    const candidateKeysSet = new Set<string>();
    const addCandidateVariants = (rawVal: any) => {
      const s = String(rawVal || '').trim();
      const d = normDigits(s);
      if (s && /^[a-zA-Z0-9_+.\-]+$/.test(s)) candidateKeysSet.add(s);
      if (d) {
        candidateKeysSet.add(d);
        const d10 = d.length >= 10 ? d.slice(-10) : d;
        candidateKeysSet.add(d10);
        if (d10.length === 10) candidateKeysSet.add(`1${d10}`);
      }
    };
    addCandidateVariants(number);
    addCandidateVariants(targetRecord?.number);
    const candidateKeys = Array.from(candidateKeysSet);

    const agentPartsForDb = returnAgent
      ? Array.from(new Set([returnAgent, ...returnAgent.split('&').map((s) => s.trim()).filter(Boolean)]))
      : [];

    const dbWrites: Promise<any>[] = [];
    for (const nk of candidateKeys) {
      dbWrites.push(executeAsteriskCommand(`database put otp_status "${nk}" "${status}"`).catch(() => {}));
      for (const ag of agentPartsForDb) {
        dbWrites.push(executeAsteriskCommand(`database put otp_status "${nk}_${ag}" "${status}"`).catch(() => {}));
      }
      if (status === 'valid' && returnAgent) {
        dbWrites.push(
          executeAsteriskCommand(`database put last_picked_agent "${nk}" "${returnAgent}"`).catch(() => {}),
          executeAsteriskCommand(`database put last_agent_call "${nk}" "${returnAgent}"`).catch(() => {}),
          executeAsteriskCommand(`database put ivr_vars "${nk}_agent_exten" "${returnAgent}"`).catch(() => {})
        );
      }
      if (action === 'request_retry' || status === 'invalid') {
        dbWrites.push(
          executeAsteriskCommand(`database del otp_codes "${nk}"`).catch(() => {}),
          executeAsteriskCommand(`database del otp_captures "${nk}"`).catch(() => {})
        );
      }
    }

    // Critical fallback key checked by [ivr-captura-vivo]: DB(otp_status/${USER_DIGITS})
    if (effectiveOtp) {
      dbWrites.push(executeAsteriskCommand(`database put otp_status "${effectiveOtp}" "${status}"`).catch(() => {}));
    }

    if (cleanNum) {
      const activeMemCall = callStatusStore.get(cleanNum) || callStatusStore.get(clean10) || callStatusStore.get(`1${clean10}`);
      if (activeMemCall) {
        activeMemCall.cancelDecision = status;
        callStatusStore.set(cleanNum, activeMemCall);
        if (clean10) callStatusStore.set(clean10, activeMemCall);
        if (clean10.length === 10) callStatusStore.set(`1${clean10}`, activeMemCall);
      }
    }

    if (dbWrites.length > 0) {
      await Promise.all(dbWrites);
    }

    console.log(`[DECISIÓN AGENTE] OTP ${effectiveOtp || ''} para ${cleanNum || targetRecord?.number || 'destino'} marcado como: [${status.toUpperCase()}] -> Retorno: ${returnAgent || 'agente asignado'} (Keys: ${candidateKeys.join(', ')})`);

    res.json({
      success: true,
      message: `Código marcado como ${status === 'valid' ? 'VÁLIDO (Aprobado)' : 'INVÁLIDO (Rechazado)'} por el agente. Retornando a extensión ${returnAgent || '1001'}.`,
      status,
      returnAgent,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint for agent to signal Asterisk that the cancellation code was sent to the client so Asterisk prompts the client to type it
app.post('/api/asterisk/call/cancel-code-sent', requireActiveMembership, async (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const { number, agent } = req.body || {};
    const cleanNum = number ? String(number).replace(/[^0-9]/g, '') : '';
    if (!cleanNum) {
      return res.status(400).json({ success: false, error: 'Número de destino obligatorio' });
    }
    const clean10 = cleanNum.length === 11 && cleanNum.startsWith('1') ? cleanNum.substring(1) : cleanNum;
    const existingCall =
      callStatusStore.get(cleanNum) || callStatusStore.get(clean10) || callStatusStore.get(`1${clean10}`);

    if (existingCall && !canUserAccessCall(authUser, existingCall)) {
      return res.status(403).json({ success: false, error: 'No tienes permiso para operar esta llamada.' });
    }

    const cleanAgent = agent && agent !== 'ringall' && agent !== 'all'
      ? String(agent).trim()
      : (existingCall?.agent && existingCall.agent !== 'ringall' ? String(existingCall.agent).trim() : '');

    const dbWrites: Promise<any>[] = [
      executeAsteriskCommand(`database put cancel_send "${cleanNum}" "send_now"`).catch(() => {}),
      executeAsteriskCommand(`database put cancel_send "${clean10}" "send_now"`).catch(() => {}),
      executeAsteriskCommand(`database put cancel_send "1${clean10}" "send_now"`).catch(() => {}),
    ];
    if (cleanAgent) {
      dbWrites.push(
        executeAsteriskCommand(`database put cancel_send "${cleanNum}_${cleanAgent}" "send_now"`).catch(() => {}),
        executeAsteriskCommand(`database put cancel_send "${clean10}_${cleanAgent}" "send_now"`).catch(() => {}),
        executeAsteriskCommand(`database put cancel_send "1${clean10}_${cleanAgent}" "send_now"`).catch(() => {})
      );
    }

    if (existingCall) {
      existingCall.status = 'asking_cancel_code';
      existingCall.mode = existingCall.mode || 'cancel_code';
      existingCall.timestamp = Date.now();
      callStatusStore.set(cleanNum, existingCall);
      callStatusStore.set(clean10, existingCall);
      callStatusStore.set(`1${clean10}`, existingCall);
    }

    await Promise.all(dbWrites);
    console.log(`[CANCEL CODE SENT] Agente notificó envío de código a ${cleanNum} -> Asterisk solicitando dígitos al cliente`);

    res.json({
      success: true,
      number: cleanNum,
      status: 'asking_cancel_code',
      message: 'Aviso enviado a Asterisk. El cliente ahora escuchará la solicitud para digitar su código.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to list all captured OTP records
app.get('/api/asterisk/otp/records', async (req, res) => {
  const authUser = (req as any).authUser;
  const authIsGlobalAdmin = isGlobalAdminUser(authUser);
  const forceFresh = req.query.fresh === '1' || req.query.fresh === 'true';
  const shouldClear = req.query.clear === '1' || req.query.clear === 'true';
  const rawQueryTenantId = req.query.tenantId ? String(req.query.tenantId).trim() : undefined;
  const queryTenantId = authIsGlobalAdmin
    ? rawQueryTenantId
    : (authUser?.tenantId ? String(authUser.tenantId) : rawQueryTenantId);
  const queryExtensionsRaw = req.query.extensions ? String(req.query.extensions).trim() : '';
  const requestedExts = queryExtensionsRaw
    ? queryExtensionsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const userAssignedExts = Array.isArray(authUser?.assignedExtensions)
    ? authUser.assignedExtensions.map((s: any) => String(s).trim()).filter(Boolean)
    : [];
  const allowedExts = authIsGlobalAdmin || isAdminUser(authUser)
    ? requestedExts
    : (requestedExts.length > 0 && userAssignedExts.length > 0
        ? requestedExts.filter((e) => userAssignedExts.includes(e))
        : userAssignedExts);

  if (shouldClear) {
    if (allowedExts.length > 0) {
      capturedOtpHistory = capturedOtpHistory.filter(
        (r) => !r.agent || !allowedExts.includes(String(r.agent).trim())
      );
      saveStoredOtpHistory(capturedOtpHistory);
      for (const ext of allowedExts) {
        executeAsteriskCommand(`database del otp_codes "${ext}"`).catch(() => {});
        executeAsteriskCommand(`database del otp_status "${ext}"`).catch(() => {});
      }
    } else if (queryTenantId && queryTenantId !== 'all') {
      capturedOtpHistory = capturedOtpHistory.filter((r) => r.tenantId !== queryTenantId);
      saveStoredOtpHistory(capturedOtpHistory);
    } else {
      if (!authIsGlobalAdmin) {
        return res.status(403).json({ success: false, error: 'Solo el Super Administrador Global puede borrar todo el historial.' });
      }
      capturedOtpHistory = [];
      saveStoredOtpHistory(capturedOtpHistory);
      lastAstDbSyncTime = Date.now();
      try {
        await executeAsteriskCommand('database deltree otp_codes');
        await executeAsteriskCommand('database deltree otp_status');
        await executeAsteriskCommand('database deltree otp_agent');
        await executeAsteriskCommand('database deltree captured_otp');
        await executeAsteriskCommand('database deltree otp_captures');
        await executeAsteriskCommand('database deltree otp_decision');
        await executeAsteriskCommand('database deltree otp_last_status');
      } catch (_) {}
    }
    return res.json({ success: true, records: [] });
  }

  const now = Date.now();

  // Return real-time memory records filtered by tenant and/or assigned extensions
  let filteredRecords = (queryTenantId && queryTenantId !== 'all')
    ? capturedOtpHistory.filter((r) => r.tenantId === queryTenantId)
    : capturedOtpHistory;

  if (allowedExts.length > 0) {
    filteredRecords = filteredRecords.filter((r: any) => {
      if (authUser?.id && r.userId && String(r.userId) === String(authUser.id)) return true;
      const recAgent = r.agent ? String(r.agent).trim() : '';
      if (recAgent && recAgent !== 'ringall' && recAgent !== 'all') {
        return recAgent.split('&').some((ext: string) => allowedExts.includes(ext.trim()));
      }
      if (authUser?.tenantId && r.tenantId && String(r.tenantId) === String(authUser.tenantId)) {
        return true;
      }
      return allowedExts.includes(String(r.number).trim());
    });
  } else if (!authIsGlobalAdmin && authUser?.tenantId) {
    filteredRecords = filteredRecords.filter((r) => String(r.tenantId || '') === String(authUser.tenantId));
  }

  res.json({ success: true, records: filteredRecords, totalAllTenants: authIsGlobalAdmin ? capturedOtpHistory.length : filteredRecords.length });

  // Optional background sync with Asterisk AstDB every 30 seconds without blocking response
  const canQueryLocalOrRemoteAstDb = !hasLocalAsterisk || fs.existsSync('/var/run/asterisk/asterisk.ctl');
  if (!isSyncingAstDb && canQueryLocalOrRemoteAstDb && (forceFresh || now - lastAstDbSyncTime >= 30000)) {
    isSyncingAstDb = true;
    (async () => {
      try {
        const [codesOutput, statusOutput, agentOutput, pickedOutput] = await Promise.all([
          executeAsteriskCommand('database show otp_codes'),
          executeAsteriskCommand('database show otp_status'),
          executeAsteriskCommand('database show otp_agent'),
          executeAsteriskCommand('database show last_picked_agent'),
        ]);

        const statusMap: Record<string, 'valid' | 'invalid' | 'pending'> = {};
        if (statusOutput) {
          const sLines = statusOutput.split('\n');
          for (const line of sLines) {
            const clean = line.replace(/^Output:\s*/, '').trim();
            const m = clean.match(/^\/otp_status\/([^\s:]*)\s*:\s*([a-zA-Z]+)/);
            if (m) {
              const num = m[1].trim();
              const st = m[2].trim().toLowerCase();
              if (st === 'valid' || st === 'invalid' || st === 'pending') {
                statusMap[num] = st;
              }
            }
          }
        }

        const agentMap: Record<string, string> = {};
        for (const srcOut of [pickedOutput, agentOutput]) {
          if (!srcOut) continue;
          for (const line of srcOut.split('\n')) {
            const clean = line.replace(/^Output:\s*/, '').trim();
            const m = clean.match(/^\/(?:otp_agent|last_picked_agent)\/([^\s:]+)\s*:\s*([0-9]{3,5})/);
            if (m) {
              agentMap[m[1].trim()] = m[2].trim();
            }
          }
        }

        const storedTenants = loadStoredTenants();
        const isEngineExt = (n: string) =>
          /^4\d{3}$/.test(n) || n === '8888';

        if (codesOutput) {
          const lines = codesOutput.split('\n');
          for (const line of lines) {
            const cleanLine = line.replace(/^Output:\s*/, '').trim();
            const match = cleanLine.match(/^\/otp_codes\/([^\s:]+)\s*:\s*([0-9*#]+)/);
            if (match) {
              const num = match[1].trim();
              if (isEngineExt(num)) continue; // Ignore shared IVR engine extension keys (4001+, 8888)
              const code = match[2].trim();
              const resolvedAgent =
                agentMap[num] ||
                callStatusStore.get(num)?.agent ||
                (/^[0-9]{3,5}$/.test(num) ? num : undefined);
              const cleanResolvedAgent =
                resolvedAgent && resolvedAgent !== 'ringall' && resolvedAgent !== 'all' ? resolvedAgent : undefined;
              const statusKey = cleanResolvedAgent ? `${num}_${cleanResolvedAgent}` : num;
              const currentStatus = statusMap[statusKey] || statusMap[num] || 'pending';

              const existingIndex = capturedOtpHistory.findIndex(
                (r) =>
                  r.number === num &&
                  r.otp === code &&
                  (!cleanResolvedAgent || !r.agent || r.agent === cleanResolvedAgent)
              );

              if (existingIndex >= 0) {
                capturedOtpHistory[existingIndex].status = currentStatus;
                if (!capturedOtpHistory[existingIndex].agent && cleanResolvedAgent) {
                  capturedOtpHistory[existingIndex].agent = cleanResolvedAgent;
                }
              } else {
                let resolvedTenantId: string | undefined;
                if (cleanResolvedAgent) {
                  const extNum = parseInt(cleanResolvedAgent, 10);
                  const matched = storedTenants.find((t: any) => extNum >= t.extensionStart && extNum <= t.extensionEnd);
                  if (matched) resolvedTenantId = matched.id;
                }
                capturedOtpHistory.unshift({
                  id: 'astdb-' + num + '-' + (cleanResolvedAgent || 'ext') + '-' + code,
                  number: num,
                  otp: code,
                  timestamp: new Date().toLocaleTimeString(),
                  createdAt: Date.now(),
                  channel: cleanResolvedAgent ? `PJSIP/${cleanResolvedAgent}` : 'Captura OTP',
                  service: 'Captura OTP Dinámica',
                  status: currentStatus,
                  agent: cleanResolvedAgent,
                  tenantId: resolvedTenantId,
                });
                if (capturedOtpHistory.length > 300) capturedOtpHistory.pop();
              }
            }
          }
        }

        // Actualizar estados sincronizados desde AstDB para todos los registros
        for (const r of capturedOtpHistory) {
          const perAgentKey = r.agent ? `${r.number}_${r.agent}` : r.number;
          if (statusMap[perAgentKey]) {
            r.status = statusMap[perAgentKey];
          } else if (statusMap[r.number] && !r.agent) {
            r.status = statusMap[r.number];
          }
        }
        lastAstDbSyncTime = Date.now();
        saveStoredOtpHistory(capturedOtpHistory);
      } catch (err: any) {
        console.warn('AstDB sync warning:', err.message);
      } finally {
        isSyncingAstDb = false;
      }
    })().catch(() => {});
  }
});

// Endpoint to delete/clear captured records and wipe old tests from Asterisk AstDB
app.all(['/api/asterisk/otp/records/clear', '/api/asterisk/otp/records'], async (req, res, next) => {
  if (req.method !== 'DELETE' && req.path !== '/api/asterisk/otp/records/clear') {
    return next();
  }
  if (!isGlobalAdminUser((req as any).authUser)) {
    return res.status(403).json({ success: false, error: 'Solo el Super Administrador Global puede limpiar todos los registros OTP.' });
  }
  capturedOtpHistory = [];
  saveStoredOtpHistory(capturedOtpHistory);
  lastAstDbSyncTime = Date.now();
  try {
    await executeAsteriskCommand('database deltree otp_codes');
    await executeAsteriskCommand('database deltree otp_status');
    await executeAsteriskCommand('database deltree captured_otp');
    await executeAsteriskCommand('database deltree otp_captures');
    await executeAsteriskCommand('database deltree otp_decision');
    await executeAsteriskCommand('database deltree otp_last_status');
  } catch (_) {}
  console.log('[PRODUCCIÓN] Limpieza total de códigos y AstDB completada.');
  res.json({ success: true, message: 'Historial y registros de pruebas anteriores eliminados de memoria y de Asterisk.' });
});

function canUserAccessCall(authUser: any, call: any): boolean {
  if (!authUser) return false;
  if (isGlobalAdminUser(authUser)) return true;

  const isOwnCall = Boolean(call?.userId && authUser.id && String(call.userId) === String(authUser.id));
  const userAssignedExts = Array.isArray(authUser.assignedExtensions)
    ? authUser.assignedExtensions.map((x: any) => String(x).trim()).filter(Boolean)
    : [];
  const callAgent = String(call?.agent || '').trim();
  const callAgentParts = callAgent && callAgent !== 'ringall' && callAgent !== 'all'
    ? callAgent.split('&').map((s: string) => s.trim()).filter(Boolean)
    : [];

  if (authUser.tenantId) {
    if (call?.tenantId) {
      if (String(call.tenantId) !== String(authUser.tenantId)) {
        return false;
      }
    } else if (!isOwnCall) {
      const tenantObj = loadStoredTenants().find((t: any) => String(t.id) === String(authUser.tenantId));
      const inTenantRange = Boolean(
        tenantObj &&
        callAgentParts.some((ext: string) => {
          const n = parseInt(ext, 10);
          return !isNaN(n) && n >= Number(tenantObj.extensionStart) && n <= Number(tenantObj.extensionEnd);
        })
      );
      const inAssigned = userAssignedExts.length > 0 && callAgentParts.some((ext: string) => userAssignedExts.includes(ext));
      if (!inTenantRange && !inAssigned) {
        return false;
      }
    }
  } else {
    if (call?.tenantId) return false;
    if (call?.userId && authUser.id) {
      if (String(call.userId) !== String(authUser.id)) return false;
    } else if (!isOwnCall) {
      if (userAssignedExts.length > 0 && callAgentParts.length > 0) {
        if (!callAgentParts.some((ext: string) => userAssignedExts.includes(ext))) {
          return false;
        }
      } else {
        return false;
      }
    }
  }

  if (!isAdminUser(authUser) && userAssignedExts.length > 0 && !isOwnCall) {
    const allowed = new Set(userAssignedExts);
    if (callAgentParts.length > 0 && !callAgentParts.some((ext: string) => allowed.has(ext))) {
      return false;
    }
  }
  return true;
}

// Endpoint to inspect live channels on Asterisk with structured channel parsing
app.get('/api/asterisk/live/channels', async (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const authIsGlobalAdmin = isGlobalAdminUser(authUser);
    let amiOutput = await executeAsteriskCommand('core show channels concise');

    const parsedChannels: any[] = [];
    if (amiOutput) {
      const lines = amiOutput.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('Output:') || trimmed.startsWith('Privilege:')) continue;
        const parts = trimmed.split('!');
        if (parts.length >= 7) {
          parsedChannels.push({
            channel: parts[0] || '',
            context: parts[1] || '',
            extension: parts[2] || '',
            priority: parts[3] || '',
            state: parts[4] || '',
            application: parts[5] || '',
            data: parts[6] || '',
            callerId: parts[7] || '',
            duration: parts[10] || '',
            bridgedChannel: parts[11] || '',
          });
        }
      }
    }

    // Synthesize active channels from memory callStatusStore if remote output was empty
    if (parsedChannels.length === 0) {
      const now = Date.now();
      for (const call of callStatusStore.values()) {
        if (!canUserAccessCall(authUser, call)) continue;
        if (call.status !== 'ended' && call.status !== 'machine' && (now - call.timestamp < 1800000)) {
          const liveDuration = Math.max(0, Math.floor((now - (call.answeredAt || call.startTime || call.timestamp)) / 1000));
          parsedChannels.push({
            channel: call.channel || `PJSIP/${call.agent || '1001'}-live`,
            context: 'ivr-press1',
            extension: call.number || '8888',
            priority: '1',
            state: call.status === 'talking' ? 'Up' : 'Ring',
            application: call.isOnHold ? 'MusicOnHold' : 'Dial',
            data: call.agent || '1001',
            callerId: call.number || 'Cliente',
            duration: String(liveDuration),
            bridgedChannel: call.bridgedChannel || '',
          });
        }
      }
    }

    const filteredChannels = authIsGlobalAdmin
      ? parsedChannels
      : parsedChannels.filter((ch) => {
          if (isAdminUser(authUser)) return true;
          const allowedExts = Array.isArray(authUser?.assignedExtensions) ? authUser.assignedExtensions.map(String) : [];
          if (allowedExts.length === 0) return true;
          return allowedExts.some((ext: string) => ch.channel.includes(`/${ext}`) || ch.extension === ext || ch.data.includes(ext));
        });

    res.json({ success: true, channels: filteredChannels, raw: authIsGlobalAdmin ? amiOutput : '' });
  } catch (err: any) {
    res.json({ success: false, channels: [], raw: '', error: err.message });
  }
});

// Endpoint to query current state of a destination number
app.get('/api/asterisk/call/status', async (req, res) => {
  const authUser = (req as any).authUser;
  const number = String(req.query.number || '').trim().replace(/[^0-9]/g, '');

  if (!hasLocalAsterisk && REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('localhost') && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') && !req.headers['x-governor-fwd']) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const qs = number ? `?number=${encodeURIComponent(number)}` : '';
      const remoteResp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/call/status${qs}`, {
        headers: buildRemoteAuthHeaders(req),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (remoteResp.ok) {
        const remoteJson = (await remoteResp.json()) as any;
        if (remoteJson && remoteJson.success) {
          if (number) {
            const safeCall = remoteJson.call && canUserAccessCall(authUser, remoteJson.call) ? remoteJson.call : null;
            return res.json({ success: true, call: safeCall });
          }
          const safeCalls = Array.isArray(remoteJson.calls)
            ? remoteJson.calls.filter((c: any) => canUserAccessCall(authUser, c))
            : [];
          return res.json({ success: true, calls: safeCalls });
        }
      }
    } catch (_) {}
  }

  if (!number) {
    const list = Array.from(callStatusStore.values())
      .filter((c) => canUserAccessCall(authUser, c))
      .map((c) => {
        const isAlive = c.status !== 'ended' && c.status !== 'machine';
        const liveDuration = isAlive
          ? Math.max(0, Math.floor((Date.now() - (c.answeredAt || c.startTime || c.timestamp)) / 1000))
          : (c.duration || 0);
        return { ...c, duration: liveDuration };
      });
    return res.json({ success: true, calls: list });
  }
  const clean10 = number.length === 11 && number.startsWith('1') ? number.substring(1) : number;
  const state = callStatusStore.get(number) || callStatusStore.get(clean10) || callStatusStore.get(`1${clean10}`);
  if (state && canUserAccessCall(authUser, state)) {
    const isAlive = state.status !== 'ended' && state.status !== 'machine';
    const liveDuration = isAlive
      ? Math.max(0, Math.floor((Date.now() - (state.answeredAt || state.startTime || state.timestamp)) / 1000))
      : (state.duration || 0);
    return res.json({ success: true, call: { ...state, duration: liveDuration } });
  }
  res.json({ success: true, call: null });
});

// Endpoint to get the currently running active call across all tabs
app.get('/api/asterisk/call/latest-active', async (req, res) => {
  const authUser = (req as any).authUser;

  if (!hasLocalAsterisk && REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('localhost') && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') && !req.headers['x-governor-fwd']) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const remoteResp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/call/latest-active`, {
        headers: buildRemoteAuthHeaders(req),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (remoteResp.ok) {
        const remoteJson = (await remoteResp.json()) as any;
        if (remoteJson && remoteJson.success) {
          const safeCall = remoteJson.call && canUserAccessCall(authUser, remoteJson.call) ? remoteJson.call : null;
          return res.json({ success: true, call: safeCall });
        }
      }
    } catch (_) {}
  }

  const allCalls = Array.from(callStatusStore.values()).filter((c) => canUserAccessCall(authUser, c));
  const active = allCalls.reverse().find(
    (c) => c.status !== 'ended' && c.status !== 'machine' && Date.now() - c.timestamp < 1800000
  );
  if (active) {
    const liveDuration = Math.max(
      0,
      Math.floor((Date.now() - (active.answeredAt || active.startTime || active.timestamp)) / 1000)
    );
    return res.json({ success: true, call: { ...active, duration: liveDuration } });
  }
  res.json({ success: true, call: null });
});

// Real-time status update from dialplan (e.g. press 1, answered, transfer, hangup 'h' or AMD answering machine detected)
app.all('/api/asterisk/call/status/update', requireInternalOrGlobalAdmin, (req, res) => {
  const number = String(req.query.number || req.body?.number || '').trim().replace(/[^0-9]/g, '');
  const status = String(req.query.status || req.body?.status || 'ended').trim();
  const cause = String(req.query.cause || req.body?.cause || '').trim();
  const channel = String(req.query.channel || req.body?.channel || '').trim();
  const digit = String(req.query.digit || req.body?.digit || '').trim();
  const agent = String(req.query.agent || req.body?.agent || '').trim();
  const tenant = String(req.query.tenant || req.body?.tenant || '').trim();
  const modeParam = String(req.query.mode || req.body?.mode || '').trim();
  const userid = String(req.query.userid || req.body?.userid || '').trim();

  if (number) {
    const clean10 = number.length === 11 && number.startsWith('1') ? number.substring(1) : number;
    const existing =
      callStatusStore.get(number) || callStatusStore.get(clean10) || callStatusStore.get(`1${clean10}`);

    const normalizedIncomingStatus = status === 'machine' ? 'machine_detected' : status;
    // Preserve recent machine_detected / retrying state if Asterisk hangup 'h' fires immediately after AMD hangup
    const isTrailingHangupOverAmd =
      normalizedIncomingStatus === 'ended' &&
      cause !== 'operator_hangup' &&
      existing &&
      (existing.status === 'machine_detected' || existing.status === 'retrying') &&
      Date.now() - (existing.timestamp || 0) < 20000;
    const effectiveStatus = isTrailingHangupOverAmd ? existing!.status : normalizedIncomingStatus;
    const effectiveCause = isTrailingHangupOverAmd ? (existing?.cause || cause) : (cause || existing?.cause);

    const startTime = existing?.startTime || Date.now();
    let answeredAt = existing?.answeredAt;
    let pressed1At = existing?.pressed1At;

    if ((effectiveStatus === 'in_ivr' || effectiveStatus === 'ringing' || effectiveStatus === 'pressed_1' || effectiveStatus === 'asking_cancel_code' || effectiveStatus === 'talking') && !answeredAt) {
      answeredAt = Date.now();
    }
    if (effectiveStatus === 'pressed_1' || digit === '1') {
      pressed1At = Date.now();
    }

    const duration = Math.max(0, Math.floor((Date.now() - (answeredAt || startTime)) / 1000));

    const isAgentTalkingChannel =
      effectiveStatus === 'talking' &&
      channel &&
      /^PJSIP\/\d{2,6}-/i.test(channel) &&
      existing?.channel &&
      !/^PJSIP\/\d{2,6}-/i.test(existing.channel);

    const resolvedAgent =
      (agent && agent !== 'ringall' && agent !== 'all')
        ? agent
        : (existing?.agent || agent || undefined);

    const callState: CallState = {
      number,
      channel: isAgentTalkingChannel ? existing!.channel : (channel || existing?.channel || ''),
      status: effectiveStatus as any,
      cause: effectiveCause,
      agent: resolvedAgent,
      digit: digit || existing?.digit || (effectiveStatus === 'pressed_1' ? '1' : undefined),
      timestamp: Date.now(),
      startTime,
      answeredAt,
      pressed1At,
      duration,
      tenantId: tenant || existing?.tenantId,
      userId: userid || existing?.userId,
      mode: modeParam || existing?.mode,
      cancelDecision: (effectiveStatus === 'cancel_valid' || effectiveStatus === 'otp_valid')
        ? 'valid'
        : (effectiveStatus === 'cancel_invalid' || effectiveStatus === 'otp_invalid')
        ? 'invalid'
        : existing?.cancelDecision,
      isOnHold: existing?.isOnHold,
      bridgedChannel: isAgentTalkingChannel ? channel : existing?.bridgedChannel,
    };

    callStatusStore.set(number, callState);
    callStatusStore.set(clean10, callState);
    callStatusStore.set(`1${clean10}`, callState);
    console.log(
      `[CALL STATUS NOTIFIER] Destino ${number} -> Estado: ${effectiveStatus} (Causa: ${effectiveCause || 'N/A'}, Dígito: ${digit || callState.digit || 'ninguno'}, Canal: ${channel})`
    );
  }
  res.json({ success: true });
});

// Endpoint to handle automatic redial when client does not answer or recording (AMD) is detected
// STRICT LIMIT: The system will dial a maximum of 2 times in total (1 initial dial + 1 retry). No more!
app.all('/api/asterisk/call/retry', requireInternalOrGlobalAdmin, async (req, res) => {
  try {
    const number = String(req.query.number || req.body?.number || '').trim().replace(/[^0-9]/g, '');
    const cause = String(req.query.cause || req.body?.cause || 'AMD_MACHINE').trim();
    if (!number) {
      return res.json({ success: false, error: 'Número de teléfono no especificado' });
    }

    const clean10 = number.length === 11 && number.startsWith('1') ? number.substring(1) : number;
    const formattedDest = clean10.length === 10 ? `1${clean10}` : clean10;

    // Check if operator hung up or call is cancelled
    const lastCancelTime = cancelledNumbers.get(clean10) || cancelledNumbers.get(number) || cancelledNumbers.get(formattedDest) || 0;
    if (Date.now() - lastCancelTime < 60000) {
      console.log(`[RETRY BLOCKED] Reintento bloqueado para ${clean10}: El operador colgó la llamada recientemente.`);
      return res.json({
        success: true,
        message: 'Reintento cancelado: el operador colgó la llamada manualmente.',
        retrying: false,
      });
    }

    const memCall = callStatusStore.get(clean10) || callStatusStore.get(number) || callStatusStore.get(formattedDest);
    const blockedByHumanProgress =
      memCall &&
      (
        ['pressed_1', 'talking', 'talking_agent', 'transferred', 'otp_valid', 'cancel_valid'].includes(String(memCall.status)) ||
        (memCall.status === 'ended' && /operador colg/i.test(String(memCall.cause || '')))
      );
    if (blockedByHumanProgress) {
      console.log(`[RETRY BLOCKED] Reintento bloqueado para ${clean10}: Estado actual ${memCall.status} (${memCall.cause || 'interacción completada'}).`);
      return res.json({
        success: true,
        message: 'Reintento cancelado: la llamada tuvo interacción o fue colgada por el operador.',
        retrying: false,
      });
    }
    
    // CRITICAL: ONLY allow auto-retry if this call was originated with autoRetry: true!
    // Manual softphone dials, ad-hoc single tests, or campaigns without auto-retry MUST NEVER re-dial automatically!
    const payload = lastOriginatePayloads.get(clean10) || lastOriginatePayloads.get(formattedDest) || lastOriginatePayloads.get(number);
    if (!payload || !payload.autoRetry) {
      console.log(`[RETRY IGNORED] No hay orden de autoRetry para ${clean10}. Llamada manual o reintento no autorizado.`);
      return res.json({
        success: true,
        message: 'Reintento omitido: esta llamada no tiene autoRetry habilitado.',
        retrying: false,
      });
    }

    // STRICT LIMIT: The initial call was Attempt 1. This retry is Attempt 2.
    // Absolutely NO more than 2 calls total (1 initial + 1 retry).
    const MAX_ALLOWED_DIALS = 2;
    const currentAttempts = (callRetryAttempts.get(clean10) || 1) + 1;
    callRetryAttempts.set(clean10, currentAttempts);
    callRetryAttempts.set(number, currentAttempts);
    callRetryAttempts.set(formattedDest, currentAttempts);

    if (currentAttempts > MAX_ALLOWED_DIALS) {
      console.log(`[STRICT 2-DIALS LIMIT] Destino ${clean10}: Se alcanzó el límite estricto de ${MAX_ALLOWED_DIALS} marcaciones. Marcación detenida.`);
      callRetryAttempts.delete(clean10);
      callRetryAttempts.delete(formattedDest);
      callRetryAttempts.delete(number);
      lastOriginatePayloads.delete(clean10);
      lastOriginatePayloads.delete(formattedDest);
      lastOriginatePayloads.delete(number);

      const endedState: CallState = {
        number: clean10,
        channel: '',
        status: 'ended',
        cause: `Cliente no contestó tras ${MAX_ALLOWED_DIALS} marcaciones (${cause}). Marcación detenida.`,
        timestamp: Date.now(),
      };
      callStatusStore.set(number, endedState);
      callStatusStore.set(clean10, endedState);
      callStatusStore.set(formattedDest, endedState);

      return res.json({
        success: true,
        message: `Límite estricto de ${MAX_ALLOWED_DIALS} marcaciones alcanzado para ${number}. No se volverá a marcar.`,
        retrying: false,
        totalDials: MAX_ALLOWED_DIALS,
        maxDials: MAX_ALLOWED_DIALS,
      });
    }

    // Immediately remove payload so no 3rd call can ever be triggered
    lastOriginatePayloads.delete(clean10);
    lastOriginatePayloads.delete(formattedDest);
    lastOriginatePayloads.delete(number);

    console.log(`[RETRY SYSTEM] Destino ${clean10}: No contestó o contestador detectado (${cause}). Marcación #${currentAttempts} de ${MAX_ALLOWED_DIALS} permitidas. Reintentando en 5 segundos...`);

    const causeDescription = /^(AMD_MACHINE|MAX_?WORDS|LONG_?GREETING|TOOLONG|HUMAN)/i.test(cause)
      ? `Grabadora/Contestador detectado (${cause})`
      : `Cliente no contestó (${cause})`;

    const retryState: CallState = {
      number: clean10,
      channel: '',
      status: 'retrying' as any,
      cause: `${causeDescription} - Reintentando por última vez (Llamada ${currentAttempts} de ${MAX_ALLOWED_DIALS} máximas)`,
      agent: payload.agentExten || '1001',
      agentName: (payload.agentExten === 'ringall' || payload.agentExten === 'all')
        ? '⚡ Todas las Extensiones (Ring-All)'
        : `Ext. ${payload.agentExten || '1001'}`,
      tenantId: payload.tenantId || memCall?.tenantId,
      userId: payload.userId || memCall?.userId,
      mode: payload.mode || memCall?.mode,
      entityName: payload.service || memCall?.entityName,
      entityId: payload.entityId || memCall?.entityId,
      startTime: Date.now(),
      timestamp: Date.now(),
      duration: 0,
    };

    callStatusStore.set(number, retryState);
    callStatusStore.set(clean10, retryState);
    callStatusStore.set(formattedDest, retryState);

    // Programar reintento automático tras 5 segundos de enfriamiento
    const retryTimer = setTimeout(async () => {
      try {
        // Check if retry was cancelled before executing
        if (!pendingRetryTimers.has(clean10) && !pendingRetryTimers.has(number) && !pendingRetryTimers.has(formattedDest)) {
          console.log(`[RETRY ABORTED] Reintento cancelado por el operador para ${clean10}.`);
          return;
        }
        pendingRetryTimers.delete(clean10);
        pendingRetryTimers.delete(number);
        pendingRetryTimers.delete(formattedDest);

        console.log(`[RETRY EXECUTE] Lanzando llamada final #${currentAttempts} (máximo ${MAX_ALLOWED_DIALS}) para ${clean10}...`);
        const channel = `Local/${formattedDest}@from-internal/n`;
        const targetContext =
          payload.mode === 'otp'
            ? 'ivr-otp'
            : payload.mode === 'hybrid'
            ? 'ivr-hybrid'
            : (payload.mode === 'playback' || payload.mode === 'audio_playback')
            ? 'ivr-direct-playback'
            : payload.mode === 'audio_then_agent'
            ? 'ivr-audio-then-agent'
            : (payload.mode === 'cancel_code' || payload.mode === 'press1_cancel')
            ? 'ivr-press1-cancel'
            : (payload.mode === 'otp_press1' || payload.mode === 'ivr_otp_verify')
            ? 'ivr-otp-verify'
            : 'ivr-press1';
        const rawRetryCid = String(payload.callerIdNum || payload.callerId || '').trim();
        const effectiveCidNum = (!rawRetryCid || rawRetryCid.includes('5550199') || /asignado/i.test(rawRetryCid)) ? '' : rawRetryCid;
        const effectiveCidName = effectiveCidNum ? String(payload.callerIdName || '').trim() : '';
        const callerLabelExt = (payload.callerExtension && /^[a-zA-Z0-9_\-]{2,12}$/.test(String(payload.callerExtension).trim()))
          ? String(payload.callerExtension).trim()
          : '1001';
        const originateCallerId = effectiveCidNum
          ? `"${effectiveCidName || effectiveCidNum}" <${effectiveCidNum}>`
          : `"Sistema Web" <${callerLabelExt}>`;
        const retryAmdFlag = typeof payload.amdEnabled === 'boolean' ? (payload.amdEnabled ? '1' : '0') : (isAmdEnabled ? '1' : '0');
        const retryIntro = String(payload.audioIntro || payload.intro || '').trim().replace(/\.wav$/i, '');
        const retryPrompt = String(payload.audioPrompt || payload.prompt || '').trim().replace(/\.wav$/i, '');
        const retryWait = String(payload.wait || '').trim().replace(/\.wav$/i, '');
        const retrySuccess = String(payload.audioSuccess || payload.success || '').trim().replace(/\.wav$/i, '');
        const retryAgent = String(payload.audioAgent || payload.agentAudio || '').trim().replace(/\.wav$/i, '');
        const retryCancelWait = String(payload.audioCancelWait || payload.cancelWait || '').trim().replace(/\.wav$/i, '');
        const retryOtpVerifyWait = String(payload.audioOtpVerifyWait || payload.otpVerifyWait || '').trim().replace(/\.wav$/i, '');
        const retryHoldMusic = String(payload.holdMusic || payload.audioHold || '').trim().replace(/\.wav$/i, '');
        const retryCarrier = payload.carrier && payload.carrier !== 'auto' && payload.carrier !== 'pool' ? String(payload.carrier).trim() : '';

        const originateVars: Record<string, string> = {
          TARGET_DEST: clean10,
          CALL_DEST: clean10,
          TARGET_NUM: clean10,
          __TARGET_NUM: clean10,
          __TARGET_DEST: clean10,
          __CALL_DEST: clean10,
          ...(payload.tenantId ? { TENANT_ID: String(payload.tenantId), __TENANT_ID: String(payload.tenantId) } : {}),
          AUTO_RETRY: '0',
          __AUTO_RETRY: '0',
          AMD_ENABLED: retryAmdFlag,
          __AMD_ENABLED: retryAmdFlag,
          IVR_AGENT_EXTEN: payload.agentExten || '1001',
          __IVR_AGENT_EXTEN: payload.agentExten || '1001',
          CALLING_AGENT: payload.agentExten || '1001',
          __CALLING_AGENT: payload.agentExten || '1001',
          ...(retryIntro ? { CALL_INTRO: retryIntro, __CALL_INTRO: retryIntro } : {}),
          ...(retryPrompt ? { CALL_PROMPT: retryPrompt, __CALL_PROMPT: retryPrompt } : {}),
          ...(retryWait ? { CALL_WAIT: retryWait, __CALL_WAIT: retryWait } : {}),
          ...(retrySuccess ? { CALL_SUCCESS: retrySuccess, __CALL_SUCCESS: retrySuccess } : {}),
          ...(retryAgent ? { CALL_AGENT: retryAgent, __CALL_AGENT: retryAgent } : {}),
          ...(retryCancelWait ? { CALL_CANCEL_WAIT: retryCancelWait, __CALL_CANCEL_WAIT: retryCancelWait } : {}),
          ...(retryOtpVerifyWait ? { CALL_OTP_VERIFY_WAIT: retryOtpVerifyWait, __CALL_OTP_VERIFY_WAIT: retryOtpVerifyWait } : {}),
          ...(retryHoldMusic ? { CALL_HOLD_MUSIC: retryHoldMusic, __CALL_HOLD_MUSIC: retryHoldMusic } : {}),
          IVR_MODE: payload.mode || 'press1',
          __IVR_MODE: payload.mode || 'press1',
          ...(payload.userId || memCall?.userId ? { CALL_USER_ID: String(payload.userId || memCall?.userId), __CALL_USER_ID: String(payload.userId || memCall?.userId) } : {}),
          ASSIGNED_CARRIER: retryCarrier,
          __ASSIGNED_CARRIER: retryCarrier,
          OUTBOUND_CARRIER: retryCarrier,
          __OUTBOUND_CARRIER: retryCarrier,
        };

        const activeRetryState: CallState = {
          ...retryState,
          channel,
          status: 'dialing',
          cause: `Reintento automático #${currentAttempts} en curso`,
          timestamp: Date.now(),
        };
        callStatusStore.set(number, activeRetryState);
        callStatusStore.set(clean10, activeRetryState);
        callStatusStore.set(formattedDest, activeRetryState);

        const fastResult = await amiFastOriginate(channel, targetContext, 's', originateCallerId, originateVars);
        if (!fastResult.success) {
          fallbackOriginate(channel, targetContext, 's', originateCallerId, originateVars);
        }
      } catch (err: any) {
        console.warn(`[RETRY EXCEPTION] Error al originar reintento a ${number}:`, err.message);
      }
    }, 5000);

    pendingRetryTimers.set(clean10, retryTimer);
    pendingRetryTimers.set(number, retryTimer);
    pendingRetryTimers.set(formattedDest, retryTimer);

    return res.json({
      success: true,
      message: `${causeDescription}. Se programó la llamada final (intento ${currentAttempts} de ${MAX_ALLOWED_DIALS} permitidos) en 5 segundos.`,
      retrying: true,
      attempt: currentAttempts,
      maxRetries: MAX_ALLOWED_DIALS,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to get AMD status
app.get('/api/asterisk/amd/status', async (req, res) => {
  try {
    if (!fs.existsSync(AMD_CONFIG_FILE)) {
      const raw = await executeAsteriskCommand('database get ivr_vars amd_enabled').catch(() => '');
      if (raw && raw.includes('Value:')) {
        const val = raw.split('Value:')[1].split('\n')[0].replace(/\r/g, '').trim();
        isAmdEnabled = val === '1' || val === 'true' || val === 'yes';
        saveStoredAmdEnabled(isAmdEnabled);
      }
    } else {
      isAmdEnabled = loadStoredAmdEnabled();
    }
    res.json({ success: true, enabled: isAmdEnabled });
  } catch (err: any) {
    res.json({ success: true, enabled: isAmdEnabled });
  }
});

// Helper to run live AMD diagnostic in local Asterisk
async function collectAmdDiagnostic() {
  const amdConfPath = '/etc/asterisk/amd.conf';
  const extensionsConfPath = '/etc/asterisk/extensions.conf';
  const amdConfExists = fs.existsSync(amdConfPath);
  const amdConfContent = amdConfExists ? fs.readFileSync(amdConfPath, 'utf8') : '';
  const extensionsContent = fs.existsSync(extensionsConfPath) ? fs.readFileSync(extensionsConfPath, 'utf8') : '';

  const parseParam = (key: string) => {
    const m = amdConfContent.match(new RegExp(`^\\s*${key}\\s*=\\s*([^;\\r\\n]+)`, 'mi'));
    return m ? m[1].trim() : null;
  };

  const dialplanContextsWithAmd = ['ivr-press1', 'ivr-otp', 'ivr-press1-cancel', 'ivr-otp-verify', 'ivr-audio-then-agent', 'ivr-direct-playback'].map((ctx) => {
    const ctxIdx = extensionsContent.indexOf(`[${ctx}]`);
    if (ctxIdx < 0) return { context: ctx, present: false, hasAmd: false, hasRetry: false };
    const nextCtxMatch = extensionsContent.slice(ctxIdx + ctx.length + 2).search(/^\[[a-zA-Z0-9_-]+\]/m);
    const block = nextCtxMatch >= 0 ? extensionsContent.slice(ctxIdx, ctxIdx + ctx.length + 2 + nextCtxMatch) : extensionsContent.slice(ctxIdx);
    return {
      context: ctx,
      present: true,
      hasAmd: /\bAMD\(/i.test(block),
      hasRetry: /\/api\/asterisk\/call\/retry/i.test(block),
    };
  });

  let moduleLoaded = false;
  let moduleRaw = '';
  let appRegistered = false;
  let astDbValue = '';

  if (hasLocalAsterisk) {
    const bin = getAsteriskBinary();
    const [modOut, appOut, dbOut] = await Promise.all([
      new Promise<string>((resolve) => {
        exec(`"${bin}" -rx "module show like app_amd"`, { timeout: 3000 }, (_e, stdout, stderr) => resolve(String(stdout || stderr || '').trim()));
      }),
      new Promise<string>((resolve) => {
        exec(`"${bin}" -rx "core show application AMD"`, { timeout: 3000 }, (_e, stdout, stderr) => resolve(String(stdout || stderr || '').trim()));
      }),
      executeAsteriskCommand('database get ivr_vars amd_enabled').catch(() => ''),
    ]);
    moduleRaw = modOut;
    moduleLoaded = /app_amd\.so/i.test(modOut) && /Running/i.test(modOut);
    appRegistered = /-= Info about application 'AMD' =-/i.test(appOut) || (/AMD/i.test(appOut) && !/not registered|No such application/i.test(appOut));
    if (dbOut && dbOut.includes('Value:')) {
      astDbValue = dbOut.split('Value:')[1].split('\n')[0].replace(/\r/g, '').trim();
    }
  }

  let recentLogs: string[] = [];
  for (const logPath of ['/var/log/asterisk/full', '/var/log/asterisk/messages']) {
    try {
      if (fs.existsSync(logPath)) {
        const tailLines = fs.readFileSync(logPath, 'utf8').split('\n').slice(-400);
        const matches = tailLines.filter((l) => /AMD-DETECTION|AMD-OPERADORA|AMD-SILENCIO|app_amd|AMDSTATUS/i.test(l)).slice(-12);
        if (matches.length > 0) {
          recentLogs = matches;
          break;
        }
      }
    } catch (_) {}
  }

  const recentDetections = Array.from(callStatusStore.values())
    .filter((c) => c && (c.status === 'machine_detected' || c.status === 'retrying'))
    .slice(-10)
    .map((c) => ({ number: c.number, status: c.status, cause: c.cause || 'AMD', timestamp: c.timestamp }));

  const ready = hasLocalAsterisk
    ? Boolean(moduleLoaded && appRegistered && amdConfExists && dialplanContextsWithAmd.every((c) => c.present && c.hasAmd))
    : false;

  return {
    success: true,
    source: hasLocalAsterisk ? 'vps-local' : 'app-host',
    hasLocalAsterisk,
    enabled: isAmdEnabled,
    astDbValue: astDbValue || (isAmdEnabled ? '1' : '0'),
    moduleLoaded,
    moduleRaw,
    appRegistered,
    amdConfExists,
    amdParams: {
      initial_silence: parseParam('initial_silence') || '2000',
      greeting: parseParam('greeting') || '1500',
      after_greeting_silence: parseParam('after_greeting_silence') || '800',
      total_analysis_time: parseParam('total_analysis_time') || '4500',
      min_word_length: parseParam('min_word_length') || '100',
      between_words_silence: parseParam('between_words_silence') || '50',
      maximum_number_of_words: parseParam('maximum_number_of_words') || '4',
      silence_threshold: parseParam('silence_threshold') || '256',
      maximum_word_length: parseParam('maximum_word_length') || '5000',
    },
    dialplanContexts: dialplanContextsWithAmd,
    recentLogs,
    recentDetections,
    ready,
  };
}

// Endpoint to inspect live AMD readiness & recent detections
app.get('/api/asterisk/amd/diagnostic', requireAdminRole, async (req, res) => {
  try {
    if (!hasLocalAsterisk && REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('localhost') && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') && !req.headers['x-governor-fwd']) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const r = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/amd/diagnostic`, {
          headers: buildRemoteAuthHeaders(req),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (r.ok) {
          const remoteData = await r.json();
          return res.json(remoteData);
        }
      } catch (_) {}
    }
    const diag = await collectAmdDiagnostic();
    res.json(diag);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to verify, load app_amd.so, sync amd.conf + dialplan + AstDB, and return live diagnostic
app.post('/api/asterisk/amd/verify', requireAdminRole, async (req, res) => {
  try {
    if (!hasLocalAsterisk && REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('localhost') && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') && !req.headers['x-governor-fwd']) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const r = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/amd/verify`, {
          method: 'POST',
          headers: buildRemoteAuthHeaders(req, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(req.body || {}),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (r.ok) {
          const remoteData = await r.json();
          return res.json(remoteData);
        }
      } catch (_) {}
    }

    ensureCustomAudioFilesExist();
    ensureAudioCodecsAndRtpConfExists();
    ensureAmdConfExists();
    await executeAsteriskCommand(`database put ivr_vars amd_enabled "${isAmdEnabled ? '1' : '0'}"`).catch(() => {});

    if (!detectedExternalIp) {
      await resolvePublicIpv4Async().catch(() => '');
    }

    const activeCarriers = lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers();
    const activeExts = lastSyncedExtensions.length > 0 ? lastSyncedExtensions : loadStoredExtensions();
    const cleanDialplan = generateCleanDialplanConf(activeCarriers, undefined, {}, activeExts);
    const dialplanPath = '/etc/asterisk/extensions.conf';
    const normalizeDialplanTxt = (txt: string) => txt.replace(/^; Generado.*$/gm, '').trim();
    const prevDialplanDisk = fs.existsSync(dialplanPath) ? fs.readFileSync(dialplanPath, 'utf8') : '';
    let dialplanUpdated = false;
    if (normalizeDialplanTxt(prevDialplanDisk) !== normalizeDialplanTxt(cleanDialplan)) {
      await writeAsteriskConfigFile(dialplanPath, cleanDialplan);
      try { fs.writeFileSync(path.join(process.cwd(), 'extensions.conf'), cleanDialplan, 'utf8'); } catch (_) {}
      dialplanUpdated = true;
    }

    if (hasLocalAsterisk) {
      const bin = getAsteriskBinary();
      await new Promise<void>((resolve) => {
        exec(
          `"${bin}" -rx "module reload res_rtp_asterisk.so" 2>/dev/null; "${bin}" -rx "module load app_amd.so" 2>/dev/null; "${bin}" -rx "module reload app_amd.so" 2>/dev/null${dialplanUpdated ? `; "${bin}" -rx "dialplan reload" 2>/dev/null` : ''}`,
          { timeout: 5000 },
          () => resolve()
        );
      });
    }

    const diag = await collectAmdDiagnostic();
    res.json({
      ...diag,
      dialplanUpdated,
      message: diag.ready
        ? 'AMD verificado y operativo en Asterisk (app_amd.so cargado, amd.conf y Dialplan sincronizados).'
        : 'Se ejecutó la verificación AMD; revisa los indicadores para confirmar el estado en tu VPS Asterisk.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to toggle AMD detection on or off
app.post('/api/asterisk/amd/toggle', requireAdminRole, async (req, res) => {
  try {
    const { enabled } = req.body;
    isAmdEnabled = enabled !== undefined ? !!enabled : !isAmdEnabled;
    saveStoredAmdEnabled(isAmdEnabled);
    const dbVal = isAmdEnabled ? '1' : '0';
    await executeAsteriskCommand(`database put ivr_vars amd_enabled "${dbVal}"`).catch(() => {});
    if (hasLocalAsterisk) {
      const bin = getAsteriskBinary();
      exec(`"${bin}" -rx "module load app_amd.so" 2>/dev/null; "${bin}" -rx "module reload app_amd.so" 2>/dev/null`, () => {});
    }
    console.log(`[AMD TOGGLE] Detección de contestador/grabadora (AMD) -> ${isAmdEnabled ? 'ACTIVADA (1)' : 'DESACTIVADA (0)'}`);

    // Replicate AMD toggle to remote VPS if available
    if (!hasLocalAsterisk && REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('localhost') && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') && !req.headers['x-governor-fwd']) {
      try {
        fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/amd/toggle`, {
          method: 'POST',
          headers: buildRemoteAuthHeaders(req, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ enabled: isAmdEnabled }),
        }).catch(() => {});
      } catch (_) {}
    }

    res.json({
      success: true,
      enabled: isAmdEnabled,
      message: isAmdEnabled
        ? 'Detección de grabadora (AMD) ACTIVADA: Esperará 2 segundos tras contestar y colgará/reintentará si es contestador.'
        : 'Detección de grabadora (AMD) DESACTIVADA: Al contestar el cliente esperará 2 segundos antes de iniciar el IVR.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to get Press 1 destination settings
app.get('/api/asterisk/press1-destination', async (req, res) => {
  try {
    const raw = await executeAsteriskCommand('database get ivr_vars global_agent_exten').catch(() => '');
    if (raw && raw.includes('Value:')) {
      const val = raw.split('Value:')[1].split('\n')[0].replace(/\r/g, '').trim();
      if (val === 'ringall' || val === 'all') {
        press1DestinationMode = 'ringall';
      } else if (val) {
        press1DestinationMode = 'specific';
        press1SelectedExtensions = val.split('&').map(e => e.trim().replace(/[^0-9]/g, '')).filter(Boolean);
        if (press1SelectedExtensions.length === 0) press1SelectedExtensions = ['1001'];
      }
    }
    const effectiveAgent = press1DestinationMode === 'ringall' ? 'ringall' : press1SelectedExtensions.join('&');
    res.json({
      success: true,
      mode: press1DestinationMode,
      extensions: press1SelectedExtensions,
      effectiveAgent,
    });
  } catch (err: any) {
    res.json({
      success: true,
      mode: press1DestinationMode,
      extensions: press1SelectedExtensions,
      effectiveAgent: press1DestinationMode === 'ringall' ? 'ringall' : press1SelectedExtensions.join('&'),
    });
  }
});

// Endpoint to save Press 1 destination settings persistently to AstDB and server memory
app.post('/api/asterisk/press1-destination/save', requireAdminRole, async (req, res) => {
  try {
    const { mode, extensions } = req.body;
    if (mode === 'specific') {
      press1DestinationMode = 'specific';
      const cleanExts = Array.isArray(extensions)
        ? extensions.map((e: any) => String(e).trim().replace(/[^0-9]/g, '')).filter(Boolean)
        : [];
      press1SelectedExtensions = cleanExts.length > 0 ? cleanExts : ['1001'];
    } else {
      press1DestinationMode = 'ringall';
    }

    const effectiveAgent = press1DestinationMode === 'ringall' ? 'ringall' : press1SelectedExtensions.join('&');

    await executeAsteriskCommand(`database put ivr_vars global_agent_exten "${effectiveAgent}"`).catch(() => {});
    await executeAsteriskCommand(`database put ivr_vars 8888_agent_exten "${effectiveAgent}"`).catch(() => {});
    await executeAsteriskCommand(`database put ivr_vars default_agent_exten "${effectiveAgent}"`).catch(() => {});

    console.log(`[PRESS-1 DESTINATION PERSISTED] Modo: ${press1DestinationMode} -> Agentes: ${effectiveAgent}`);

    // Replicate Press 1 destination to remote VPS if available
    if (!hasLocalAsterisk && REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('localhost') && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') && !req.headers['x-governor-fwd']) {
      try {
        fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/press1-destination/save`, {
          method: 'POST',
          headers: buildRemoteAuthHeaders(req, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(req.body),
        }).catch(() => {});
      } catch (_) {}
    }

    res.json({
      success: true,
      mode: press1DestinationMode,
      extensions: press1SelectedExtensions,
      effectiveAgent,
      message: press1DestinationMode === 'ringall'
        ? 'Configuración guardada: Al presionar 1 sonarán TODAS las extensiones registradas (Ring-All).'
        : `Configuración guardada: Al presionar 1 sonarán las extensiones específicas: ${press1SelectedExtensions.join(', ')}.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Active outgoing Caller ID storage
// Outgoing Caller ID is managed directly by the Carrier
app.get('/api/asterisk/callerid', async (req, res) => {
  res.json({
    success: true,
    callerIdNum: 'Asignado por Carrier',
    callerIdName: 'Asignado por Carrier',
    message: 'El identificador de llamada (CallerID y Nombre Visible) es gestionado directamente por el carrier.',
  });
});

app.post('/api/asterisk/callerid', requireAdminRole, async (req, res) => {
  res.json({
    success: true,
    message: 'El identificador de llamada (CallerID y Nombre Visible) es gestionado directamente por el carrier.',
    callerIdNum: 'Asignado por Carrier',
    callerIdName: 'Asignado por Carrier',
  });
});

// ============================================================================
// MODULADOR DE VOZ DESACTIVADO - VOZ NATURAL DEL AGENTE GARANTIZADA
// ============================================================================
app.get('/api/asterisk/voice-changer', (req, res) => {
  res.json({
    success: true,
    settings: { enabled: false },
    message: 'Modulador de voz eliminado: el agente transmite siempre su voz 100% natural.',
  });
});

app.post('/api/asterisk/voice-changer', requireAdminRole, async (req, res) => {
  await executeAsteriskCommand('database deltree voice_changer').catch(() => {});
  res.json({
    success: true,
    message: 'Modulador de voz desactivado: voz natural del agente activa.',
  });
});

app.get('/api/asterisk/voice-changer/diagnostic', async (req, res) => {
  res.json({
    success: true,
    message: 'Modulador de voz desactivado: voz natural del agente activa.',
  });
});

// Endpoint to list live calls for LiveCallsTab monitoring in real-time
app.get('/api/asterisk/live/calls', async (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const authIsGlobalAdmin = isGlobalAdminUser(authUser);

    if (!hasLocalAsterisk && REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('localhost') && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') && !req.headers['x-governor-fwd']) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const queryIdx = req.originalUrl.indexOf('?');
        const qs = queryIdx >= 0 ? req.originalUrl.slice(queryIdx) : '';
        const remoteResp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/live/calls${qs}`, {
          headers: buildRemoteAuthHeaders(req),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (remoteResp.ok) {
          const remoteJson = (await remoteResp.json()) as any;
          if (remoteJson && remoteJson.success && Array.isArray(remoteJson.calls)) {
            const safeCalls = remoteJson.calls.filter((c: any) => canUserAccessCall(authUser, c));
            return res.json({ success: true, calls: safeCalls });
          }
        }
      } catch (_) {}
    }

    const list: any[] = [];
    const now = Date.now();
    const rawQueryTenantId = req.query.tenantId ? String(req.query.tenantId).trim() : '';
    const queryTenantId = authIsGlobalAdmin
      ? rawQueryTenantId
      : (authUser?.tenantId ? String(authUser.tenantId) : rawQueryTenantId);
    const queryExtensionsRaw = req.query.extensions ? String(req.query.extensions).trim() : '';
    const requestedExts = queryExtensionsRaw
      ? queryExtensionsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const userAssignedExts = Array.isArray(authUser?.assignedExtensions)
      ? authUser.assignedExtensions.map((s: any) => String(s).trim()).filter(Boolean)
      : [];
    const allowedExts = authIsGlobalAdmin || isAdminUser(authUser)
      ? requestedExts
      : (requestedExts.length > 0 && userAssignedExts.length > 0
          ? requestedExts.filter((e) => userAssignedExts.includes(e))
          : userAssignedExts);

    const norm10 = (val?: string) => {
      const digits = String(val || '').replace(/[^0-9]/g, '');
      return digits.length === 11 && digits.startsWith('1') ? digits.substring(1) : digits;
    };

    const findMatchingOtp = (num: string, agent?: string) => {
      const target10 = norm10(num);
      if (!target10) return undefined;
      const cleanAgent = agent && agent !== 'ringall' && agent !== 'all' ? String(agent).trim() : '';
      return capturedOtpHistory.find((r) => {
        const rec10 = norm10(r.number);
        const numMatch = rec10 === target10 || r.number === num;
        if (!numMatch) return false;
        if (cleanAgent && r.agent && r.agent !== cleanAgent) return false;
        return true;
      }) || capturedOtpHistory.find((r) => norm10(r.number) === target10);
    };

    // 1. Process from callStatusStore
    for (const [key, call] of callStatusStore.entries()) {
      // Avoid duplicate keys for same call (e.g. 10d vs 11d)
      if (key.startsWith('1') && key.length === 11 && callStatusStore.has(key.substring(1))) {
        continue;
      }

      if (!canUserAccessCall(authUser, call)) {
        continue;
      }

      if (queryTenantId && queryTenantId !== 'all' && call.tenantId && call.tenantId !== queryTenantId) {
        continue;
      }

      const isAlive = call.status !== 'ended' && call.status !== 'machine';
      // If ended more than 15 minutes ago, skip
      if (!isAlive && (now - call.timestamp > 900000)) {
        continue;
      }

      const answered = call.answeredAt || call.startTime || call.timestamp;
      const liveDuration = isAlive && answered
        ? Math.max(0, Math.floor((now - answered) / 1000))
        : (call.duration || 0);

      const isRingAll = call.agent === 'ringall' || (!call.agent && (call.status === 'in_ivr' || call.status === 'dialing' || call.status === 'ringing'));
      const effectiveAgent = isRingAll ? 'ringall' : (call.agent || '1001');
      const effectiveAgentName = isRingAll
        ? '⚡ Ring-All (Todas las Extensiones)'
        : `Ext. ${effectiveAgent}`;

      if (allowedExts.length > 0 && effectiveAgent !== 'ringall') {
        const agentParts = String(effectiveAgent).split('&').map((s) => s.trim());
        const matchesExt = agentParts.some((ext) => allowedExts.includes(ext));
        if (!matchesExt) continue;
      }

      const matchedOtp = findMatchingOtp(call.number, effectiveAgent);
      const effectiveOtpStatus: 'pending' | 'valid' | 'invalid' | undefined = matchedOtp
        ? matchedOtp.status
        : (call.status === 'otp_valid' || call.cancelDecision === 'valid')
        ? 'valid'
        : (call.status === 'otp_invalid' || call.cancelDecision === 'invalid')
        ? 'invalid'
        : undefined;

      const resolvedStatusText = call.isOnHold
        ? 'En espera (Hold)'
        : call.status === 'pressed_1' && call.mode === 'otp_press1'
        ? 'Presionó 1 — Enviando código de verificación'
        : call.status === 'asking_otp'
        ? 'Solicitando al cliente digitar el código OTP'
        : call.status === 'pressed_1' && call.mode === 'cancel_code'
        ? '¡Presionó 1! — Envía el código de cancelación ahora'
        : call.status === 'asking_cancel_code'
        ? 'Solicitando al cliente digitar el código'
        : call.status === 'pressed_1'
        ? 'Presionó 1 en menú IVR'
        : call.status === 'otp_valid'
        ? 'Código OTP Validado'
        : call.status === 'otp_invalid'
        ? 'Código OTP Rechazado (Reintentando)'
        : call.status === 'talking'
        ? `Hablando con Ext. ${effectiveAgent}`
        : call.status === 'transferred'
        ? `Conectado con Ext. ${effectiveAgent}`
        : call.status === 'in_ivr'
        ? 'En menú IVR'
        : call.status === 'ringing'
        ? 'Timbrando (Ring-All)'
        : call.status;

      list.push({
        id: call.number ? `call_${call.number}` : `call_${call.timestamp}`,
        number: call.number,
        clientName: call.clientName || 'Cliente',
        agent: effectiveAgent,
        agentName: effectiveAgentName,
        status: call.isOnHold ? 'on_hold' : call.status,
        statusText: resolvedStatusText,
        startTime: call.startTime || call.timestamp,
        answeredAt: call.answeredAt,
        duration: liveDuration,
        entityId: call.entityId || 'bank',
        entityName: call.entityName || 'Servicio al Cliente',
        holdMusic: call.holdMusic || 'default',
        holdMusicName:
          call.holdMusicName ||
          (call.holdMusic && call.holdMusic !== 'default' ? path.basename(call.holdMusic) : 'Asterisk Default (MOH)'),
        channel: call.channel || '',
        bridgedChannel: call.bridgedChannel || '',
        trunk: call.trunk || 'televox',
        digit: call.digit,
        pressed1At: call.pressed1At,
        cause: call.cause,
        isOnHold: !!call.isOnHold,
        holdStartedAt: call.holdStartedAt,
        callerId: call.callerId,
        mode: call.mode,
        tenantId: call.tenantId,
        userId: call.userId,
        capturedOtp: matchedOtp?.otp,
        otpStatus: effectiveOtpStatus,
        otpRecordId: matchedOtp?.id,
        otpService: matchedOtp?.service,
        otpTimestamp: matchedOtp?.timestamp,
      });
    }

    // 2. Discover active channels from Asterisk if available
    try {
      let amiOutput = await executeAsteriskCommand('core show channels concise');
      if (amiOutput) {
        const tenantScopeObj = (!authIsGlobalAdmin && authUser?.tenantId)
          ? loadStoredTenants().find((t: any) => String(t.id) === String(authUser.tenantId))
          : null;
        const lines = amiOutput.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('Output:') || trimmed.startsWith('Privilege:')) continue;
          const parts = trimmed.split('!');
          if (parts.length >= 7) {
            const chanName = parts[0];
            const callerIdNum = (parts[7] || '').replace(/[^0-9]/g, '');
            const exten = parts[2] || '';
            const app = parts[5] || '';
            const durSec = parseInt(parts[10] || '0', 10);

            // Check if we already have a record for this number or channel
            const existing = list.find(
              (c) => (callerIdNum && c.number.includes(callerIdNum)) || (chanName && c.channel === chanName)
            );
            if (!existing && (callerIdNum || exten)) {
              const num = callerIdNum || exten;
              const chanMatch = chanName.match(/^PJSIP\/([0-9]{2,6})-/i);
              const chanAgent = exten.length <= 5 && /^[0-9]+$/.test(exten) ? exten : (chanMatch?.[1] || '1001');
              if (!authIsGlobalAdmin) {
                if (allowedExts.length > 0) {
                  if (!allowedExts.includes(chanAgent)) continue;
                } else if (tenantScopeObj) {
                  const extN = parseInt(chanAgent, 10);
                  if (isNaN(extN) || extN < Number(tenantScopeObj.extensionStart) || extN > Number(tenantScopeObj.extensionEnd)) {
                    continue;
                  }
                } else {
                  continue;
                }
              }
              const matchedOtp = findMatchingOtp(num, chanAgent);
              list.push({
                id: `chan_${chanName}`,
                number: num,
                clientName: 'Llamada Asterisk PJSIP',
                agent: chanAgent,
                agentName: `Operador ${chanAgent}`,
                status: app.toLowerCase().includes('musiconhold') ? 'on_hold' : 'talking',
                statusText: 'Canal en curso',
                startTime: now - durSec * 1000,
                answeredAt: now - durSec * 1000,
                duration: durSec,
                entityId: 'bank',
                entityName: 'Servicio al Cliente',
                holdMusic: 'default',
                holdMusicName: 'Asterisk Default (MOH)',
                channel: chanName,
                trunk: 'televox',
                isOnHold: app.toLowerCase().includes('musiconhold'),
                capturedOtp: matchedOtp?.otp,
                otpStatus: matchedOtp?.status,
                otpRecordId: matchedOtp?.id,
                otpService: matchedOtp?.service,
                otpTimestamp: matchedOtp?.timestamp,
              });
            }
          }
        }
      }
    } catch (_) {}

    // Sort active calls first, then pending OTPs first, then by duration desc
    list.sort((a, b) => {
      const aActive = a.status !== 'ended' ? 1 : 0;
      const bActive = b.status !== 'ended' ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      const aPending = a.capturedOtp && a.otpStatus === 'pending' ? 1 : 0;
      const bPending = b.capturedOtp && b.otpStatus === 'pending' ? 1 : 0;
      if (aPending !== bPending) return bPending - aPending;
      return (b.duration || 0) - (a.duration || 0);
    });

    res.json({ success: true, calls: list });
  } catch (err: any) {
    res.status(500).json({ success: false, calls: [], error: err.message });
  }
});

// Endpoint to toggle Hold (Music on Hold) for a live call
app.post('/api/asterisk/call/hold', requireActiveMembership, async (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const { number, channel, hold = true, holdMusic: rawHoldMusicInput } = req.body;
    const rawHoldMusic = String(rawHoldMusicInput || activeAudioAssignments.hold_music || 'default').trim().replace(/\.wav$/i, '');
    const holdMusic = !rawHoldMusic || LEGACY_CUSTOM_HOLD_PATHS.has(rawHoldMusic) ? 'default' : rawHoldMusic;
    const cleanNum = String(number || '').trim().replace(/[^0-9]/g, '');

    if (cleanNum) {
      const c10 = cleanNum.length === 11 && cleanNum.startsWith('1') ? cleanNum.substring(1) : cleanNum;
      const targetCall = callStatusStore.get(cleanNum) || callStatusStore.get(c10) || callStatusStore.get(`1${c10}`);
      if (targetCall && !canUserAccessCall(authUser, targetCall)) {
        return res.status(403).json({ success: false, error: 'No autorizado para poner en espera llamadas de otro Call Center o extensión.' });
      }
    }

    const updateState = (state: CallState) => {
      state.isOnHold = !!hold;
      state.status = hold ? 'on_hold' : 'talking';
      state.holdStartedAt = hold ? Date.now() : undefined;
      state.holdMusic = holdMusic;
    };

    if (cleanNum) {
      const clean10 = cleanNum.length === 11 && cleanNum.startsWith('1') ? cleanNum.substring(1) : cleanNum;
      const existing =
        callStatusStore.get(cleanNum) || callStatusStore.get(clean10) || callStatusStore.get(`1${clean10}`);
      if (existing) {
        updateState(existing);
      } else {
        const newState: CallState = {
          number: cleanNum,
          channel: channel || '',
          status: hold ? 'on_hold' : 'talking',
          isOnHold: !!hold,
          holdStartedAt: hold ? Date.now() : undefined,
          holdMusic,
          timestamp: Date.now(),
          startTime: Date.now(),
          duration: 0,
        };
        callStatusStore.set(cleanNum, newState);
        callStatusStore.set(clean10, newState);
      }
      // Save state to AstDB
      executeAsteriskCommand(`database put call_hold ${cleanNum} ${hold ? '1' : '0'}`).catch(() => {});
      executeAsteriskCommand(`database put ivr_vars ${cleanNum}_hold_music "${holdMusic}"`).catch(() => {});
    }

    // Control Music On Hold in Asterisk via channel command if provided
    if (channel) {
      if (hold) {
        executeAsteriskCommand(`moh start ${channel} default`).catch(() => {});
      } else {
        executeAsteriskCommand(`moh stop ${channel}`).catch(() => {});
      }
    }

    console.log(`[CALL HOLD TOGGLE] Destino: ${cleanNum} -> En Hold: ${hold} (MOH: ${holdMusic})`);
    res.json({ success: true, isOnHold: hold, holdMusic });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to synchronize Hold Music per entity into Asterisk
app.post('/api/asterisk/audio/sync-hold-music', requireAdminRole, async (req, res) => {
  try {
    const { entityId, holdMusicPath } = req.body;
    if (!entityId || !holdMusicPath) {
      return res.status(400).json({ success: false, error: 'entityId y holdMusicPath son requeridos' });
    }

    const cleanPath = holdMusicPath.trim();
    // Save to AstDB for this entity
    await executeAsteriskCommand(`database put hold_music ${entityId} "${cleanPath}"`);
    await executeAsteriskCommand(`database put ivr_vars default_hold_music "${cleanPath}"`);

    // Ensure musiconhold.conf is ready, audio files are placed in /var/lib/asterisk/moh, and Asterisk reloads MOH
    applyHoldMusicToAsteriskMoh(cleanPath);
    activeAudioAssignments.hold_music = cleanPath;
    saveActiveAudioAssignments(activeAudioAssignments);

    // Replicate to remote VPS if available (only from web client without local Asterisk)
    if (!hasLocalAsterisk && REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('localhost') && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') && !req.headers['x-governor-fwd']) {
      try {
        fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/audio/sync-hold-music`, {
          method: 'POST',
          headers: buildRemoteAuthHeaders(req, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(req.body),
        }).catch(() => {});
      } catch (_) {}
    }

    console.log(`[SYNC HOLD MUSIC] Entidad "${entityId}" configurada con MOH: ${cleanPath}`);
    res.json({ success: true, entityId, holdMusicPath: cleanPath });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to hangup an active call (individual or scoped/all mass campaign calls)
app.post('/api/asterisk/call/hangup', async (req, res) => {
  const authUser = (req as any).authUser;
  const { channel, number, destination, all } = req.body || {};
  const authIsGlobalAdmin = isGlobalAdminUser(authUser);
  const isAllRequest = all === true || all === 'true';
  const ASTERISK_CHAN_RE = /^(?:Local|PJSIP|SIP|DAHDI|Async)\/[A-Za-z0-9_.\-@\/;]+$/;

  try {
    const rawNum = String(number || destination || '').trim().replace(/[^0-9]/g, '');
    const clean10 = rawNum.length === 11 && rawNum.startsWith('1') ? rawNum.substring(1) : rawNum;
    const formattedDest = clean10.length === 10 ? `1${clean10}` : clean10;
    const rawChanStr = typeof channel === 'string' ? channel.trim() : '';
    const sanitizedReqChannel = rawChanStr && ASTERISK_CHAN_RE.test(rawChanStr) ? rawChanStr : '';

    if (!isAllRequest && !rawNum && !sanitizedReqChannel) {
      return res.status(400).json({
        success: false,
        error: 'Debes indicar el número o canal de la llamada que deseas colgar.',
      });
    }

    const existingByNumber =
      (clean10 && callStatusStore.get(clean10)) ||
      (formattedDest && callStatusStore.get(formattedDest)) ||
      (rawNum && callStatusStore.get(rawNum)) ||
      undefined;

    // Ownership checks for individual hangup requests
    if (!isAllRequest && !authIsGlobalAdmin) {
      if (existingByNumber && !canUserAccessCall(authUser, existingByNumber)) {
        return res.status(403).json({
          success: false,
          error: 'No autorizado para colgar llamadas de otro Call Center o extensión.',
        });
      }
      if (sanitizedReqChannel) {
        const chanBase = sanitizedReqChannel.replace(/\/n$/, '').replace(/;[12]$/, '');
        const matchingOwnedCalls = Array.from(callStatusStore.values()).filter((c) => {
          const ch = String(c.channel || '');
          const bch = String(c.bridgedChannel || '');
          return (
            ch === sanitizedReqChannel ||
            bch === sanitizedReqChannel ||
            (chanBase && (ch.startsWith(chanBase) || bch.startsWith(chanBase)))
          );
        });
        if (matchingOwnedCalls.some((c) => !canUserAccessCall(authUser, c))) {
          return res.status(403).json({
            success: false,
            error: 'No autorizado para colgar llamadas de otro Call Center o extensión.',
          });
        }
        const pjsipExtMatch = sanitizedReqChannel.match(/^PJSIP\/([A-Za-z0-9_.\-]+?)(?:-[0-9a-f]+)?$/i);
        if (
          pjsipExtMatch &&
          !isAdminUser(authUser) &&
          Array.isArray(authUser?.assignedExtensions) &&
          authUser.assignedExtensions.length > 0 &&
          !authUser.assignedExtensions.map(String).includes(pjsipExtMatch[1])
        ) {
          return res.status(403).json({
            success: false,
            error: 'No autorizado para colgar canales de otra extensión.',
          });
        }
      }
    }

    // Determine target numbers & channel prefixes strictly within the caller's authorized scope
    const targetNumberKeys = new Set<string>();
    const targetChannelHints = new Set<string>();
    const addNumberVariants = (numVal?: string) => {
      const d = String(numVal || '').trim().replace(/[^0-9]/g, '');
      if (!d) return;
      const d10 = d.length === 11 && d.startsWith('1') ? d.substring(1) : d;
      const d11 = d10.length === 10 ? `1${d10}` : d10;
      targetNumberKeys.add(d);
      if (d10) targetNumberKeys.add(d10);
      if (d11) targetNumberKeys.add(d11);
    };
    const addChannelHint = (chVal?: string) => {
      const c = String(chVal || '').trim();
      if (!c || !ASTERISK_CHAN_RE.test(c)) return;
      targetChannelHints.add(c);
      if (c.endsWith('/n')) targetChannelHints.add(c.replace(/\/n$/, ''));
      if (c.includes(';1')) targetChannelHints.add(c.replace(';1', ';2'));
      if (c.includes(';2')) targetChannelHints.add(c.replace(';2', ';1'));
    };

    if (isAllRequest && !authIsGlobalAdmin) {
      // Scoped "hangup all": ONLY calls and extensions owned by this client/agent/tenant
      for (const call of callStatusStore.values()) {
        if (call.status !== 'ended' && canUserAccessCall(authUser, call)) {
          addNumberVariants(call.number);
          addChannelHint(call.channel);
          addChannelHint(call.bridgedChannel);
        }
      }
      if (rawNum && (!existingByNumber || canUserAccessCall(authUser, existingByNumber))) {
        addNumberVariants(rawNum);
      }
      if (sanitizedReqChannel) {
        addChannelHint(sanitizedReqChannel);
      }
      if (Array.isArray(authUser?.assignedExtensions)) {
        authUser.assignedExtensions.forEach((ext: any) => {
          const cleanExt = String(ext || '').trim();
          if (cleanExt) targetChannelHints.add(`PJSIP/${cleanExt}`);
        });
      }
      if (isAdminUser(authUser) && authUser?.tenantId) {
        const tenantObj = loadStoredTenants().find((t) => String(t.id) === String(authUser.tenantId));
        if (tenantObj) {
          const tStart = Number(tenantObj.extensionStart);
          const tEnd = Number(tenantObj.extensionEnd);
          if (!isNaN(tStart) && !isNaN(tEnd) && tEnd >= tStart && tEnd - tStart <= 200) {
            for (let ext = tStart; ext <= tEnd; ext++) {
              targetChannelHints.add(`PJSIP/${ext}`);
            }
          }
        }
      }
    } else if (!isAllRequest) {
      addNumberVariants(rawNum);
      if (existingByNumber) {
        addNumberVariants(existingByNumber.number);
        addChannelHint(existingByNumber.channel);
        addChannelHint(existingByNumber.bridgedChannel);
      }
      if (sanitizedReqChannel) {
        addChannelHint(sanitizedReqChannel);
      }
    }

    // 1. Immediately register cancellation to permanently block any retry from dialplan
    const now = Date.now();
    if (isAllRequest && authIsGlobalAdmin) {
      if (clean10) cancelledNumbers.set(clean10, now);
      if (formattedDest) cancelledNumbers.set(formattedDest, now);
      if (rawNum) cancelledNumbers.set(rawNum, now);
      for (const call of callStatusStore.values()) {
        if (call.number) cancelledNumbers.set(call.number, now);
      }
      for (const t of pendingRetryTimers.values()) {
        clearTimeout(t);
      }
      pendingRetryTimers.clear();
      callRetryAttempts.clear();
      lastOriginatePayloads.clear();
      try {
        const spoolDir = '/var/spool/asterisk/outgoing';
        if (hasLocalAsterisk && fs.existsSync(spoolDir)) {
          for (const f of fs.readdirSync(spoolDir)) {
            if (f.endsWith('.call')) {
              try { fs.unlinkSync(path.join(spoolDir, f)); } catch (_) {}
            }
          }
        }
      } catch (_) {}
    } else {
      targetNumberKeys.forEach((key) => {
        cancelledNumbers.set(key, now);
        if (pendingRetryTimers.has(key)) {
          const t = pendingRetryTimers.get(key);
          if (t) clearTimeout(t);
          pendingRetryTimers.delete(key);
          console.log(`[HANGUP] Cancelado temporizador de reintento para ${key}`);
        }
        callRetryAttempts.delete(key);
        lastOriginatePayloads.delete(key);
      });
    }

    // 2. Mark AstDB immediately so Asterisk dialplan suppresses any redial / retry curl
    const astDbKeys = new Set<string>(targetNumberKeys);
    if (clean10) astDbKeys.add(clean10);
    if (formattedDest) astDbKeys.add(formattedDest);
    astDbKeys.forEach((key) => {
      if (/^[0-9]{3,16}$/.test(key)) {
        executeAsteriskCommand(`database put call_status "${key}" "operator_hangup"`).catch(() => {});
        executeAsteriskCommand(`database put ivr_vars "${key}_cancelled" "1"`).catch(() => {});
      }
    });

    // 3. Replicate hangup order to remote VPS if running from cloud preview
    if (
      !hasLocalAsterisk &&
      REMOTE_ASTERISK_HTTP &&
      !REMOTE_ASTERISK_HTTP.includes('localhost') &&
      !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') &&
      !req.headers['x-governor-fwd']
    ) {
      try {
        const fwdResp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/call/hangup`, {
          method: 'POST',
          headers: buildRemoteAuthHeaders(req, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(isAllRequest ? { ...req.body, all: true } : req.body),
        });
        if (!fwdResp.ok) {
          console.warn(`[HANGUP FORWARD WARNING] Remote Asterisk respondió HTTP ${fwdResp.status}`);
        }
      } catch (fwdErr: any) {
        console.warn('[HANGUP FORWARD WARNING]', fwdErr?.message || fwdErr);
      }
    }

    const channelsToHangup = new Set<string>();
    const addConcreteChannel = (chName?: string) => {
      const c = String(chName || '').trim();
      if (!c || !ASTERISK_CHAN_RE.test(c)) return;
      channelsToHangup.add(c);
      if (c.includes(';1')) channelsToHangup.add(c.replace(';1', ';2'));
      if (c.includes(';2')) channelsToHangup.add(c.replace(';2', ';1'));
    };

    // Add explicit/stored concrete channel IDs (with unique Asterisk suffix) and template hints
    if (!isAllRequest || !authIsGlobalAdmin) {
      targetChannelHints.forEach((hint) => addConcreteChannel(hint));
    }

    // 4. Invalidate cache to ensure 100% fresh channel discovery from Asterisk
    cliCommandCache.delete('core show channels');
    cliCommandCache.delete('core show channels concise');
    cliCommandCache.delete('pjsip show channels');

    const matchesScopedHint = (haystack: string, chanName: string): boolean => {
      if (isAllRequest && authIsGlobalAdmin) return true;
      for (const numKey of targetNumberKeys) {
        if (numKey.length >= 4 && haystack.includes(numKey)) {
          return true;
        }
      }
      for (const hint of targetChannelHints) {
        const cleanBase = hint.replace(/\/n$/, '').replace(/;[12]$/, '');
        if (
          chanName === hint ||
          chanName === cleanBase ||
          chanName.startsWith(`${cleanBase}-`) ||
          chanName.startsWith(`${cleanBase};`) ||
          haystack.includes(cleanBase)
        ) {
          return true;
        }
      }
      return false;
    };

    // Primary channel discovery via 'core show channels concise' (preserves full untruncated channel names & bridged legs)
    interface ConciseChannelRow {
      channel: string;
      context: string;
      extension: string;
      data: string;
      callerId: string;
      bridgedChannel: string;
      rawLine: string;
    }
    const conciseRows: ConciseChannelRow[] = [];
    try {
      const conciseOut = await executeAsteriskCommand('core show channels concise');
      if (conciseOut) {
        for (const line of conciseOut.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('Output:') || trimmed.startsWith('Privilege:')) continue;
          const parts = trimmed.split('!');
          const chName = (parts[0] || '').trim();
          if (!chName || !ASTERISK_CHAN_RE.test(chName)) continue;
          conciseRows.push({
            channel: chName,
            context: (parts[1] || '').trim(),
            extension: (parts[2] || '').trim(),
            data: (parts[6] || '').trim(),
            callerId: (parts[7] || '').trim(),
            bridgedChannel: (parts[11] || '').trim(),
            rawLine: trimmed,
          });
        }
      }
    } catch (e: any) {
      console.warn('[HANGUP CONCISE QUERY WARNING]', e.message);
    }

    const matchedLiveChannels = new Set<string>();
    for (const row of conciseRows) {
      const rowText = `${row.channel} ${row.extension} ${row.data} ${row.callerId} ${row.bridgedChannel}`;
      if (matchesScopedHint(rowText, row.channel)) {
        addConcreteChannel(row.channel);
        matchedLiveChannels.add(row.channel);
        if (row.bridgedChannel && ASTERISK_CHAN_RE.test(row.bridgedChannel)) {
          addConcreteChannel(row.bridgedChannel);
          matchedLiveChannels.add(row.bridgedChannel);
        }
      }
    }

    // Second pass: include any reverse-bridged or Local ;1/;2 peer rows in concise output
    if (matchedLiveChannels.size > 0) {
      const matchedBases = new Set(
        Array.from(matchedLiveChannels).map((c) => c.replace(/;[12]$/, ''))
      );
      for (const row of conciseRows) {
        const chBase = row.channel.replace(/;[12]$/, '');
        if (
          matchedLiveChannels.has(row.bridgedChannel) ||
          matchedBases.has(chBase)
        ) {
          addConcreteChannel(row.channel);
          if (row.bridgedChannel && ASTERISK_CHAN_RE.test(row.bridgedChannel)) {
            addConcreteChannel(row.bridgedChannel);
          }
        }
      }
    }

    // Secondary discovery via 'core show channels' and 'pjsip show channels' (line-scoped)
    try {
      const channelsOutput = await executeAsteriskCommand('core show channels');
      if (channelsOutput) {
        for (const line of channelsOutput.split('\n')) {
          const matches = line.match(/(?:Local|PJSIP|SIP|DAHDI|Async)\/[A-Za-z0-9_.\-@\/;]+/g);
          if (!matches) continue;
          for (const m of matches) {
            const cleanM = m.trim();
            if (matchesScopedHint(line, cleanM)) {
              addConcreteChannel(cleanM);
            }
          }
        }
      }
    } catch (e: any) {
      console.warn('[HANGUP QUERY WARNING]', e.message);
    }

    try {
      const pjsipChansOutput = await executeAsteriskCommand('pjsip show channels');
      if (pjsipChansOutput) {
        for (const line of pjsipChansOutput.split('\n')) {
          const matches = line.match(/PJSIP\/[A-Za-z0-9_.\-]+/g);
          if (!matches) continue;
          for (const m of matches) {
            const cleanM = m.trim();
            if (matchesScopedHint(line, cleanM)) {
              addConcreteChannel(cleanM);
            }
          }
        }
      }
    } catch (_) {}

    console.log(
      `[HANGUP TARGETS] Modo: ${isAllRequest ? (authIsGlobalAdmin ? 'GLOBAL_ALL' : 'SCOPED_ALL') : 'SINGLE'} | Usuario: ${authUser?.username || 'N/A'} | Destino: ${clean10 || 'N/A'} | Canales:`,
      Array.from(channelsToHangup)
    );

    // 5. Terminate identified channels via native AMI Hangup AND safe execFile Asterisk CLI
    const hungupList: string[] = [];
    const hangupPromises = Array.from(channelsToHangup).map(async (ch) => {
      if (!ASTERISK_CHAN_RE.test(ch)) return;
      try {
        console.log(`[HANGUP EXECUTE] Colgando canal: ${ch}`);
        await amiHangupChannel(ch);
        await executeAsteriskCommand(`channel request hangup ${ch}`);
        await executeAsteriskCommand(`hangup request ${ch}`);
        hungupList.push(ch);
      } catch (err: any) {
        console.warn(`[HANGUP CHANNEL ERR] ${ch}:`, err.message);
      }
    });

    await Promise.allSettled(hangupPromises);

    // Global 'hangup all' is restricted strictly to Global Super Admin when explicitly requesting all:true
    if (isAllRequest && authIsGlobalAdmin) {
      await executeAsteriskCommand('channel request hangup all').catch(() => {});
      await executeAsteriskCommand('hangup request all').catch(() => {});
    }

    // Invalidate channels cache so subsequent status checks immediately reflect ended state
    cliCommandCache.delete('core show channels');
    cliCommandCache.delete('core show channels concise');
    cliCommandCache.delete('pjsip show channels');

    // 6. Update in-memory call state strictly within caller's scope
    if (isAllRequest && authIsGlobalAdmin) {
      for (const [k, v] of callStatusStore.entries()) {
        if (v.status !== 'ended') {
          callStatusStore.set(k, {
            ...v,
            channel: '',
            bridgedChannel: undefined,
            status: 'ended',
            cause: 'Operador colgó todas las llamadas desde el panel',
            timestamp: Date.now(),
          });
        }
      }
    } else if (isAllRequest) {
      for (const [k, v] of callStatusStore.entries()) {
        if (v.status !== 'ended' && canUserAccessCall(authUser, v)) {
          callStatusStore.set(k, {
            ...v,
            channel: '',
            bridgedChannel: undefined,
            status: 'ended',
            cause: 'Operador colgó sus llamadas desde el panel',
            timestamp: Date.now(),
          });
        }
      }
    } else {
      const endedCause = 'Operador colgó la llamada manualmente desde el panel';
      targetNumberKeys.forEach((key) => {
        const prev = callStatusStore.get(key);
        callStatusStore.set(key, {
          ...(prev || {}),
          number: prev?.number || clean10 || rawNum || key,
          channel: '',
          bridgedChannel: undefined,
          status: 'ended',
          cause: endedCause,
          timestamp: Date.now(),
        });
      });
      if (!targetNumberKeys.size && sanitizedReqChannel) {
        const chanBase = sanitizedReqChannel.replace(/\/n$/, '').replace(/;[12]$/, '');
        for (const [k, v] of callStatusStore.entries()) {
          if (
            v.status !== 'ended' &&
            canUserAccessCall(authUser, v) &&
            (v.channel === sanitizedReqChannel ||
              v.bridgedChannel === sanitizedReqChannel ||
              (chanBase && (String(v.channel || '').startsWith(chanBase) || String(v.bridgedChannel || '').startsWith(chanBase))))
          ) {
            callStatusStore.set(k, {
              ...v,
              channel: '',
              bridgedChannel: undefined,
              status: 'ended',
              cause: endedCause,
              timestamp: Date.now(),
            });
          }
        }
      }
    }

    res.json({
      success: true,
      message: 'Llamada colgada exitosamente.',
      channelsHungup: hungupList,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to purge zombie or orphan Local channels stuck in infinite loops
app.post('/api/asterisk/call/purge-zombies', requireAdminRole, async (req, res) => {
  try {
    cliCommandCache.delete('core show channels concise');
    const amiOutput = await executeAsteriskCommand('core show channels concise');
    const killed: string[] = [];
    if (amiOutput) {
      const lines = amiOutput.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split('!');
        const ch = parts[0] || '';
        const ctx = parts[1] || '';
        const ext = parts[2] || '';
        if (ch.includes('8888') || ext === '8888' || ch.startsWith('Local/') || ctx === 'ivr-press1' || ctx === 'ivr-otp' || ctx === 'ivr-press1-cancel' || ctx === 'ivr-otp-verify') {
          await executeAsteriskCommand(`channel request hangup ${ch}`).catch(() => {});
          await executeAsteriskCommand(`hangup request ${ch}`).catch(() => {});
          if (hasLocalAsterisk) {
            exec(`asterisk -rx "channel request hangup ${ch}" 2>/dev/null`, () => {});
            exec(`asterisk -rx "hangup request ${ch}" 2>/dev/null`, () => {});
          }
          killed.push(ch);
        }
      }
    }
    // Also clean any leftover .call files in Asterisk spooler and hangup Local/8888 pattern
    try {
      const spoolDir = '/var/spool/asterisk/outgoing';
      if (hasLocalAsterisk && fs.existsSync(spoolDir)) {
        for (const f of fs.readdirSync(spoolDir)) {
          if (f.endsWith('.call')) {
            try { fs.unlinkSync(path.join(spoolDir, f)); } catch (_) {}
          }
        }
      }
    } catch (_) {}
    if (hasLocalAsterisk) {
      exec('asterisk -rx "channel request hangup Local/8888" 2>/dev/null', () => {});
      exec('asterisk -rx "dialplan reload" 2>/dev/null', () => {});
    } else {
      executeAsteriskCommand('channel request hangup Local/8888').catch(() => {});
      executeAsteriskCommand('dialplan reload').catch(() => {});
    }
    cliCommandCache.delete('core show channels concise');
    console.log(`[PURGE ZOMBIES] Canales huérfanos colgados:`, killed);
    res.json({ success: true, message: `Se purgaron ${killed.length} canales huérfanos o en bucle.`, killed });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to transfer an active live call directly to the automated OTP capture system (Ext. 4001+)
app.post('/api/asterisk/call/transfer-otp', requireActiveMembership, async (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const { channel, number, exten = '4001', agent } = req.body || {};
    const targetExten = String(exten || '4001').replace(/[^0-9]/g, '');
    if (!targetExten || targetExten.length < 2 || targetExten.length > 6) {
      return res.status(400).json({ success: false, error: 'Extensión destino de captura OTP inválida.' });
    }

    if (!hasLocalAsterisk && REMOTE_ASTERISK_HTTP && !REMOTE_ASTERISK_HTTP.includes('localhost') && !REMOTE_ASTERISK_HTTP.includes('127.0.0.1') && !req.headers['x-governor-fwd']) {
      try {
        const remoteResp = await fetch(`${REMOTE_ASTERISK_HTTP}/api/asterisk/call/transfer-otp`, {
          method: 'POST',
          headers: buildRemoteAuthHeaders(req, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(req.body),
        });
        if (remoteResp.ok) {
          const remoteJson = await remoteResp.json();
          return res.json(remoteJson);
        }
      } catch (_) {}
    }

    let chanToRedirect = typeof channel === 'string' ? channel.trim() : '';
    const cleanNum = number ? String(number).replace(/[^0-9]/g, '') : '';
    const clean10 = cleanNum.length === 11 && cleanNum.startsWith('1') ? cleanNum.substring(1) : (cleanNum.length > 10 ? cleanNum.slice(-10) : cleanNum);
    const cleanAgent = agent ? String(agent).trim().replace(/[^a-zA-Z0-9_-]/g, '') : '';
    const live = cleanNum ? (callStatusStore.get(cleanNum) || callStatusStore.get(clean10) || callStatusStore.get(`1${clean10}`)) : undefined;

    if (!isGlobalAdminUser(authUser)) {
      if (live && !canUserAccessCall(authUser, live)) {
        return res.status(403).json({ success: false, error: 'No tienes permiso para transferir esta llamada.' });
      }
      if (!live && cleanAgent && !isExtensionAllowedForUser(authUser, cleanAgent)) {
        return res.status(403).json({ success: false, error: 'No tienes permiso para transferir llamadas a ese agente.' });
      }
    }

    if (cleanNum && cleanAgent && cleanAgent !== 'ringall' && cleanAgent !== 'all') {
      const dbKeys = Array.from(new Set([cleanNum, clean10, clean10.length === 10 ? `1${clean10}` : ''].filter(Boolean)));
      for (const dk of dbKeys) {
        executeAsteriskCommand(`database put last_picked_agent "${dk}" "${cleanAgent}"`).catch(() => {});
        executeAsteriskCommand(`database put last_agent_call "${dk}" "${cleanAgent}"`).catch(() => {});
        executeAsteriskCommand(`database put ivr_vars "${dk}_agent_exten" "${cleanAgent}"`).catch(() => {});
      }
    }

    const isInternalAgentChan = (ch: string) => /^PJSIP\/\d{2,6}-/i.test(ch) && (!cleanAgent || ch.startsWith(`PJSIP/${cleanAgent}-`));

    if (!chanToRedirect && live?.channel && !isInternalAgentChan(live.channel)) {
      chanToRedirect = live.channel;
    }

    if ((!chanToRedirect || isInternalAgentChan(chanToRedirect)) && (cleanNum || clean10)) {
      const amiChannels = await executeAsteriskCommand('core show channels concise');
      const lines = amiChannels.split('\n');
      let fallbackMatch = '';
      for (const l of lines) {
        const trimmed = l.trim();
        if (!trimmed || trimmed.startsWith('Output:') || trimmed.startsWith('Privilege:')) continue;
        if ((clean10 && trimmed.includes(clean10)) || (cleanNum && trimmed.includes(cleanNum))) {
          const chName = trimmed.split('!')[0] || '';
          if (!chName) continue;
          // Prefer trunk/customer channel instead of agent PJSIP softphone leg
          if (!/^PJSIP\/\d{2,6}-/i.test(chName) && !chName.endsWith(';1')) {
            chanToRedirect = chName;
            break;
          }
          if (!fallbackMatch) fallbackMatch = chName;
        }
      }
      if ((!chanToRedirect || isInternalAgentChan(chanToRedirect)) && fallbackMatch) {
        chanToRedirect = fallbackMatch;
      }
    }

    if (!chanToRedirect && live?.channel) {
      chanToRedirect = live.channel;
    }

    if (chanToRedirect) {
      if (!/^(?:Local|PJSIP|SIP|DAHDI|Async)\/[a-zA-Z0-9_\-@\.;\/]+$/.test(chanToRedirect)) {
        return res.status(400).json({ success: false, error: 'Formato de canal Asterisk inválido.' });
      }
      console.log(`[TRANSFER TO OTP] Transfiriendo canal ${chanToRedirect} a extensión de captura automatizada ${targetExten} (Agente retorno: ${cleanAgent || 'asignado'})`);
      await executeAsteriskCommand(`channel redirect ${chanToRedirect} from-internal,${targetExten},1`);
      res.json({
        success: true,
        message: `Llamada transferida al sistema automático de captura OTP (${targetExten}). Retornará al agente ${cleanAgent || 'asignado'}.`,
        targetExten,
      });
    } else {
      res.status(404).json({ success: false, error: 'No se encontró canal activo en Asterisk para transferir' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// CHANSPY LIVE CALL LISTENING & SUPERVISION
// ==========================================

const activeSpySessions = new Map<string, {
  id: string;
  supervisorExten: string;
  targetExten?: string;
  targetChannel?: string;
  targetNumber?: string;
  mode: 'spy' | 'whisper' | 'barge';
  status: 'connecting' | 'connected' | 'ended';
  startedAt: number;
}>();

// Helper to originate ChanSpy directly via AMI Action: Originate (supports CallerID & Application)
function sendAmiOriginateApplication(
  channel: string,
  application: string,
  data: string,
  callerId: string
): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buffer = '';
    let sent = false;
    let settled = false;
    const done = (ok: boolean, msg: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch (_) {}
      resolve({ success: ok, message: msg });
    };
    const timer = setTimeout(() => done(false, 'Timeout AMI Originate ChanSpy'), 4000);
    socket.connect(AMI_PORT, AMI_HOST, () => {
      socket.write(`Action: Login\r\nUsername: ${AMI_USER}\r\nSecret: ${AMI_SECRET}\r\nEvents: off\r\n\r\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (!sent && (buffer.includes('Message: Authentication accepted') || buffer.includes('Response: Success'))) {
        sent = true;
        const payload =
          `Action: Originate\r\n` +
          `Channel: ${channel}\r\n` +
          `Application: ${application}\r\n` +
          `Data: ${data}\r\n` +
          `CallerID: ${callerId}\r\n` +
          `Timeout: 30000\r\n` +
          `Async: true\r\n\r\n`;
        socket.write(payload);
        return;
      }
      if (sent) {
        if (buffer.includes('Originate successfully queued') || buffer.includes('Response: Success')) {
          try { socket.write('Action: Logoff\r\n\r\n'); } catch (_) {}
          done(true, 'Llamada ChanSpy encolada vía AMI');
        } else if (buffer.includes('Response: Error')) {
          try { socket.write('Action: Logoff\r\n\r\n'); } catch (_) {}
          done(false, buffer);
        }
      }
    });
    socket.on('error', (err) => done(false, err.message));
  });
}

function requireSpyPermission(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authUser = (req as any).authUser || resolveAuthenticatedUser(req);
  if (!authUser) {
    return res.status(401).json({ success: false, error: 'Autenticación requerida.' });
  }
  const allowed = authUser.role === 'admin' || authUser.role === 'supervisor' || Boolean(authUser.permissions?.canSpy);
  if (!allowed) {
    return res.status(403).json({ success: false, error: 'Permisos insuficientes para usar monitoreo ChanSpy.' });
  }
  next();
}

// Endpoint to originate live ChanSpy monitoring call to supervisor's softphone/extension (default 1000)
app.post('/api/asterisk/spy/originate', requireSpyPermission, requireActiveMembership, async (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const {
      supervisorExten = '1000',
      targetExten = '',
      targetChannel,
      targetNumber,
      mode = 'spy', // 'spy' (silent listen: 'q'), 'whisper' (coach agent: 'qw'), 'barge' (3-way talk: 'qB')
    } = req.body;

    const cleanSup = String(supervisorExten).trim().replace(/[^a-zA-Z0-9_\-]/g, '') || '1000';
    const cleanTargetExten = String(targetExten || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '');
    const isRealAgentExten = cleanTargetExten && cleanTargetExten !== 'ringall' && cleanTargetExten !== 'all' && cleanTargetExten !== 'hunt';

    if (!isGlobalAdminUser(authUser) && isRealAgentExten && authUser?.tenantId) {
      const tenantsList = loadStoredTenants();
      const myTenant = tenantsList.find((t: any) => t && String(t.id) === String(authUser.tenantId));
      const targetNumInt = parseInt(cleanTargetExten, 10);
      if (myTenant && !isNaN(targetNumInt)) {
        if (targetNumInt < myTenant.extensionStart || targetNumInt > myTenant.extensionEnd) {
          return res.status(403).json({ success: false, error: 'No autorizado para supervisar extensiones de otro Call Center.' });
        }
      }
    }

    let spyOptions = 'q';
    if (mode === 'whisper') {
      spyOptions = 'qw';
    } else if (mode === 'barge') {
      spyOptions = 'qB';
    }

    // For whisper/barge always target agent's PJSIP leg so customer never hears coach whisper;
    // for silent spy, exact channel prefix lets supervisor listen even while customer is still in IVR.
    let chanPrefix = 'PJSIP';
    if ((mode === 'whisper' || mode === 'barge') && isRealAgentExten) {
      chanPrefix = `PJSIP/${cleanTargetExten}`;
    } else if (targetChannel && typeof targetChannel === 'string' && targetChannel.trim()) {
      chanPrefix = targetChannel.trim().replace(/;[0-9]+$/, '');
    } else if (isRealAgentExten) {
      chanPrefix = `PJSIP/${cleanTargetExten}`;
    }

    const cleanTargetNum = String(targetNumber || cleanTargetExten || 'LLAMADA').replace(/[^a-zA-Z0-9+_\-]/g, '');
    const spyCallerId = `"ESPIA ${cleanTargetNum}" <${cleanTargetNum}>`;

    console.log(`[CHANSPY ORIGINATE] Supervisor Ext: ${cleanSup} -> Target: ${chanPrefix} (Modo: ${mode}, Opciones: ${spyOptions})`);

    let originateSuccess = false;
    let message = '';

    if (hasLocalAsterisk) {
      // Verify supervisor extension is reachable/registered first
      try {
        const epOut = await executeAsteriskCommand(`pjsip show endpoint ${cleanSup}`);
        if (epOut && epOut.includes('Unavailable')) {
          return res.status(400).json({
            success: false,
            error: `La extensión ${cleanSup} no está registrada/conectada en MicroSIP. Conecta MicroSIP con la extensión ${cleanSup} primero.`,
          });
        }
      } catch (_) {}

      // 1. Try direct AMI Action: Originate
      const amiResult = await sendAmiOriginateApplication(
        `PJSIP/${cleanSup}`,
        'ChanSpy',
        `${chanPrefix},${spyOptions}`,
        spyCallerId
      );
      if (amiResult.success) {
        originateSuccess = true;
        message = `Llamando a tu extensión ${cleanSup} en MicroSIP para escuchar (${mode}). ¡Descuelga para oír en vivo!`;
      } else {
        // 2. Fallback to Asterisk CLI channel originate
        try {
          const cliCmd = `channel originate PJSIP/${cleanSup} application ChanSpy ${chanPrefix},${spyOptions}`;
          const cliRes = await executeAsteriskCommand(cliCmd);
          if (!cliRes || (!cliRes.toLowerCase().includes('error') && !cliRes.toLowerCase().includes('unable'))) {
            originateSuccess = true;
            message = `Llamando a tu extensión ${cleanSup} en MicroSIP (${mode})`;
          }
        } catch (_) {}
      }

      if (!originateSuccess) {
        return res.status(500).json({
          success: false,
          error: `No se pudo timbrar la extensión ${cleanSup}. Verifica que esté registrada en MicroSIP y en línea en Asterisk.`,
        });
      }
    } else {
      originateSuccess = true;
      message = `Supervisión en vivo iniciada para extensión ${cleanSup} (${mode})`;
    }

    const sessionId = `spy-${cleanSup}-${Date.now()}`;
    const sessionData = {
      id: sessionId,
      supervisorExten: cleanSup,
      targetExten: cleanTargetExten || String(targetExten || ''),
      targetChannel: targetChannel || chanPrefix,
      targetNumber: targetNumber || '',
      mode: mode as 'spy' | 'whisper' | 'barge',
      status: 'connected' as const,
      startedAt: Date.now(),
    };
    activeSpySessions.set(cleanSup, sessionData);

    res.json({
      success: true,
      message,
      session: sessionData,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to stop ChanSpy listening for supervisor
app.post('/api/asterisk/spy/stop', requireSpyPermission, async (req, res) => {
  try {
    const { supervisorExten = '1000' } = req.body;
    const cleanSup = String(supervisorExten).trim().replace(/[^a-zA-Z0-9_\-]/g, '') || '1000';

    try {
      // Find active channels belonging to supervisor's spy phone and hang up ONLY those channels
      const chansOut = await executeAsteriskCommand('core show channels concise');
      if (chansOut) {
        const lines = chansOut.split('\n');
        for (const line of lines) {
          const chName = line.trim().split('!')[0];
          if (chName && (chName.startsWith(`PJSIP/${cleanSup}-`) || chName === `PJSIP/${cleanSup}`)) {
            await executeAsteriskCommand(`channel request hangup ${chName}`).catch(() => {});
          }
        }
      }
    } catch (_) {}

    activeSpySessions.delete(cleanSup);
    console.log(`[CHANSPY STOP] Desconectada sesión de escucha para supervisor ${cleanSup}`);
    res.json({ success: true, message: `Supervisión detenida para extensión ${cleanSup}` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to query active spy sessions
app.get('/api/asterisk/spy/active', requireSpyPermission, (req, res) => {
  const authUser = (req as any).authUser;
  let sessions = Array.from(activeSpySessions.values());
  if (!isGlobalAdminUser(authUser) && authUser?.tenantId) {
    const tenantsList = loadStoredTenants();
    const myTenant = tenantsList.find((t: any) => t && String(t.id) === String(authUser.tenantId));
    if (myTenant) {
      sessions = sessions.filter((s) => {
        const ext = parseInt(String(s.targetExten || ''), 10);
        return isNaN(ext) || (ext >= myTenant.extensionStart && ext <= myTenant.extensionEnd);
      });
    }
  }
  res.json({ success: true, sessions });
});

// ==========================================
// PER-EXTENSION RECORDING (MIXMONITOR) APIs
// ==========================================
const MONITOR_DIR = '/var/spool/asterisk/monitor';

function isExtensionAllowedForUser(authUser: any, extStr: string): boolean {
  if (!authUser) return false;
  if (isGlobalAdminUser(authUser)) return true;
  const cleanExt = String(extStr || '').trim();
  if (authUser.tenantId) {
    const tenantsList = loadStoredTenants();
    const myTenant = tenantsList.find((t: any) => t && String(t.id) === String(authUser.tenantId));
    const num = parseInt(cleanExt, 10);
    if (myTenant && !isNaN(num)) {
      if (num < myTenant.extensionStart || num > myTenant.extensionEnd) return false;
    }
  }
  if (isAdminUser(authUser)) return true;
  const assigned = Array.isArray(authUser.assignedExtensions) ? authUser.assignedExtensions.map(String) : [];
  if (assigned.length === 0) return false;
  return assigned.includes(cleanExt);
}

app.post('/api/asterisk/extensions/recording', requireAdminRole, async (req, res) => {
  try {
    const { extension, enabled } = req.body || {};
    const cleanExt = String(extension || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!cleanExt) {
      return res.status(400).json({ success: false, error: 'Extensión requerida' });
    }
    if (!isExtensionAllowedForUser((req as any).authUser, cleanExt)) {
      return res.status(403).json({ success: false, error: 'No autorizado para configurar grabación en esa extensión.' });
    }
    const isEnabled = Boolean(enabled);

    try {
      if (!fs.existsSync(MONITOR_DIR)) {
        fs.mkdirSync(MONITOR_DIR, { recursive: true, mode: 0o775 });
      }
    } catch (_) {}

    // Update persisted extensions list on server
    const currentExts = lastSyncedExtensions.length > 0 ? [...lastSyncedExtensions] : [...loadStoredExtensions()];
    const updatedExts = currentExts.map((ext: any) =>
      String(ext?.extension || '').toLowerCase() === cleanExt.toLowerCase()
        ? { ...ext, recordCalls: isEnabled }
        : ext
    );
    lastSyncedExtensions = updatedExts;
    saveStoredExtensions(updatedExts);

    // Update AstDB immediately (no call drops, takes effect on next call instantly)
    if (isEnabled) {
      await executeAsteriskCommand(`database put record_ext ${cleanExt} "1"`).catch(() => {});
    } else {
      await executeAsteriskCommand(`database del record_ext ${cleanExt}`).catch(() => {});
    }

    console.log(`[MIXMONITOR] Grabación para extensión ${cleanExt}: ${isEnabled ? 'ACTIVADA' : 'DESACTIVADA'}`);
    return res.json({
      success: true,
      extension: cleanExt,
      recordCalls: isEnabled,
      message: isEnabled
        ? `Grabación automática activada para la extensión ${cleanExt}.`
        : `Grabación automática desactivada para la extensión ${cleanExt}.`,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/asterisk/recordings', (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const filterExt = String(req.query.extension || '').trim().toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();
    if (!fs.existsSync(MONITOR_DIR)) {
      return res.json({ success: true, recordings: [], monitorDir: MONITOR_DIR });
    }
    const files = fs.readdirSync(MONITOR_DIR).filter((f) => /\.(wav|mp3|gsm)$/i.test(f));
    const recordings = files
      .map((filename) => {
        const fullPath = path.join(MONITOR_DIR, filename);
        const stat = fs.statSync(fullPath);
        // Format: YYYYMMDD-HHMMSS_(IN|OUT|INT)_<ext>_(from|to)_<dest>_<uniqueid>.wav
        const m = filename.match(/^(\d{8})-(\d{6})_(IN|OUT|INT)_([a-zA-Z0-9_\-]+)_(from|to)_([a-zA-Z0-9_\-+]+)_([^.]+)\.(wav|mp3|gsm)$/i);
        const dateRaw = m ? m[1] : '';
        const timeRaw = m ? m[2] : '';
        const direction = m ? (m[3] as 'IN' | 'OUT' | 'INT') : 'OUT';
        const extension = m ? m[4] : 'N/A';
        const remoteParty = m ? m[6] : filename.replace(/\.(wav|mp3|gsm)$/i, '');
        const formattedDate = dateRaw && timeRaw
          ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)} ${timeRaw.slice(0, 2)}:${timeRaw.slice(2, 4)}:${timeRaw.slice(4, 6)}`
          : new Date(stat.mtimeMs).toISOString().replace('T', ' ').slice(0, 19);
        // Estimate duration for standard 8kHz 16-bit PCM mono WAV (~16000 bytes/sec)
        const durationSec = filename.toLowerCase().endsWith('.wav') && stat.size > 44
          ? Math.max(1, Math.round((stat.size - 44) / 16000))
          : 0;
        return {
          filename,
          direction,
          extension,
          remoteParty,
          date: formattedDate,
          sizeBytes: stat.size,
          durationSec,
          mtimeMs: stat.mtimeMs,
          playUrl: `/api/asterisk/recordings/play/${encodeURIComponent(filename)}`,
        };
      })
      .filter((r) => {
        if (!isExtensionAllowedForUser(authUser, r.extension)) return false;
        if (filterExt && filterExt !== 'all' && r.extension.toLowerCase() !== filterExt) return false;
        if (search) {
          return (
            r.filename.toLowerCase().includes(search) ||
            r.extension.toLowerCase().includes(search) ||
            r.remoteParty.toLowerCase().includes(search) ||
            r.date.toLowerCase().includes(search)
          );
        }
        return true;
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return res.json({ success: true, recordings, monitorDir: MONITOR_DIR });
  } catch (err: any) {
    return res.status(500).json({ success: false, recordings: [], error: err.message });
  }
});

app.get('/api/asterisk/recordings/play/:filename', (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const safeName = path.basename(String(req.params.filename || ''));
    if (!safeName || safeName.includes('..') || !/\.(wav|mp3|gsm)$/i.test(safeName)) {
      return res.status(400).json({ success: false, error: 'Nombre de archivo inválido' });
    }
    const extMatch = safeName.match(/^(\d{8})-(\d{6})_(IN|OUT|INT)_([a-zA-Z0-9_\-]+)_/i);
    if (!isGlobalAdminUser(authUser)) {
      if (!extMatch || !isExtensionAllowedForUser(authUser, extMatch[4])) {
        return res.status(403).json({ success: false, error: 'No autorizado para reproducir esta grabación.' });
      }
    }
    const fullPath = path.join(MONITOR_DIR, safeName);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, error: 'Grabación no encontrada' });
    }
    const stat = fs.statSync(fullPath);
    const mime = safeName.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    }
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mime,
      });
      fs.createReadStream(fullPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(fullPath).pipe(res);
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/asterisk/recordings/:filename', requireAdminRole, (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const safeName = path.basename(String(req.params.filename || ''));
    if (!safeName || safeName.includes('..')) {
      return res.status(400).json({ success: false, error: 'Archivo inválido' });
    }
    const extMatch = safeName.match(/^(\d{8})-(\d{6})_(IN|OUT|INT)_([a-zA-Z0-9_\-]+)_/i);
    if (!isGlobalAdminUser(authUser) && (!extMatch || !isExtensionAllowedForUser(authUser, extMatch[4]))) {
      return res.status(403).json({ success: false, error: 'No autorizado para eliminar esta grabación.' });
    }
    const fullPath = path.join(MONITOR_DIR, safeName);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
    return res.json({ success: true, message: `Grabación ${safeName} eliminada.` });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to serve live audio stream or active recording for in-browser listening
app.get('/api/asterisk/spy/stream', requireSpyPermission, async (req, res) => {
  try {
    const searchDirs = [
      '/var/spool/asterisk/monitor',
      '/var/lib/asterisk/sounds/custom',
      '/var/lib/asterisk/sounds/es/custom',
      path.join(process.cwd(), 'public', 'assets'),
    ];

    let foundFile: string | null = null;
    for (const dir of searchDirs) {
      if (fs.existsSync(dir)) {
        try {
          const files = fs.readdirSync(dir);
          const wavFiles = files.filter(f => f.endsWith('.wav'));
          if (wavFiles.length > 0) {
            foundFile = path.join(dir, wavFiles[0]);
            break;
          }
        } catch (_) {}
      }
    }

    if (foundFile && fs.existsSync(foundFile)) {
      const stat = fs.statSync(foundFile);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      fs.createReadStream(foundFile).pipe(res);
      return;
    }

    // Dynamic 8kHz clean WAV buffer simulation
    const sampleRate = 8000;
    const durationSec = 4;
    const numSamples = sampleRate * durationSec;
    const buffer = Buffer.alloc(44 + numSamples);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + numSamples, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate, 28);
    buffer.writeUInt16LE(1, 32);
    buffer.writeUInt16LE(8, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(numSamples, 40);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const voice = Math.sin(2 * Math.PI * 300 * t) * Math.sin(2 * Math.PI * 4 * t);
      const val = Math.floor(128 + 20 * voice);
      buffer.writeUInt8(Math.max(0, Math.min(255, val)), 44 + i);
    }

    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Content-Length': buffer.length,
      'Cache-Control': 'no-cache',
    });
    res.end(buffer);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// MODULO REVENTA DE MINUTOS & CONFIGURACION MICROSIP
// ==========================================

// In-memory / persistent file cache for reseller billing
const resellerDataPath = path.join(process.cwd(), 'reseller_data.json');
let resellerStore = {
  clients: [] as any[],
  recharges: [] as any[],
  rates: [] as any[],
};

try {
  if (fs.existsSync(resellerDataPath)) {
    const raw = fs.readFileSync(resellerDataPath, 'utf8');
    resellerStore = JSON.parse(raw);
  }
} catch (_) {}

function saveResellerStore() {
  try {
    fs.writeFileSync(resellerDataPath, JSON.stringify(resellerStore, null, 2), 'utf8');
  } catch (_) {}
}

// Endpoint to fetch reseller billing data
app.get('/api/reseller/data', (req, res) => {
  const authUser = (req as any).authUser;
  const authIsGlobalAdmin = isGlobalAdminUser(authUser);
  const sanitizeClient = (c: any) => {
    if (!c || typeof c !== 'object') return c;
    const { sipPassword: _sp, ...rest } = c;
    return rest;
  };
  const allClients = Array.isArray(resellerStore.clients) ? resellerStore.clients : [];
  const allRecharges = Array.isArray(resellerStore.recharges) ? resellerStore.recharges : [];
  const myUsername = String(authUser?.username || '').toLowerCase();
  const visibleClients = authIsGlobalAdmin
    ? allClients
    : allClients.filter((c) => String(c.sipUsername || '').toLowerCase() === myUsername || String(c.id || '') === String(authUser?.id || ''));
  const visibleRecharges = authIsGlobalAdmin
    ? allRecharges
    : allRecharges.filter((r) => String(r.sipUsername || '').toLowerCase() === myUsername || String(r.clientId || '') === String(authUser?.id || ''));

  res.json({
    success: true,
    data: {
      clients: visibleClients.map(sanitizeClient),
      recharges: visibleRecharges,
      rates: resellerStore.rates || [],
    },
  });
});

// Endpoint to create/update client and auto-register PJSIP extension in Asterisk
app.post('/api/reseller/clients', requireGlobalAdmin, async (req, res) => {
  try {
    const client = req.body;
    if (!client || !client.sipUsername) {
      return res.status(400).json({ success: false, error: 'sipUsername es requerido' });
    }

    const cleanUsername = String(client.sipUsername).trim().toLowerCase().replace(/[^a-zA-Z0-9_\-]/g, '');
    const existingClientObj = resellerStore.clients.find((c) => c.id === client.id || c.sipUsername === cleanUsername);
    const password = (typeof client.sipPassword === 'string' && client.sipPassword.trim())
      ? client.sipPassword.trim()
      : (existingClientObj?.sipPassword || crypto.randomBytes(12).toString('base64url'));

    // Check if extension already exists in defaultExtensionsList
    const existingIndex = defaultExtensionsList.findIndex(
      (e) => String(e.extension).toLowerCase() === cleanUsername
    );

    const newExtObj = {
      id: `ext-${cleanUsername}-${Date.now()}`,
      extension: cleanUsername,
      name: client.name || cleanUsername,
      secret: password,
      context: 'from-internal',
      transport: 'transport-udp',
      port: 47923,
      maxContacts: 5,
      codecs: ['ulaw', 'alaw'],
      callerId: `"${client.name || cleanUsername}" <${cleanUsername}>`,
      callerIdNum: cleanUsername,
      callerIdName: client.name || cleanUsername,
      status: 'registered',
      lastSeen: 'Creada vía Módulo Reventa MicroSIP',
    };

    if (existingIndex >= 0) {
      defaultExtensionsList[existingIndex] = {
        ...defaultExtensionsList[existingIndex],
        ...newExtObj,
      };
    } else {
      defaultExtensionsList.push(newExtObj as any);
    }

    // Auto-update /etc/asterisk/pjsip.conf and /etc/asterisk/extensions.conf and reload only when changed
    try {
      const normalizePjsipTxt = (txt: string) => txt.replace(/^; Fecha:.*$/gm, '').trim();
      const normalizeDialplanTxt = (txt: string) => txt.replace(/^; Generado.*$/gm, '').trim();
      const activeExts = lastSyncedExtensions.length > 0 ? lastSyncedExtensions : loadStoredExtensions();
      const activeCarriers = lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers();
      const updatedPjsip = generateCleanPjsipConf(activeExts, activeCarriers, loadStoredUsers());
      const prevPjsipDisk = fs.existsSync('/etc/asterisk/pjsip.conf') ? fs.readFileSync('/etc/asterisk/pjsip.conf', 'utf8') : '';
      const pjsipChanged = normalizePjsipTxt(prevPjsipDisk) !== normalizePjsipTxt(updatedPjsip);
      if (pjsipChanged) {
        await writeAsteriskConfigFile('/etc/asterisk/pjsip.conf', updatedPjsip);
        await writeAsteriskConfigFile(path.join(process.cwd(), 'pjsip.conf'), updatedPjsip);
      }
      const updatedDialplan = generateCleanDialplanConf(activeCarriers, undefined, {}, activeExts);
      const prevDialplanDisk = fs.existsSync('/etc/asterisk/extensions.conf') ? fs.readFileSync('/etc/asterisk/extensions.conf', 'utf8') : '';
      const dialplanChanged = normalizeDialplanTxt(prevDialplanDisk) !== normalizeDialplanTxt(updatedDialplan);
      if (dialplanChanged) {
        await writeAsteriskConfigFile('/etc/asterisk/extensions.conf', updatedDialplan);
        await writeAsteriskConfigFile(path.join(process.cwd(), 'extensions.conf'), updatedDialplan);
      }
      const reloadCmds: string[] = [];
      if (pjsipChanged) reloadCmds.push('pjsip reload');
      if (dialplanChanged) reloadCmds.push('dialplan reload');
      if (hasLocalAsterisk && reloadCmds.length > 0) {
        const bin = getAsteriskBinary();
        exec(reloadCmds.map((c) => `"${bin}" -rx "${c}"`).join(' && '), () => {});
        cachedPjsipEndpoints = null;
        invalidateCliCache();
      }
    } catch (_) {}

    // Save in reseller store with granular merge
    const existingClientIdx = resellerStore.clients.findIndex((c) => c.id === client.id || c.sipUsername === cleanUsername);
    const savedClientData = { ...client, sipUsername: cleanUsername, sipPassword: password };
    if (existingClientIdx >= 0) {
      resellerStore.clients[existingClientIdx] = { ...resellerStore.clients[existingClientIdx], ...savedClientData };
    } else {
      resellerStore.clients.unshift(savedClientData);
    }
    saveResellerStore();

    // Granular AstDB balance and rate update ONLY for this client
    if (typeof client.balance === 'number') {
      executeAsteriskCommand(`database put reseller_balance ${cleanUsername} "${client.balance}"`).catch(() => {});
    }
    if (typeof client.costPerMinute === 'number') {
      executeAsteriskCommand(`database put reseller_rate ${cleanUsername} "${client.costPerMinute}"`).catch(() => {});
    }
    executeAsteriskCommand(`database put reseller_cutoff ${cleanUsername} "${client.cutoffOnZero !== false ? '1' : '0'}"`).catch(() => {});

    // Save assigned carrier in AstDB for dedicated routing
    const activeCarriersForReseller = lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers();
    const assignedCarrier = client.assignedCarrierId || client.carrierId || '';
    if (assignedCarrier && assignedCarrier !== 'auto') {
      executeAsteriskCommand(`database put user_carrier ${cleanUsername} "${resolveCarrierNameByRef(assignedCarrier, activeCarriersForReseller)}"`).catch(() => {});
    } else {
      executeAsteriskCommand(`database del user_carrier ${cleanUsername}`).catch(() => {});
    }

    const { sipPassword: _omitted, ...safeClientResponse } = savedClientData;
    res.json({
      success: true,
      message: `Cliente ${cleanUsername} registrado exitosamente como extensión PJSIP en Asterisk 20.`,
      client: safeClientResponse,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to delete a reseller client without wiping other clients
app.delete('/api/reseller/clients/:clientId', requireGlobalAdmin, async (req, res) => {
  try {
    const clientId = String(req.params.clientId || '').trim();
    const idx = resellerStore.clients.findIndex((c) => c.id === clientId || c.sipUsername === clientId);
    if (idx >= 0) {
      const removed = resellerStore.clients.splice(idx, 1)[0];
      saveResellerStore();
      if (removed && removed.sipUsername) {
        executeAsteriskCommand(`database del reseller_balance ${removed.sipUsername}`).catch(() => {});
        executeAsteriskCommand(`database del reseller_rate ${removed.sipUsername}`).catch(() => {});
      }
    }
    res.json({ success: true, message: 'Cliente eliminado correctamente' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to log individual recharge without touching entire database
app.post('/api/reseller/recharges', requireGlobalAdmin, async (req, res) => {
  try {
    const recharge = req.body;
    if (!recharge || !recharge.sipUsername) {
      return res.status(400).json({ success: false, error: 'Datos de recarga incompletos' });
    }
    const cleanUser = String(recharge.sipUsername).trim().toLowerCase();
    const client = resellerStore.clients.find((c) => c.sipUsername === cleanUser || c.id === recharge.clientId);
    if (client) {
      client.balance = Number(((client.balance || 0) + (parseFloat(recharge.amount) || 0)).toFixed(2));
      client.allocatedMinutes = (client.allocatedMinutes || 0) + (parseInt(recharge.minutesAdded) || 0);
      client.totalRecharges = (client.totalRecharges || 0) + 1;
      client.lastRechargeDate = new Date().toISOString().split('T')[0];
      saveResellerStore();
      executeAsteriskCommand(`database put reseller_balance ${cleanUser} "${client.balance}"`).catch(() => {});
    }
    if (!Array.isArray(resellerStore.recharges)) resellerStore.recharges = [];
    resellerStore.recharges.unshift(recharge);
    saveResellerStore();
    res.json({ success: true, balance: client?.balance });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to generate and download ready-to-use microsip.ini
app.get('/api/reseller/microsip-ini/:username', (req, res) => {
  const authUser = (req as any).authUser;
  const username = String(req.params.username || '').trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '');
  if (!isGlobalAdminUser(authUser) && String(authUser?.username || '').toLowerCase() !== username) {
    return res.status(403).json({ success: false, error: 'Solo puedes descargar tu propio perfil MicroSIP.' });
  }
  const stored = loadStoredUsers();
  const foundUser = stored.find((u) => String(u.username || '').toLowerCase() === username);
  const client = resellerStore.clients.find((c) => String(c.sipUsername || '').toLowerCase() === username) || {
    name: foundUser?.name || username,
    sipUsername: username,
    sipPassword: foundUser?.sipSecret || '',
  };

  const host = req.headers.host?.split(':')[0] || '127.0.0.1';
  const port = 47923;
  const pass = foundUser?.sipSecret || client.sipPassword || '';

  const iniContent = `[Settings]
autoAnswer=0
denyIncoming=0
directory=
disableLocalRing=0
enableLocalDTMF=1
enableLog=0
enableSTUN=0
forceCodec=PCMU/8000
hideCallerId=0
localPort=0
ringtone=
server=${host}:${port}
singleMode=0
volumeIn=100
volumeOut=100

[Account1]
accountName=${client.name || username}
server=${host}:${port}
proxy=
user=${username}
domain=${host}:${port}
login=${username}
password=${pass}
displayName=${client.name || username}
authID=${username}
transport=UDP
mediaEncryption=
publish=0
regInterval=300
`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="microsip_${username}.ini"`);
  res.send(iniContent);
});

// Endpoint to list all users from disk persistence
app.get('/api/users', (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const users = loadStoredUsers();
    if (isGlobalAdminUser(authUser)) {
      return res.json({ success: true, users: users.map(sanitizeUserForClient) });
    }
    if (isAdminUser(authUser) && authUser?.tenantId) {
      const tenantUsers = users.filter((u) => String(u.tenantId || '') === String(authUser.tenantId));
      return res.json({ success: true, users: tenantUsers.map(sanitizeUserForClient) });
    }
    return res.json({ success: true, users: authUser ? [sanitizeUserForClient(authUser)] : [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to sync users and provision PJSIP endpoints in Asterisk 20 (fixing 'contraseña incorrecta' in MicroSIP)
app.post('/api/users/sync-sip', requireAdminRole, async (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const authIsGlobalAdmin = isGlobalAdminUser(authUser);
    const { user, users } = req.body;
    let stored = loadStoredUsers();
    if (Array.isArray(users) && users.length > 0) {
      // Merge users instead of blindly overwriting the whole database
      const userMap = new Map<string, any>();
      for (const u of stored) {
        if (u && (u.id || u.username)) {
          userMap.set(String(u.id || u.username).toLowerCase(), u);
        }
      }
      for (const u of users) {
        if (u && (u.id || u.username)) {
          const key = String(u.id || u.username).toLowerCase();
          const prev = userMap.get(key) || {};
          const { membership: _ignoreM, effectiveMembership: _ignoreEm, ...cleanU } = u;
          if (!authIsGlobalAdmin) {
            if (!authUser?.tenantId || (prev.id && String(prev.tenantId || '') !== String(authUser.tenantId))) {
              continue;
            }
            const safeSub = {
              ...cleanU,
              ...(prev?.membership ? { membership: prev.membership } : {}),
              tenantId: authUser.tenantId,
              assignedCallFlowMode: prev?.assignedCallFlowMode,
              allowedCallFlowModes: prev?.allowedCallFlowModes,
              permissions: {
                ...(u.permissions || {}),
                canUseMassCalls: Boolean(prev?.permissions?.canUseMassCalls),
              },
            };
            if (safeSub.role === 'admin' && !safeSub.tenantId) safeSub.role = 'supervisor';
            userMap.set(key, normalizeUserRecordForStorage(safeSub, prev));
          } else {
            userMap.set(
              key,
              normalizeUserRecordForStorage(
                { ...cleanU, ...(prev?.membership ? { membership: prev.membership } : {}) },
                prev
              )
            );
          }
        }
      }
      stored = Array.from(userMap.values());
      saveStoredUsers(stored);
      stored = loadStoredUsers();
      lastSyncedUsers = stored;
    }
    const targetUser = user || (Array.isArray(users) && users[users.length - 1]);
    if (!targetUser) {
      return res.status(400).json({ success: false, error: 'No se recibieron datos de usuario' });
    }

    const rawUser = String(targetUser.username || (targetUser.email ? targetUser.email.split('@')[0] : '') || targetUser.name || '').trim();
    const cleanUser = rawUser.toLowerCase().replace(/[^a-z0-9_\-]/g, '') || 'usuario';

    // 1. Ensure user is updated in stored users array with scrypt hash + preserved secret
    const existingIdx = stored.findIndex(
      (u) =>
        (targetUser.id && u.id === targetUser.id) ||
        String(u.username || '').toLowerCase() === cleanUser
    );
    const prevUser = existingIdx >= 0 ? stored[existingIdx] : null;
    if (!authIsGlobalAdmin) {
      if (!authUser?.tenantId) {
        return res.status(403).json({ success: false, error: 'Solo el Super Administrador Global puede sincronizar usuarios globales.' });
      }
      if (prevUser && String(prevUser.tenantId || '') !== String(authUser.tenantId)) {
        return res.status(403).json({ success: false, error: 'No autorizado para modificar usuarios de otro Call Center.' });
      }
    }

    const assignedTenantId = authIsGlobalAdmin
      ? (targetUser.tenantId ? String(targetUser.tenantId) : '')
      : String(authUser?.tenantId || '');
    const targetIsGlobalAdmin = (targetUser.role === 'admin' && !assignedTenantId);
    if (assignedTenantId && !targetIsGlobalAdmin) {
      const tenantsListForSeatCheck = loadStoredTenants();
      const matchedTenantForSeat = tenantsListForSeatCheck.find((t: any) => t && String(t.id) === assignedTenantId);
      const seatLimit = Number(matchedTenantForSeat?.membership?.licensedAgents ?? matchedTenantForSeat?.licensedAgents ?? 0);
      if (Number.isFinite(seatLimit) && seatLimit > 0) {
        const isAlreadyInThisTenant = Boolean(prevUser && String(prevUser.tenantId || '') === assignedTenantId);
        if (!isAlreadyInThisTenant) {
          const currentUsedSeats = countActiveAgentsForTenant(assignedTenantId, stored);
          if (currentUsedSeats >= seatLimit) {
            return res.status(400).json({
              success: false,
              error: `El Call Center "${matchedTenantForSeat?.name || assignedTenantId}" alcanzó su límite contratado de ${seatLimit} agente(s). Amplía la cantidad de agentes en Membresías para agregar más.`,
            });
          }
        }
      }
    }

    const existingResellerClient = resellerStore.clients.find((c) => String(c.sipUsername || '').toLowerCase() === cleanUser);
    const hasNewPass = typeof targetUser.password === 'string' && targetUser.password.trim().length > 0;
    const password = hasNewPass
      ? targetUser.password.trim()
      : (prevUser?.sipSecret || existingResellerClient?.sipPassword || crypto.randomBytes(12).toString('base64url'));

    const { membership: _discardM, effectiveMembership: _discardEm, ...cleanTargetFields } = targetUser;
    let preservedMembership = prevUser?.membership;
    const requestedInitMode: 'initial_month' | 'demo_1_day' | 'none' =
      req.body.initialActivationMode === 'demo_1_day' || req.body.initialActivationMode === 'initial_month' || req.body.initialActivationMode === 'none'
        ? req.body.initialActivationMode
        : (req.body.activateInitialMonth === true ? 'initial_month' : 'none');

    if (!prevUser && authIsGlobalAdmin && (requestedInitMode === 'initial_month' || requestedInitMode === 'demo_1_day')) {
      const initPriceCheck = sanitizeOptionalUsdAmount(req.body.amountPaid);
      if (!initPriceCheck.valid) {
        return res.status(400).json({ success: false, error: initPriceCheck.error });
      }
      const mRes = applyMembershipActivation(
        undefined,
        {
          action: requestedInitMode,
          scope: 'user',
          amountPaid: initPriceCheck.value,
          notes:
            requestedInitMode === 'demo_1_day'
              ? 'Demo de Prueba (1 Día) activado al crear usuario'
              : 'Activación inicial de 1 Mes al crear usuario',
        },
        authUser.username || 'admin'
      );
      if (mRes.ok && mRes.membership) {
        preservedMembership = mRes.membership;
      }
    }

    const sanitizedTarget = authIsGlobalAdmin
      ? { ...cleanTargetFields, ...(preservedMembership ? { membership: preservedMembership } : {}) }
      : {
          ...cleanTargetFields,
          ...(preservedMembership ? { membership: preservedMembership } : {}),
          tenantId: authUser.tenantId,
          role: targetUser.role === 'admin' && !authUser.tenantId ? 'supervisor' : targetUser.role,
          assignedCallFlowMode: prevUser?.assignedCallFlowMode,
          allowedCallFlowModes: prevUser?.allowedCallFlowModes,
          permissions: {
            ...(targetUser.permissions || {}),
            canUseMassCalls: Boolean(prevUser?.permissions?.canUseMassCalls),
          },
        };
    const updatedUserObj = normalizeUserRecordForStorage(
      { ...sanitizedTarget, username: cleanUser, sipSecret: password, ...(hasNewPass ? { password } : {}) },
      prevUser
    );
    if (existingIdx >= 0) {
      const merged = { ...stored[existingIdx], ...updatedUserObj };
      if ('assignedEntityIds' in targetUser && targetUser.assignedEntityIds === undefined) {
        delete merged.assignedEntityIds;
      }
      stored[existingIdx] = merged;
    } else {
      stored.push(updatedUserObj);
    }
    saveStoredUsers(stored);
    stored = loadStoredUsers();
    lastSyncedUsers = stored;

    // 2. Ensure user is in defaultExtensionsList as full PJSIP Endpoint
    const extIdx = defaultExtensionsList.findIndex((e) => String(e.extension).toLowerCase() === cleanUser);
    const extObj = {
      id: `ext-${cleanUser}`,
      extension: cleanUser,
      name: targetUser.name || cleanUser,
      secret: password,
      context: 'from-internal',
      transport: 'transport-udp',
      port: 47923,
      maxContacts: 10,
      codecs: ['ulaw', 'alaw'],
      callerIdNum: (Array.isArray(targetUser.assignedExtensions) && targetUser.assignedExtensions[0]) || cleanUser,
      callerIdName: targetUser.name || cleanUser,
      status: 'registered',
      lastSeen: 'Autogenerado para MicroSIP',
    };

    if (extIdx >= 0) {
      defaultExtensionsList[extIdx] = { ...defaultExtensionsList[extIdx], ...extObj };
    } else {
      defaultExtensionsList.push(extObj as any);
    }

    // 3. If user has assigned numeric extensions (e.g. 2001+ for clients, 1001+ for agents), add missing ones ONLY without overwriting existing numeric extension passwords
    if (Array.isArray(targetUser.assignedExtensions)) {
      const currentStoredExts = lastSyncedExtensions.length > 0 ? [...lastSyncedExtensions] : [...loadStoredExtensions()];
      let changedStoredExts = false;
      for (const assigned of targetUser.assignedExtensions) {
        const cleanAssigned = String(assigned).replace(/[^a-zA-Z0-9_\-]/g, '');
        const cleanAssignedKey = cleanAssigned.toLowerCase();
        if (!cleanAssigned) continue;
        const storedIdx = currentStoredExts.findIndex((e: any) => String(e?.extension || '').toLowerCase() === cleanAssignedKey);
        if (storedIdx === -1) {
          currentStoredExts.push({
            id: `ext-${cleanAssigned}`,
            extension: cleanAssigned,
            name: targetUser.name || `Cliente ${cleanAssigned}`,
            secret: password,
            context: 'from-internal',
            transport: 'transport-udp',
            port: 47923,
            maxContacts: 3,
            codecs: ['ulaw', 'alaw'],
            callerId: `"${targetUser.name || cleanAssigned}" <${cleanAssigned}>`,
            callerIdNum: cleanAssigned,
            callerIdName: targetUser.name || cleanAssigned,
            status: 'registered',
            lastSeen: 'Auto-creada desde Usuarios (2001+)',
            recordCalls: false,
          });
          changedStoredExts = true;
        }
      }
      if (changedStoredExts) {
        saveStoredExtensions(currentStoredExts);
        lastSyncedExtensions = loadStoredExtensions();
      }
    }

    // 4. Save in resellerStore (cutoff disabled for Membership-managed individual users)
    const balance = typeof targetUser.balance === 'number' ? targetUser.balance : 0;
    const ratePerMinute = typeof targetUser.costPerMinute === 'number' ? targetUser.costPerMinute : (typeof targetUser.ratePerMinute === 'number' ? targetUser.ratePerMinute : 0.02);
    const shouldCutoffOnZero = targetUser.cutoffOnZero === true;
    const existingClientIdx = resellerStore.clients.findIndex((c) => c.sipUsername === cleanUser || c.id === targetUser.id);
    const clientRecord = {
      id: targetUser.id || `res-${cleanUser}`,
      name: targetUser.name || cleanUser,
      sipUsername: cleanUser,
      sipPassword: password,
      currency: 'USD',
      balance: balance,
      allocatedMinutes: Math.round(balance / (ratePerMinute || 0.02)),
      usedMinutes: targetUser.usedMinutes || 0,
      costPerMinute: ratePerMinute,
      planType: 'prepago',
      status: targetUser.status === 'inactive' ? 'suspended' : 'active',
      creditLimit: 0,
      cutoffOnZero: shouldCutoffOnZero,
      createdAt: targetUser.createdAt || new Date().toISOString().split('T')[0],
      totalRecharges: 1,
    };

    if (existingClientIdx >= 0) {
      resellerStore.clients[existingClientIdx] = { ...resellerStore.clients[existingClientIdx], ...clientRecord };
    } else {
      resellerStore.clients.unshift(clientRecord);
    }
    saveResellerStore();

    // 5. AstDB persistence for CallerID and Balance (BOTH for username AND for all assigned numeric extensions)
    const targetsToProvisionInDb = [cleanUser];
    if (Array.isArray(targetUser.assignedExtensions)) {
      for (const ext of targetUser.assignedExtensions) {
        const cExt = String(ext).replace(/[^a-zA-Z0-9_\-]/g, '');
        if (cExt && !targetsToProvisionInDb.includes(cExt)) {
          targetsToProvisionInDb.push(cExt);
        }
      }
    }

    const activeCarriersForUserSync = lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers();
    const tenantResForUser = resolveTenantCarrierForCall(
      {
        tenantId: sanitizedTarget.tenantId,
        agentExten: Array.isArray(targetUser.assignedExtensions) ? targetUser.assignedExtensions[0] : cleanUser,
      },
      activeCarriersForUserSync
    );
    const rawUserCarrier = targetUser.carrierId || targetUser.assignedCarrierId || tenantResForUser.carrierName || '';
    const resolvedUserCarrier = (rawUserCarrier && rawUserCarrier !== 'auto')
      ? resolveCarrierNameByRef(rawUserCarrier, activeCarriersForUserSync)
      : '';
    for (const tgt of targetsToProvisionInDb) {
      executeAsteriskCommand(`database put reseller_balance ${tgt} "${balance}"`).catch(() => {});
      executeAsteriskCommand(`database put reseller_rate ${tgt} "${ratePerMinute}"`).catch(() => {});
      executeAsteriskCommand(`database put reseller_cutoff ${tgt} "${shouldCutoffOnZero ? '1' : '0'}"`).catch(() => {});
      executeAsteriskCommand(`database deltree extension_cid/${tgt}`).catch(() => {});
      if (resolvedUserCarrier && resolvedUserCarrier !== 'auto') {
        executeAsteriskCommand(`database put user_carrier ${tgt} "${resolvedUserCarrier}"`).catch(() => {});
      } else {
        executeAsteriskCommand(`database del user_carrier ${tgt}`).catch(() => {});
      }
    }

    // 6. Generate and write clean pjsip.conf / extensions.conf only when changed
    const normalizePjsipTxt = (txt: string) => txt.replace(/^; Fecha:.*$/gm, '').trim();
    const normalizeDialplanTxt = (txt: string) => txt.replace(/^; Generado.*$/gm, '').trim();
    const activeExts = lastSyncedExtensions.length > 0 ? lastSyncedExtensions : loadStoredExtensions();
    const activeCarriers = lastSyncedCarriers.length > 0 ? lastSyncedCarriers : loadStoredCarriers();
    const updatedPjsip = generateCleanPjsipConf(activeExts, activeCarriers, stored);
    const prevPjsipDisk = fs.existsSync('/etc/asterisk/pjsip.conf') ? fs.readFileSync('/etc/asterisk/pjsip.conf', 'utf8') : '';
    const pjsipChanged = normalizePjsipTxt(prevPjsipDisk) !== normalizePjsipTxt(updatedPjsip);
    if (pjsipChanged) {
      await writeAsteriskConfigFile('/etc/asterisk/pjsip.conf', updatedPjsip);
      await writeAsteriskConfigFile(path.join(process.cwd(), 'pjsip.conf'), updatedPjsip);
    }

    // Also write extensions.conf to ensure dialplan supports manual dialing
    const updatedDialplan = generateCleanDialplanConf(activeCarriers, undefined, {}, activeExts);
    const prevDialplanDisk = fs.existsSync('/etc/asterisk/extensions.conf') ? fs.readFileSync('/etc/asterisk/extensions.conf', 'utf8') : '';
    const dialplanChanged = normalizeDialplanTxt(prevDialplanDisk) !== normalizeDialplanTxt(updatedDialplan);
    if (dialplanChanged) {
      await writeAsteriskConfigFile('/etc/asterisk/extensions.conf', updatedDialplan);
      await writeAsteriskConfigFile(path.join(process.cwd(), 'extensions.conf'), updatedDialplan);
    }

    // 7. Hot reload Asterisk (only reload modules that actually changed, and await completion)
    const reloadCmds: string[] = [];
    if (pjsipChanged) reloadCmds.push('pjsip reload');
    if (dialplanChanged) reloadCmds.push('dialplan reload');
    if (reloadCmds.length > 0) {
      if (hasLocalAsterisk) {
        const bin = getAsteriskBinary();
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => resolve(), 5000);
          exec(reloadCmds.map((c) => `"${bin}" -rx "${c}"`).join(' && '), () => {
            clearTimeout(timer);
            resolve();
          });
        });
      } else {
        try {
          await sendAmiAction('127.0.0.1', AMI_PORT, AMI_USER, AMI_SECRET, reloadCmds);
        } catch (_) {}
      }
      cachedPjsipEndpoints = null;
      invalidateCliCache();
    }

    res.json({
      success: true,
      message: `Credenciales de MicroSIP sincronizadas en Asterisk 20. El usuario ${cleanUser} ya puede iniciar sesión en MicroSIP sin error de contraseña.`,
      username: cleanUser,
      assignedExtensions: targetUser.assignedExtensions || [],
      port: 47923,
      balance: balance,
      costPerMinute: ratePerMinute,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to deduct balance after call hangup (reseller clients + Call Center tenants)
app.get('/api/reseller/deduct', requireInternalOrGlobalAdmin, (req, res) => {
  try {
    const { client, secs, dest, tenant } = req.query as { client?: string; secs?: string; dest?: string; tenant?: string };
    const cleanUser = String(client || '').trim().toLowerCase().replace(/[^a-zA-Z0-9_\-]/g, '');
    const durationSecs = parseInt(secs || '0', 10);
    if (isNaN(durationSecs) || durationSecs <= 0) {
      return res.json({ success: true, billedMinutes: 0 });
    }
    const billedMinutes = Math.max(1, Math.ceil(durationSecs / 60));

    if (cleanUser) {
      const cli = resellerStore.clients.find((c) => c.sipUsername === cleanUser);
      if (cli) {
        const rate = cli.costPerMinute || 0.02;
        const callCost = parseFloat((billedMinutes * rate).toFixed(4));
        cli.balance = Math.max(0, parseFloat((cli.balance - callCost).toFixed(2)));
        cli.usedMinutes = (cli.usedMinutes || 0) + billedMinutes;
        saveResellerStore();
        executeAsteriskCommand(`database put reseller_balance ${cleanUser} "${cli.balance}"`).catch(() => {});
      }
    }

    // Deduct from matching Call Center Tenant if active
    const tenantsList = loadStoredTenants();
    if (Array.isArray(tenantsList) && tenantsList.length > 0) {
      const firstExtNum = parseInt(String(client || '').split('&')[0].trim(), 10);
      const tIdx = tenantsList.findIndex((t: any) => {
        if (!t) return false;
        if (tenant && String(t.id) === String(tenant)) return true;
        if (!isNaN(firstExtNum) && typeof t.extensionStart === 'number' && typeof t.extensionEnd === 'number') {
          return firstExtNum >= t.extensionStart && firstExtNum <= t.extensionEnd;
        }
        return false;
      });
      if (tIdx >= 0) {
        const targetTenant = tenantsList[tIdx];
        const tRate = Number(targetTenant.ratePerMinute) > 0 ? Number(targetTenant.ratePerMinute) : 0.015;
        const tCost = parseFloat((billedMinutes * tRate).toFixed(4));
        const newBal = Math.max(0, parseFloat(((Number(targetTenant.dollarBalance) || 0) - tCost).toFixed(2)));
        targetTenant.dollarBalance = newBal;
        targetTenant.minuteBalance = Math.floor(newBal / tRate);
        targetTenant.usedMinutes = (Number(targetTenant.usedMinutes) || 0) + billedMinutes;
        if (newBal <= 0 && targetTenant.cutoffOnZero) {
          targetTenant.status = 'low_balance';
        }
        tenantsList[tIdx] = targetTenant;
        saveStoredTenants(tenantsList);
        if (targetTenant.id) {
          executeAsteriskCommand(`database put tenant_balance ${targetTenant.id} "${newBal}"`).catch(() => {});
          executeAsteriskCommand(`database put tenant_status ${targetTenant.id} "${String(targetTenant.status || 'active')}"`).catch(() => {});
        }
        if (dest) {
          console.log(`[TENANT BILLING] ${targetTenant.name}: -${billedMinutes} min ($${tCost}) por llamada a ${dest} | Saldo restante: $${newBal}`);
        }
      }
    }

    res.json({ success: true, billedMinutes });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// ==========================================
// MEMBERSHIP ENGINE & LIFECYCLE ENDPOINTS
// ==========================================

app.get('/api/membership/overview', (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const settings = loadMembershipSettings();
    const tenantsList = loadStoredTenants();
    const usersList = loadStoredUsers();
    const requests = loadMembershipRequests();
    const myMembership = resolveEffectiveMembershipForUser(authUser, tenantsList, settings, usersList);

    if (isGlobalAdminUser(authUser)) {
      const enrichedTenants = tenantsList.map((t: any) => ({
        ...t,
        effectiveMembership: evaluateMembershipRecord(
          t?.membership,
          settings,
          'tenant',
          String(t?.id || ''),
          String(t?.name || t?.code || ''),
          countActiveAgentsForTenant(String(t?.id || ''), usersList),
          t
        ),
      }));
      const enrichedUsers = usersList.map((u: any) => sanitizeUserForClient(u));
      return res.json({
        success: true,
        settings,
        myMembership,
        myRequests: requests,
        users: enrichedUsers,
        tenants: enrichedTenants,
        requests,
      });
    }

    const myRequests = requests.filter(
      (r: any) =>
        r &&
        ((r.targetType === myMembership.scope && String(r.targetId) === String(myMembership.targetId)) ||
          String(r.requestedByUserId) === String(authUser?.id))
    );

    return res.json({
      success: true,
      settings,
      myMembership,
      myRequests,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/membership/settings', requireGlobalAdmin, (req, res) => {
  try {
    const updated = saveMembershipSettings(req.body || {});
    return res.json({
      success: true,
      settings: updated,
      message: 'Configuración global de membresías y planes Call Center guardada.',
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/membership/activate', requireGlobalAdmin, (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const {
      targetType,
      targetId,
      action,
      weeksCount,
      amountPaid,
      licensedAgents,
      customMonthPriceUsd,
      customWeeklyPriceUsd,
      clearCustomPrices,
      paymentMethod,
      reference,
      notes,
    } = req.body || {};

    if (targetType !== 'user' && targetType !== 'tenant') {
      return res.status(400).json({ success: false, error: 'targetType debe ser "user" o "tenant".' });
    }
    if (!targetId) {
      return res.status(400).json({ success: false, error: 'targetId es requerido.' });
    }
    if (!['initial_month', 'demo_1_day', 'weekly_extension', 'suspend', 'reactivate', 'plan_update', 'reset'].includes(String(action))) {
      return res.status(400).json({ success: false, error: 'Acción de membresía no válida.' });
    }

    const priceCheck = sanitizeOptionalUsdAmount(amountPaid);
    if (!priceCheck.valid) {
      return res.status(400).json({ success: false, error: priceCheck.error });
    }
    const customMonthCheck = sanitizeOptionalUsdAmount(customMonthPriceUsd);
    if (!customMonthCheck.valid) {
      return res.status(400).json({ success: false, error: customMonthCheck.error });
    }
    const customWeeklyCheck = sanitizeOptionalUsdAmount(customWeeklyPriceUsd);
    if (!customWeeklyCheck.valid) {
      return res.status(400).json({ success: false, error: customWeeklyCheck.error });
    }
    const agentsCheck = sanitizeOptionalAgentCount(licensedAgents);
    if (!agentsCheck.valid) {
      return res.status(400).json({ success: false, error: agentsCheck.error });
    }

    const settings = loadMembershipSettings();
    const performer = String(authUser?.username || authUser?.name || 'admin');

    if (targetType === 'tenant') {
      const tenantsList = loadStoredTenants();
      const idx = tenantsList.findIndex((t: any) => t && String(t.id) === String(targetId));
      if (idx === -1) {
        return res.status(404).json({ success: false, error: 'Call Center no encontrado.' });
      }
      const targetTenant = tenantsList[idx];
      const result = applyMembershipActivation(
        targetTenant.membership,
        {
          action,
          scope: 'tenant',
          weeksCount,
          amountPaid: priceCheck.value,
          licensedAgents: agentsCheck.value ?? targetTenant.licensedAgents,
          customMonthPriceUsd: customMonthCheck.value,
          customWeeklyPriceUsd: customWeeklyCheck.value,
          clearCustomPrices: Boolean(clearCustomPrices),
          paymentMethod,
          reference,
          notes,
        },
        performer,
        settings
      );
      if (!result.ok) {
        return res.status(400).json({ success: false, error: result.error });
      }
      const nextLicensedAgents = result.membership?.licensedAgents ?? targetTenant.licensedAgents;
      tenantsList[idx] = {
        ...targetTenant,
        ...(nextLicensedAgents ? { licensedAgents: nextLicensedAgents } : {}),
        membership: result.membership,
      };
      saveStoredTenants(tenantsList);
      syncMembershipToAstDb('tenant', String(targetTenant.id), result.membership);
      const effectiveMembership = evaluateMembershipRecord(
        result.membership,
        settings,
        'tenant',
        String(targetTenant.id),
        String(targetTenant.name || targetTenant.code || ''),
        countActiveAgentsForTenant(String(targetTenant.id)),
        tenantsList[idx]
      );
      return res.json({
        success: true,
        targetType: 'tenant',
        target: { ...tenantsList[idx], effectiveMembership },
        effectiveMembership,
        message:
          action === 'demo_1_day'
            ? `Demo de Prueba (${settings.demoDays} ${settings.demoDays === 1 ? 'día' : 'días'}) activado para ${targetTenant.name}.`
            : action === 'initial_month'
            ? `Plan Call Center activado para ${targetTenant.name} ($${effectiveMembership.initialActivationPriceUsd ?? 0} USD${effectiveMembership.licensedAgents ? ` • ${effectiveMembership.licensedAgents} agentes` : ''}).`
            : action === 'weekly_extension'
            ? `Membresía de ${targetTenant.name} extendida por +${Math.floor(Number(weeksCount))} semana(s) ($${effectiveMembership.lastPaidAmountUsd ?? 0} USD).`
            : action === 'plan_update'
            ? `Plan y precios personalizados actualizados para ${targetTenant.name}.`
            : `Estado de membresía actualizado para ${targetTenant.name}.`,
      });
    }

    const usersList = loadStoredUsers();
    const uIdx = usersList.findIndex((u: any) => u && String(u.id) === String(targetId));
    if (uIdx === -1) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }
    const targetUser = usersList[uIdx];
    if (isGlobalAdminUser(targetUser)) {
      return res.status(400).json({ success: false, error: 'El Super Administrador Global está exento de membresía.' });
    }
    const result = applyMembershipActivation(
      targetUser.membership,
      {
        action,
        scope: 'user',
        weeksCount,
        amountPaid: priceCheck.value,
        customMonthPriceUsd: customMonthCheck.value,
        customWeeklyPriceUsd: customWeeklyCheck.value,
        clearCustomPrices: Boolean(clearCustomPrices),
        paymentMethod,
        reference,
        notes,
      },
      performer,
      settings
    );
    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error });
    }
    usersList[uIdx] = { ...targetUser, membership: result.membership };
    saveStoredUsers(usersList);
    lastSyncedUsers = loadStoredUsers();
    syncMembershipToAstDb('user', String(targetUser.id), result.membership);
    const sanitized = sanitizeUserForClient(usersList[uIdx]);
    return res.json({
      success: true,
      targetType: 'user',
      target: sanitized,
      effectiveMembership: sanitized.effectiveMembership,
      message:
        action === 'demo_1_day'
          ? `Demo de Prueba (${settings.demoDays} ${settings.demoDays === 1 ? 'día' : 'días'}) activado para ${targetUser.name}.`
          : action === 'initial_month'
          ? `Membresía Principal activada para ${targetUser.name} ($${sanitized.effectiveMembership?.initialActivationPriceUsd ?? 0} USD).`
          : action === 'weekly_extension'
          ? `Membresía de ${targetUser.name} extendida por +${Math.floor(Number(weeksCount))} semana(s) ($${sanitized.effectiveMembership?.lastPaidAmountUsd ?? 0} USD).`
          : action === 'plan_update'
          ? `Tarifa personalizada actualizada para ${targetUser.name}.`
          : `Estado de membresía actualizado para ${targetUser.name}.`,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/membership/bulk-activate-legacy', requireGlobalAdmin, (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const settings = loadMembershipSettings();
    const performer = String(authUser?.username || authUser?.name || 'admin');
    let activatedTenants = 0;
    let activatedUsers = 0;

    const tenantsList = loadStoredTenants();
    const updatedTenants = tenantsList.map((t: any) => {
      if (t && !t.membership?.initialMonthActivated) {
        const resAct = applyMembershipActivation(
          t.membership,
          { action: 'initial_month', scope: 'tenant', amountPaid: 0, licensedAgents: t.licensedAgents, paymentMethod: 'legacy_migration', notes: 'Activación masiva inicial (1 Mes)' },
          performer,
          settings
        );
        if (resAct.ok) {
          activatedTenants += 1;
          syncMembershipToAstDb('tenant', String(t.id), resAct.membership);
          return { ...t, membership: resAct.membership };
        }
      }
      return t;
    });
    if (activatedTenants > 0) saveStoredTenants(updatedTenants);

    const usersList = loadStoredUsers();
    const updatedUsers = usersList.map((u: any) => {
      if (u && !isGlobalAdminUser(u) && !u.tenantId && !u.membership?.initialMonthActivated) {
        const resAct = applyMembershipActivation(
          u.membership,
          { action: 'initial_month', scope: 'user', amountPaid: 0, paymentMethod: 'legacy_migration', notes: 'Activación masiva inicial (1 Mes)' },
          performer,
          settings
        );
        if (resAct.ok) {
          activatedUsers += 1;
          syncMembershipToAstDb('user', String(u.id), resAct.membership);
          return { ...u, membership: resAct.membership };
        }
      }
      return u;
    });
    if (activatedUsers > 0) {
      saveStoredUsers(updatedUsers);
      lastSyncedUsers = loadStoredUsers();
    }

    return res.json({
      success: true,
      activatedTenants,
      activatedUsers,
      message: `Activación inicial aplicada: ${activatedTenants} Call Center(s) y ${activatedUsers} cliente(s) individuales activados por ${settings.initialMonthDays} días.`,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/membership/request-renewal', (req, res) => {
  try {
    const authUser = (req as any).authUser;
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Autenticación requerida.' });
    }
    if (isGlobalAdminUser(authUser)) {
      return res.status(400).json({ success: false, error: 'El Super Administrador Global no requiere membresía.' });
    }

    const {
      planType,
      weeksCount = 1,
      paymentMethod = 'transfer',
      reference = '',
      notes = '',
      payWithBalance = false,
    } = req.body || {};

    if (planType !== 'initial_month' && planType !== 'weekly_extension') {
      return res.status(400).json({ success: false, error: 'Tipo de plan no válido.' });
    }

    const settings = loadMembershipSettings();
    const tenantsList = loadStoredTenants();
    const usersList = loadStoredUsers();
    const effective = resolveEffectiveMembershipForUser(authUser, tenantsList, settings, usersList);
    if (effective.scope === 'global_admin') {
      return res.status(400).json({ success: false, error: 'Cuenta exenta.' });
    }

    if (planType === 'weekly_extension' && !effective.initialMonthActivated) {
      return res.status(400).json({
        success: false,
        error: `Primera activación obligatoria: primero debes solicitar/activar la Membresía Principal de 1 Mes (${settings.initialMonthDays} días) antes de activar semanas.`,
      });
    }

    const normalizedWeeks = planType === 'initial_month' ? 0 : Math.floor(Number(weeksCount) || 0);
    if (planType === 'weekly_extension' && (!Number.isFinite(normalizedWeeks) || normalizedWeeks < 1 || normalizedWeeks > 52)) {
      return res.status(400).json({
        success: false,
        error: 'Indica un número entero de semanas válido (mínimo 1 semana, máximo 52).',
      });
    }

    const daysCount = planType === 'initial_month' ? settings.initialMonthDays : normalizedWeeks * settings.weekDays;
    const targetTenantForReq =
      effective.scope === 'tenant'
        ? tenantsList.find((t: any) => t && String(t.id) === String(effective.targetId))
        : null;
    const reqLicensedAgents =
      effective.scope === 'tenant'
        ? (effective.licensedAgents || settings.defaultCallCenterAgents || 5)
        : undefined;
    const estimatedPriceUsd = calculateSuggestedMembershipPrice(
      effective.scope,
      planType,
      effective.scope === 'tenant' ? targetTenantForReq?.membership : effective,
      settings,
      normalizedWeeks || 1,
      reqLicensedAgents
    );

    // Optional instant self-activation from account balance if enabled by Super Admin
    if (payWithBalance && settings.allowSelfRenewalFromBalance) {
      if (effective.scope === 'tenant') {
        const tIdx = tenantsList.findIndex((t: any) => t && String(t.id) === String(effective.targetId));
        if (tIdx >= 0 && (Number(tenantsList[tIdx].dollarBalance) || 0) >= estimatedPriceUsd) {
          const targetTenant = tenantsList[tIdx];
          const resAct = applyMembershipActivation(
            targetTenant.membership,
            {
              action: planType,
              scope: 'tenant',
              weeksCount: normalizedWeeks,
              amountPaid: estimatedPriceUsd,
              licensedAgents: reqLicensedAgents,
              paymentMethod: 'saldo_prepago',
              reference: 'AUTO-SALDO',
              notes: notes || 'Auto-renovación instantánea descontada del saldo del Call Center',
            },
            String(authUser.username || authUser.id),
            settings
          );
          if (!resAct.ok) {
            return res.status(400).json({ success: false, error: resAct.error });
          }
          const newBal = Math.max(0, parseFloat(((Number(targetTenant.dollarBalance) || 0) - estimatedPriceUsd).toFixed(2)));
          const rate = Number(targetTenant.ratePerMinute) > 0 ? Number(targetTenant.ratePerMinute) : 0.015;
          tenantsList[tIdx] = {
            ...targetTenant,
            dollarBalance: newBal,
            minuteBalance: Math.floor(newBal / rate),
            ...(reqLicensedAgents ? { licensedAgents: reqLicensedAgents } : {}),
            membership: resAct.membership,
          };
          saveStoredTenants(tenantsList);
          syncMembershipToAstDb('tenant', String(targetTenant.id), resAct.membership);
          return res.json({
            success: true,
            instantActivated: true,
            myMembership: resolveEffectiveMembershipForUser(authUser, tenantsList, settings, usersList),
            message: `Membresía activada al instante con tu saldo ($${estimatedPriceUsd} USD descontados).`,
          });
        }
        return res.status(400).json({ success: false, error: `Saldo insuficiente en el Call Center ($${estimatedPriceUsd} USD requeridos).` });
      } else {
        const uIdx = usersList.findIndex((u: any) => u && String(u.id) === String(effective.targetId));
        if (uIdx >= 0 && (Number(usersList[uIdx].balance) || 0) >= estimatedPriceUsd) {
          const targetUser = usersList[uIdx];
          const resAct = applyMembershipActivation(
            targetUser.membership,
            {
              action: planType,
              scope: 'user',
              weeksCount: normalizedWeeks,
              amountPaid: estimatedPriceUsd,
              paymentMethod: 'saldo_prepago',
              reference: 'AUTO-SALDO',
              notes: notes || 'Auto-renovación instantánea descontada del saldo de usuario',
            },
            String(authUser.username || authUser.id),
            settings
          );
          if (!resAct.ok) {
            return res.status(400).json({ success: false, error: resAct.error });
          }
          const newBal = Math.max(0, parseFloat(((Number(targetUser.balance) || 0) - estimatedPriceUsd).toFixed(2)));
          usersList[uIdx] = {
            ...targetUser,
            balance: newBal,
            allocatedMinutes: Math.round(newBal / (Number(targetUser.costPerMinute) || 0.02)),
            membership: resAct.membership,
          };
          saveStoredUsers(usersList);
          lastSyncedUsers = loadStoredUsers();
          syncMembershipToAstDb('user', String(targetUser.id), resAct.membership);
          return res.json({
            success: true,
            instantActivated: true,
            myMembership: resolveEffectiveMembershipForUser(usersList[uIdx], tenantsList, settings, usersList),
            message: `Membresía activada al instante con tu saldo ($${estimatedPriceUsd} USD descontados).`,
          });
        }
        return res.status(400).json({ success: false, error: `Saldo insuficiente ($${estimatedPriceUsd} USD requeridos).` });
      }
    }

    const cleanRef = String(reference || '').trim();
    if (!cleanRef) {
      return res.status(400).json({ success: false, error: 'Ingresa una referencia o comprobante de pago para enviar la solicitud.' });
    }

    const newReq = {
      id: `mreq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      targetType: effective.scope,
      targetId: effective.targetId,
      targetName: effective.targetName,
      requestedByUserId: String(authUser.id),
      requestedByUsername: String(authUser.username || authUser.name || ''),
      planType,
      weeksCount: normalizedWeeks,
      daysCount,
      ...(reqLicensedAgents ? { licensedAgents: reqLicensedAgents } : {}),
      estimatedPriceUsd,
      paymentMethod: String(paymentMethod || 'transfer').slice(0, 40),
      reference: cleanRef.slice(0, 120),
      notes: String(notes || '').trim().slice(0, 300),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const requests = loadMembershipRequests();
    requests.unshift(newReq);
    saveMembershipRequests(requests.slice(0, 200));

    return res.json({
      success: true,
      instantActivated: false,
      request: newReq,
      message: 'Solicitud de membresía enviada. El Super Administrador revisará tu pago y activará los días.',
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/membership/requests/:requestId/resolve', requireGlobalAdmin, (req, res) => {
  try {
    const authUser = (req as any).authUser;
    const { requestId } = req.params;
    const { decision, rejectionReason, amountPaid, licensedAgents } = req.body || {};
    if (decision !== 'approve' && decision !== 'reject') {
      return res.status(400).json({ success: false, error: 'decision debe ser "approve" o "reject".' });
    }

    const priceCheck = sanitizeOptionalUsdAmount(amountPaid);
    if (!priceCheck.valid) {
      return res.status(400).json({ success: false, error: priceCheck.error });
    }
    const agentsCheck = sanitizeOptionalAgentCount(licensedAgents);
    if (!agentsCheck.valid) {
      return res.status(400).json({ success: false, error: agentsCheck.error });
    }

    const requests = loadMembershipRequests();
    const rIdx = requests.findIndex((r: any) => r && String(r.id) === String(requestId));
    if (rIdx === -1) {
      return res.status(404).json({ success: false, error: 'Solicitud no encontrada.' });
    }
    const reqItem = requests[rIdx];
    if (reqItem.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Esta solicitud ya fue procesada anteriormente.' });
    }

    const resolverName = String(authUser?.username || authUser?.name || 'admin');
    const nowIso = new Date().toISOString();

    if (decision === 'reject') {
      requests[rIdx] = {
        ...reqItem,
        status: 'rejected',
        resolvedAt: nowIso,
        resolvedBy: resolverName,
        rejectionReason: String(rejectionReason || 'Pago no verificado').trim().slice(0, 240),
      };
      saveMembershipRequests(requests);
      return res.json({ success: true, request: requests[rIdx], message: 'Solicitud rechazada.' });
    }

    const finalAmount = priceCheck.value !== undefined ? priceCheck.value : reqItem.estimatedPriceUsd;
    const finalAgents = agentsCheck.value !== undefined ? agentsCheck.value : reqItem.licensedAgents;

    const settings = loadMembershipSettings();
    if (reqItem.targetType === 'tenant') {
      const tenantsList = loadStoredTenants();
      const tIdx = tenantsList.findIndex((t: any) => t && String(t.id) === String(reqItem.targetId));
      if (tIdx === -1) {
        return res.status(404).json({ success: false, error: 'Call Center destino ya no existe.' });
      }
      const resAct = applyMembershipActivation(
        tenantsList[tIdx].membership,
        {
          action: reqItem.planType,
          scope: 'tenant',
          weeksCount: reqItem.weeksCount,
          amountPaid: finalAmount,
          licensedAgents: finalAgents ?? tenantsList[tIdx].licensedAgents,
          paymentMethod: reqItem.paymentMethod,
          reference: reqItem.reference,
          notes: `Solicitud aprobada (${reqItem.reference}) — $${finalAmount} USD`,
          requestApproved: true,
        },
        resolverName,
        settings
      );
      if (!resAct.ok) {
        return res.status(400).json({ success: false, error: resAct.error });
      }
      const nextLicensedAgents = resAct.membership?.licensedAgents ?? tenantsList[tIdx].licensedAgents;
      tenantsList[tIdx] = {
        ...tenantsList[tIdx],
        ...(nextLicensedAgents ? { licensedAgents: nextLicensedAgents } : {}),
        membership: resAct.membership,
      };
      saveStoredTenants(tenantsList);
      syncMembershipToAstDb('tenant', String(tenantsList[tIdx].id), resAct.membership);
    } else {
      const usersList = loadStoredUsers();
      const uIdx = usersList.findIndex((u: any) => u && String(u.id) === String(reqItem.targetId));
      if (uIdx === -1) {
        return res.status(404).json({ success: false, error: 'Usuario destino ya no existe.' });
      }
      const resAct = applyMembershipActivation(
        usersList[uIdx].membership,
        {
          action: reqItem.planType,
          scope: 'user',
          weeksCount: reqItem.weeksCount,
          amountPaid: finalAmount,
          paymentMethod: reqItem.paymentMethod,
          reference: reqItem.reference,
          notes: `Solicitud aprobada (${reqItem.reference}) — $${finalAmount} USD`,
          requestApproved: true,
        },
        resolverName,
        settings
      );
      if (!resAct.ok) {
        return res.status(400).json({ success: false, error: resAct.error });
      }
      usersList[uIdx] = { ...usersList[uIdx], membership: resAct.membership };
      saveStoredUsers(usersList);
      lastSyncedUsers = loadStoredUsers();
      syncMembershipToAstDb('user', String(usersList[uIdx].id), resAct.membership);
    }

    requests[rIdx] = {
      ...reqItem,
      status: 'approved',
      approvedAmountUsd: finalAmount,
      ...(finalAgents ? { licensedAgents: finalAgents } : {}),
      resolvedAt: nowIso,
      resolvedBy: resolverName,
    };
    saveMembershipRequests(requests);

    return res.json({
      success: true,
      request: requests[rIdx],
      message: `Solicitud aprobada ($${finalAmount} USD) y membresía activada para ${reqItem.targetName}.`,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Ensure any unhandled /api/* routes return JSON 404, NEVER index.html or <!doctype>
app.all('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `Ruta de API no encontrada: ${req.method} ${req.path}`,
  });
});

// ==========================================
// VITE MIDDLEWARE (DEV) & STATIC FALLBACK (PROD)
// ==========================================

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
  const httpServer = http.createServer(app);
  let viteInstance: Awaited<ReturnType<typeof createViteServer>> | null = null;

  if (!isProd) {
    const vitePromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    }).then((v) => {
      viteInstance = v;
      return v;
    });

    app.use(async (req, res, next) => {
      try {
        const vite = viteInstance || await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    const publicPath = path.join(process.cwd(), 'public');

    // Serve public static directory (including images, assets)
    if (fs.existsSync(publicPath)) {
      app.use(express.static(publicPath, {
        maxAge: '1h',
        etag: true,
      }));
    }

    // Cache static assets (JS, CSS, images, audio, webfonts) for 1 year immutable
    app.use('/assets', express.static(path.join(distPath, 'assets'), {
      maxAge: '1y',
      immutable: true,
      etag: true,
    }));
    app.use('/assets', (_req, res) => {
      res.status(404).end();
    });

    // Cache generic static public files, but NEVER cache HTML files
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      },
    }));

    // SPA fallback: index.html should revalidate so updates are immediate
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const shutdown = () => {
    try {
      viteInstance?.close().catch(() => {});
    } catch (_) {}
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Asterisk 20 Governor Server running on http://0.0.0.0:${PORT}`);
    setInterval(() => {
      try {
        const now = Date.now();
        const tenantsList = loadStoredTenants();
        let tenantsChanged = false;
        for (let i = 0; i < tenantsList.length; i++) {
          const t = tenantsList[i];
          if (t?.membership?.status === 'active' && t.membership.expiresAt && Date.parse(t.membership.expiresAt) <= now) {
            tenantsList[i] = { ...t, membership: { ...t.membership, status: 'expired' } };
            syncMembershipToAstDb('tenant', String(t.id), tenantsList[i].membership);
            tenantsChanged = true;
          }
        }
        if (tenantsChanged) saveStoredTenants(tenantsList);

        const usersList = loadStoredUsers();
        let usersChanged = false;
        for (let i = 0; i < usersList.length; i++) {
          const u = usersList[i];
          if (u?.membership?.status === 'active' && u.membership.expiresAt && Date.parse(u.membership.expiresAt) <= now) {
            usersList[i] = { ...u, membership: { ...u.membership, status: 'expired' } };
            syncMembershipToAstDb('user', String(u.id), usersList[i].membership);
            usersChanged = true;
          }
        }
        if (usersChanged) {
          saveStoredUsers(usersList);
          lastSyncedUsers = loadStoredUsers();
        }
      } catch (_) {}
    }, 60 * 1000).unref();
    if (!hasLocalAsterisk) {
      return;
    }
    // Ensure Asterisk directory structure exists
    try {
      if (!fs.existsSync('/etc/asterisk')) {
        fs.mkdirSync('/etc/asterisk', { recursive: true, mode: 0o755 });
      }
    } catch (_) {}
    // Auto-verify and provision default 8kHz audios on startup (instant PCM wave buffers)
    try {
      ensureCustomAudioFilesExist();
      setTimeout(() => {
        if (fs.existsSync('/var/run/asterisk/asterisk.ctl')) {
          applyAllActiveAssignmentsToAsterisk();
        }
      }, 5000);
    } catch (e: any) {
      console.warn('Initial audio check warning:', e.message);
    }
    // Auto-verify and repair Asterisk PJSIP configuration for extensions 1001 & 1002
    try {
      autoRepairAsteriskPjsipOnStartup();
    } catch (e: any) {
      console.warn('Initial PJSIP check warning:', e.message);
    }
  });
}

startServer();
