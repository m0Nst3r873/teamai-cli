import { execSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathExists, ensureDir } from './fs.js';
import { log, spinner } from './logger.js';
import { TEAMAI_HOME } from '../types.js';

/** Path where gf CLI is installed */
const GF_INSTALL_DIR = path.join(TEAMAI_HOME, 'gf');
const GF_BIN_PATH = path.join(GF_INSTALL_DIR, 'gf', 'bin', 'gf');

/** Download base URL for gf CLI tarballs */
const GF_DOWNLOAD_BASE = 'http://mirrors.tencent.com/repository/generic/gongfeng-cli/files/channels/stable';

// ─── Core helpers ────────────────────────────────────────

/**
 * Execute a gf CLI command.
 * gf launcher is a bash script, so we wrap with `bash -c` for compatibility.
 * Returns { stdout, stderr, status }.
 */
export function gfExec(
  args: string[],
  options?: { inheritStdio?: boolean },
): { stdout: string; stderr: string; status: number } {
  const gfPath = getGfPath();
  const cmd = `${gfPath} ${args.join(' ')}`;
  log.debug(`gf exec: ${cmd}`);

  if (options?.inheritStdio) {
    const result = spawnSync('bash', ['-c', cmd], {
      stdio: 'inherit',
      env: { ...process.env },
    });
    return { stdout: '', stderr: '', status: result.status ?? 1 };
  }

  const result = spawnSync('bash', ['-c', cmd], {
    env: { ...process.env },
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });

  return {
    stdout: (result.stdout ?? '').toString().trim(),
    stderr: (result.stderr ?? '').toString().trim(),
    status: result.status ?? 1,
  };
}

/**
 * Get the path to gf binary (installed location or system PATH).
 */
