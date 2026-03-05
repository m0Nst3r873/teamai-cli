export interface RepoInfo {
  owner: string;
  repo: string;
  httpsUrl: string;
  /** URL-encoded owner/repo for TGit API */
  projectId: string;
}

const TGIT_HOST = 'git.woa.com';

/**
 * Parse user input into a standardized RepoInfo structure.
 * Supports:
 *   - Short format: `owner/repo`
 *   - HTTPS URL:    `https://git.woa.com/owner/repo.git`
 *   - SSH URL:      `git@git.woa.com:owner/repo.git`
 */
export function parseRepoInput(input: string): RepoInfo {
  const trimmed = input.trim();

  // HTTPS URL
  const httpsMatch = trimmed.match(
    /^https?:\/\/git\.woa\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  );
  if (httpsMatch) {
    return buildRepoInfo(httpsMatch[1], httpsMatch[2]);
  }

  // SSH URL
  const sshMatch = trimmed.match(
    /^git@git\.woa\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  );
  if (sshMatch) {
    return buildRepoInfo(sshMatch[1], sshMatch[2]);
  }

  // Short format: owner/repo (no slashes beyond the single separator)
  const shortMatch = trimmed.match(/^([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)$/);
  if (shortMatch) {
    return buildRepoInfo(shortMatch[1], shortMatch[2]);
  }

  throw new Error(
    `Unrecognized repo format: "${trimmed}"\n` +
      '  Supported formats:\n' +
      '    owner/repo\n' +
      `    https://${TGIT_HOST}/owner/repo.git\n` +
      `    git@${TGIT_HOST}:owner/repo.git`,
  );
}

function buildRepoInfo(owner: string, repo: string): RepoInfo {
  return {
    owner,
    repo,
    httpsUrl: `https://${TGIT_HOST}/${owner}/${repo}.git`,
    projectId: encodeURIComponent(`${owner}/${repo}`),
  };
}
