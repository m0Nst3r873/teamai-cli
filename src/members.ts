import YAML from 'yaml';
import path from 'node:path';
import readline from 'node:readline';
import { requireInit } from './config.js';
import { readFileSafe, listFiles, writeFile, pathExists } from './utils/fs.js';
import { pushRepo, pullRepo } from './utils/git.js';
import { searchUsers, addProjectMember, updateProjectMember } from './utils/tgit-api.js';
import { parseRepoInput } from './utils/repo-url.js';
import { log, spinner } from './utils/logger.js';
import { MemberConfigSchema, ROLE_TO_ACCESS_LEVEL, type MemberRole } from './types.js';
import type { GlobalOptions, MemberConfig } from './types.js';

function askQuestion(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Read a specific member's config from the repo.
 */
export async function getMemberConfig(repoPath: string, username: string): Promise<MemberConfig | null> {
  const memberPath = path.join(repoPath, 'members', `${username}.yaml`);
  const content = await readFileSafe(memberPath);
  if (!content) return null;
  try {
    const raw = YAML.parse(content);
    return MemberConfigSchema.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Check that the given user has 'write' role. Throws if not.
 */
export async function requireWriteRole(repoPath: string, username: string): Promise<void> {
  const member = await getMemberConfig(repoPath, username);
  if (!member) {
    throw new Error(`You (${username}) are not a registered member. Run \`teamai init\` first.`);
  }
  if (member.role !== 'write') {
    throw new Error(`Permission denied: ${username} has '${member.role}' role. 'write' role is required.`);
  }
}

export async function listMembers(options: GlobalOptions): Promise<void> {
  const { localConfig } = await requireInit();
  const membersDir = path.join(localConfig.repo.localPath, 'members');
  const files = await listFiles(membersDir);
  const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

  if (yamlFiles.length === 0) {
    log.info('No team members registered');
    return;
  }

  console.log('');
  console.log(`Team members (${yamlFiles.length}):`);
  console.log('');

  for (const file of yamlFiles) {
    const content = await readFileSafe(path.join(membersDir, file));
    if (!content) continue;
    try {
      const raw = YAML.parse(content);
      const member = MemberConfigSchema.parse(raw);
      const isSelf = member.username === localConfig.username;
      const marker = isSelf ? ' (you)' : '';
      const display = member.displayName ? ` — ${member.displayName}` : '';
      const roleTag = ` [${member.role}]`;
      console.log(`  ${member.username}${display}${roleTag}${marker}`);
      if (options.verbose) {
        console.log(`    registered: ${member.registeredAt}`);
      }
    } catch {
      log.warn(`Invalid member file: ${file}`);
    }
  }
  console.log('');
}

/**
 * `teamai members add` — interactively add a member with role and TGit access.
 */
export async function addMember(options: GlobalOptions): Promise<void> {
  const { localConfig, teamConfig } = await requireInit();
  const repoPath = localConfig.repo.localPath;

  // Pull latest before checking permissions
  const pullSpin = spinner('Pulling latest team repo...').start();
  try {
    await pullRepo(repoPath);
    pullSpin.succeed('Team repo up to date');
  } catch (e) {
    pullSpin.warn(`Pull failed: ${(e as Error).message}`);
  }

  // Check write permission
  await requireWriteRole(repoPath, localConfig.username);

  // Prompt for username
  const username = await askQuestion('Username to add: ');
  if (!username) {
    log.info('No username provided, aborting.');
    return;
  }

  // Check if already a member
  if (await pathExists(path.join(repoPath, 'members', `${username}.yaml`))) {
    log.warn(`${username} is already a team member.`);
    return;
  }

  // Search TGit for the user
  const searchSpin = spinner(`Searching for user ${username}...`).start();
  const users = await searchUsers(username);
  const user = users.find((u) => u.username === username);
  if (!user) {
    searchSpin.fail(`User '${username}' not found on TGit`);
    return;
  }
  searchSpin.succeed(`Found user: ${user.username} (${user.name})`);

  // Prompt for role
  const roleInput = await askQuestion('Role (readonly/write) [readonly]: ');
  const role: MemberRole = roleInput === 'write' ? 'write' : 'readonly';
  const accessLevel = ROLE_TO_ACCESS_LEVEL[role];

  // Set TGit project access
  let repoInfo;
  try {
    repoInfo = parseRepoInput(teamConfig.repo);
  } catch {
    repoInfo = parseRepoInput(localConfig.repo.remote);
  }

  const tgitSpin = spinner('Setting TGit project access...').start();
  try {
    try {
      await addProjectMember(repoInfo.projectId, user.id, accessLevel);
    } catch {
      // User may already be a member — update instead
      await updateProjectMember(repoInfo.projectId, user.id, accessLevel);
    }
    tgitSpin.succeed(`TGit access level set to ${accessLevel} (${role})`);
  } catch (e) {
    tgitSpin.fail(`Failed to set TGit access: ${(e as Error).message}`);
    log.warn('Continuing with local member file creation...');
  }

  // Create member YAML
  const memberYaml = YAML.stringify({
    username: user.username,
    displayName: user.name || user.username,
    registeredAt: new Date().toISOString(),
    role,
  });
  await writeFile(path.join(repoPath, 'members', `${username}.yaml`), memberYaml);

  // Push
  if (!options.dryRun) {
    const pushSpin = spinner('Pushing member config...').start();
    try {
      await pushRepo(repoPath, `[teamai] Add member: ${username} (${role})`, [
        `members/${username}.yaml`,
      ]);
      pushSpin.succeed(`Member ${username} added with role: ${role}`);
    } catch (e) {
      pushSpin.fail(`Push failed: ${(e as Error).message}`);
    }
  } else {
    log.success(`Member ${username} added with role: ${role} (dry-run)`);
  }
}

/**
 * Add members during `teamai init` — simplified loop without permission check.
 */
export async function addMemberDuringInit(
  repoPath: string,
  repoUrl: string,
  dryRun?: boolean,
): Promise<void> {
  const addedMembers: string[] = [];

  let repoInfo;
  try {
    repoInfo = parseRepoInput(repoUrl);
  } catch {
    log.warn('Could not parse repo URL for TGit API calls. Skipping TGit access setup.');
    repoInfo = null;
  }

  while (true) {
    const username = await askQuestion('\nAdd a team member (username, or press Enter to skip): ');
    if (!username) break;

    // Check if already exists
    if (await pathExists(path.join(repoPath, 'members', `${username}.yaml`))) {
      log.warn(`${username} is already a team member, skipping.`);
      continue;
    }

    // Search TGit for the user
    const searchSpin = spinner(`Searching for user ${username}...`).start();
    let user;
    try {
      const users = await searchUsers(username);
      user = users.find((u) => u.username === username);
    } catch (e) {
      searchSpin.fail(`Search failed: ${(e as Error).message}`);
      continue;
    }

    if (!user) {
      searchSpin.fail(`User '${username}' not found on TGit`);
      continue;
    }
    searchSpin.succeed(`Found user: ${user.username} (${user.name})`);

    // Prompt for role
    const roleInput = await askQuestion('Role (readonly/write) [readonly]: ');
    const role: MemberRole = roleInput === 'write' ? 'write' : 'readonly';
    const accessLevel = ROLE_TO_ACCESS_LEVEL[role];

    // Set TGit project access
    if (repoInfo) {
      try {
        try {
          await addProjectMember(repoInfo.projectId, user.id, accessLevel);
        } catch {
          await updateProjectMember(repoInfo.projectId, user.id, accessLevel);
        }
      } catch (e) {
        log.warn(`Failed to set TGit access for ${username}: ${(e as Error).message}`);
      }
    }

    // Create member YAML
    const memberYaml = YAML.stringify({
      username: user.username,
      displayName: user.name || user.username,
      registeredAt: new Date().toISOString(),
      role,
    });
    await writeFile(path.join(repoPath, 'members', `${username}.yaml`), memberYaml);
    log.success(`Added ${username} with role: ${role}`);
    addedMembers.push(username);
  }

  if (addedMembers.length > 0 && !dryRun) {
    const pushSpin = spinner(`Pushing ${addedMembers.length} new member(s) to team repo...`).start();
    try {
      await pushRepo(
        repoPath,
        `[teamai] Add members: ${addedMembers.join(', ')}`,
        addedMembers.map((u) => `members/${u}.yaml`),
      );
      pushSpin.succeed(`Pushed ${addedMembers.length} new member(s) to team repo`);
    } catch (e) {
      pushSpin.fail(`Push failed: ${(e as Error).message}`);
    }
  }
}