function getGfPath(): string {
  // Prefer our managed install
  try {
    const stat = execSync(`test -x "${GF_BIN_PATH}" && echo ok`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (stat.trim() === 'ok') return GF_BIN_PATH;
  } catch {
    // not installed locally
  }

  // Fall back to system PATH
  try {
    const which = execSync('which gf', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (which.trim()) return which.trim();
  } catch {
    // not in PATH
  }

  throw new Error(
    'gf CLI not found. Run `teamai init` to install it automatically.',
  );
}

// ─── Installation ────────────────────────────────────────

/**
 * Detect the download URL for the current platform.
 */
function getGfDownloadUrl(): string {
  const arch = os.arch(); // 'x64', 'arm64', etc.
  const platform = os.platform(); // 'darwin', 'linux'

  let osName: string;
  if (platform === 'darwin') {
    osName = 'darwin';
  } else if (platform === 'linux') {
    osName = 'linux';
  } else {
    throw new Error(`Unsupported platform: ${platform}. gf CLI only supports macOS and Linux.`);
  }

  let archName: string;
  if (arch === 'x64') {
    archName = 'x64';
  } else if (arch === 'arm64') {
    archName = 'arm64';
  } else {
    throw new Error(`Unsupported architecture: ${arch}. gf CLI only supports x64 and arm64.`);
  }

  return `${GF_DOWNLOAD_BASE}/gf-${osName}-${archName}.tar.gz`;
}

/**
 * Check if gf is installed (either locally or in PATH). Returns true if available.
 */
export function isGfInstalled(): boolean {
  try {
    getGfPath();
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure gf CLI is installed. Downloads to ~/.teamai/gf/ if not found.
 */
export async function ensureGfInstalled(): Promise<void> {
  if (isGfInstalled()) {
    log.debug('gf CLI already installed');
    return;
  }

  const url = getGfDownloadUrl();
  const spin = spinner('Installing gf CLI (工蜂命令行工具)...').start();

  try {
    await ensureDir(GF_INSTALL_DIR);

    // Download and extract tarball
    execSync(
      `curl -fsSL "${url}" | tar xz -C "${GF_INSTALL_DIR}"`,
      { stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000 },
    );

    // Verify installation
    execSync(`test -x "${GF_BIN_PATH}"`, { stdio: ['pipe', 'pipe', 'pipe'] });

    spin.succeed(`gf CLI installed to ${GF_INSTALL_DIR}`);
  } catch (e) {
    spin.fail(`Failed to install gf CLI: ${(e as Error).message}`);
    log.info(`You can install it manually from: ${url}`);
    log.info(`Extract to: ${GF_INSTALL_DIR}`);
    throw e;
  }
}

// ─── Authentication ──────────────────────────────────────

/**
 * Check if gf is authenticated. Returns true if `gf auth whoami` succeeds.
 */
export function gfIsAuthenticated(): boolean {
  try {
    const result = gfExec(['auth', 'whoami']);
    return result.status === 0 && result.stdout.includes('当前登录用户');
  } catch {
    return false;
  }
}

/**
 * Get the current authenticated username from `gf auth whoami`.
 * Output format: "当前登录用户：<username>"
 */
export function gfAuthWhoami(): string | null {
  try {
    const result = gfExec(['auth', 'whoami']);
    if (result.status !== 0) return null;

    // Parse "当前登录用户：<username>" or similar
    const output = result.stdout;
    const match = output.match(/当前登录用户[：:]\s*(\S+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Run `gf auth login` interactively (inherits stdio for user interaction).
 * Supports iOA, browser device code flow, and manual token input.
 */
export function gfAuthLogin(): void {
  log.info('Starting gf authentication...');
  const result = gfExec(['auth', 'login'], { inheritStdio: true });
  if (result.status !== 0) {
    throw new Error('gf auth login failed. Please try again.');
  }
}

/**
 * Ensure user is authenticated. Checks whoami, triggers login if needed.
 * Returns the authenticated username.
 */
export function ensureAuthenticated(): string {
  // First check if already authenticated
  const username = gfAuthWhoami();
  if (username) {
    return username;
  }

  // Not authenticated — trigger interactive login
  gfAuthLogin();

  // Verify login succeeded
  const verifiedUsername = gfAuthWhoami();
  if (!verifiedUsername) {
    throw new Error('Authentication failed. Please run `teamai init` again.');
  }
  return verifiedUsername;
}

// ─── Repo operations ─────────────────────────────────────

/**
 * Clone a repo using `gf repo clone`.
 * The remote URL will have the OAuth token embedded, so subsequent
 * git pull/push via simple-git will work without extra auth.
 */
export function gfRepoClone(repo: string, localPath: string): void {
  const result = gfExec(['repo', 'clone', repo, localPath]);
  if (result.status !== 0) {
    const errMsg = result.stderr || result.stdout;
    // Check for common "not found" patterns
    if (errMsg.includes('404') || errMsg.includes('not found') || errMsg.includes('不存在')) {
      throw new Error(
        `Repo "${repo}" not found on TGit.\n` +
        `  Create it at: https://git.woa.com/projects/new`,
      );
    }
    throw new Error(`gf repo clone failed: ${errMsg}`);
  }
}

// ─── Merge Request ───────────────────────────────────────

export interface GfMrCreateOptions {
  /** Repository in "owner/repo" format */
  repo: string;
  /** Source branch name */
  source: string;
  /** Target branch name (usually 'master') */
  target: string;
  /** MR title */
  title: string;
  /** MR description */
  description?: string;
  /** Reviewer usernames (gf accepts usernames directly, no ID lookup needed) */
  reviewers?: string[];
}

/**
 * Create a Merge Request using `gf mr create`.
 * Returns the MR web URL on success.
 */
export function gfMrCreate(opts: GfMrCreateOptions): string {
  const args = [
    'mr', 'create',
    '-R', opts.repo,
    '-s', opts.source,
    '-T', opts.target,
    '-t', JSON.stringify(opts.title),
  ];

  if (opts.description) {
    args.push('-d', JSON.stringify(opts.description));
  }

  if (opts.reviewers && opts.reviewers.length > 0) {
    args.push('-r', opts.reviewers.join(','));
  }

  const result = gfExec(args);
  if (result.status !== 0) {
    const errMsg = result.stderr || result.stdout;
    throw new Error(`gf mr create failed: ${errMsg}`);
  }

  // Try to extract MR URL from output
  const output = result.stdout;
  const urlMatch = output.match(/https:\/\/git\.woa\.com\/[^\s]+merge_requests\/\d+/);
  if (urlMatch) {
    return urlMatch[0];
  }

  // Fallback: construct URL from repo and try to find MR number
  const mrNumMatch = output.match(/!(\d+)/);
  if (mrNumMatch) {
    return `https://git.woa.com/${opts.repo}/-/merge_requests/${mrNumMatch[1]}`;
  }

  // Return the raw output as the "URL" if we can't parse it
  return output || `https://git.woa.com/${opts.repo}/-/merge_requests`;
}
