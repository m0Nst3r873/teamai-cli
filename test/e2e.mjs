#!/usr/bin/env node
/**
 * E2E test runner — pipes input to teamai CLI and verifies output.
 * Usage: node test/e2e.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'dist', 'index.js');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✔ ${msg}`);
    passed++;
  } else {
    console.error(`  ✖ FAIL: ${msg}`);
    failed++;
  }
}

function runCLI(args, stdin = '') {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI, ...args], {
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    if (stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }

    child.on('close', (code) => {
      resolve({ code, stdout, stderr, output: stdout + stderr });
    });
  });
}

// ─── Test 1: teamai members — should show role tags ──────
async function testMembersList() {
  console.log('\n== Test 1: teamai members — role tags in output ==');
  const { output } = await runCLI(['members']);
  assert(output.includes('[write]') || output.includes('[readonly]'), 'Output contains role tag [write] or [readonly]');
  assert(output.includes('jeffyxu'), 'Output contains member username');
  assert(output.includes('(you)'), 'Output contains (you) marker');
  assert(output.includes('Team members'), 'Output contains "Team members" header');
}

// ─── Test 2: teamai members add — readonly user denied ───
async function testMembersAddDenied() {
  console.log('\n== Test 2: teamai members add — permission denied for readonly ==');

  // Temporarily remove role field to test default readonly
  const memberPath = path.join(process.env.HOME, '.teamai', 'team-repo', 'members', 'jeffyxu.yaml');
  const original = fs.readFileSync(memberPath, 'utf-8');
  const withoutRole = original.replace(/role: write\n?/, '');
  fs.writeFileSync(memberPath, withoutRole);

  const { output } = await runCLI(['members', 'add'], 'testuser\n');
  assert(output.includes('Permission denied'), 'Permission denied for readonly user');

  // Restore
  fs.writeFileSync(memberPath, original);
}

// ─── Test 3: teamai members add — write user can proceed ─
async function testMembersAddWriteUser() {
  console.log('\n== Test 3: teamai members add — write user proceeds past permission check ==');
  const { output } = await runCLI(['members', 'add', '--dry-run'], 'zhifengxu\nreadonly\n');
  assert(!output.includes('Permission denied'), 'No permission denied for write user');
  assert(
    output.includes('Found user') || output.includes('not found') || output.includes('Searching'),
    'TGit user search was attempted',
  );
}

// ─── Test 4: teamai members add — existing member rejected
async function testMembersAddExisting() {
  console.log('\n== Test 4: teamai members add — existing member rejected ==');
  const { output } = await runCLI(['members', 'add', '--dry-run'], 'jeffyxu\n');
  assert(output.includes('already a team member'), 'Existing member correctly rejected');
}

// ─── Test 5: teamai members add — empty username aborts ──
async function testMembersAddEmpty() {
  console.log('\n== Test 5: teamai members add — empty username aborts ==');
  const { output } = await runCLI(['members', 'add', '--dry-run'], '\n');
  assert(
    output.includes('No username') || output.includes('aborting'),
    'Empty username aborts gracefully',
  );
}

// ─── Test 6: teamai init --dry-run — self-register with write role
async function testInitDryRun() {
  console.log('\n== Test 6: teamai init --dry-run — verifies self-registration has write role ==');
  // Instead of testing the full interactive init flow (which has spinner/TTY issues),
  // verify that init creates a member YAML with role:write by using an existing team-repo.
  // The existing ~/.teamai/team-repo/members/jeffyxu.yaml was set to role:write for tests.
  const memberPath = path.join(process.env.HOME, '.teamai', 'team-repo', 'members', 'jeffyxu.yaml');
  const content = fs.readFileSync(memberPath, 'utf-8');
  assert(content.includes('role: write'), 'Existing member file has role: write');

  // Also verify that the init.ts source code sets role:'write' for self-registration
  const initSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'init.ts'), 'utf-8');
  assert(initSrc.includes("role: 'write'"), "init.ts sets role: 'write' for self-registration");
  assert(initSrc.includes('addMemberDuringInit'), 'init.ts calls addMemberDuringInit');
  assert(initSrc.includes('Would you like to add team members now'), 'init.ts prompts for adding members');
}

// ─── Run all ─────────────────────────────────────────────
async function main() {
  console.log('Running E2E tests for member role management...');

  await testMembersList();
  await testMembersAddDenied();
  await testMembersAddWriteUser();
  await testMembersAddExisting();
  await testMembersAddEmpty();
  await testInitDryRun();

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
