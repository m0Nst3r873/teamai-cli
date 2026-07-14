import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * A plugin whose daemon teamai should keep alive via the OS service manager.
 * `slug` is the teamai plugin id (already validated as filesystem-safe); it is
 * turned into a service name. `startCommand` is the descriptor's `runtime.start`
 * (e.g. `cls-codebuddy start`) — the command the service runs to launch the
 * daemon. teamai only registers the service and starts/stops it; the SDK does
 * not keep itself alive.
 */
export interface PluginServiceSpec {
  slug: string;
  startCommand: string;
}

/**
 * Deterministic OS-service name for a plugin. Prefixed so teamai only ever
 * touches services it created, and never collides with unrelated user services.
 */
export function serviceName(slug: string): string {
  return `teamai-plugin-${slug}`;
}

/** launchd reverse-DNS label for a plugin (macOS). */
export function launchdLabel(slug: string): string {
  return `com.teamai.plugin.${slug}`;
}

/** Path of the systemd user unit file for a plugin (Linux). */
export function systemdUnitPath(slug: string): string {
  return path.join(os.homedir(), '.config', 'systemd', 'user', `${serviceName(slug)}.service`);
}

/** Path of the launchd LaunchAgent plist for a plugin (macOS). */
export function launchdPlistPath(slug: string): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${launchdLabel(slug)}.plist`);
}

/**
 * Escape a value for embedding inside a single-quoted POSIX shell word. Each
 * `'` is closed, escaped, and reopened (`'\''`). The daemon command comes from
 * the trusted backend descriptor, but it is still quoted so a command with
 * spaces or shell metacharacters cannot break the generated unit/plist.
 */
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Escape a value for use in XML text/attribute content (launchd, schtasks). */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build a systemd user unit that runs the daemon through a login shell (so the
 * global npm bin is on PATH) and restarts it on crash. Installed under
 * `~/.config/systemd/user`, so it runs unprivileged and, once enabled, starts
 * on the next interactive login (boot-time start additionally needs lingering,
 * which teamai does not enable).
 */
export function buildSystemdUnit(slug: string, startCommand: string): string {
  return [
    '[Unit]',
    `Description=TeamAI plugin: ${slug}`,
    'After=default.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=/bin/sh -lc ${shSingleQuote(startCommand)}`,
    'Restart=always',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

/**
 * Build a launchd LaunchAgent plist that runs the daemon through a login shell,
 * launches it at login (`RunAtLoad`) and restarts it on exit (`KeepAlive`).
 * Installed under `~/Library/LaunchAgents`, so it runs unprivileged.
 */
export function buildLaunchdPlist(slug: string, startCommand: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${escapeXml(launchdLabel(slug))}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    '    <string>/bin/sh</string>',
    '    <string>-lc</string>',
    `    <string>${escapeXml(startCommand)}</string>`,
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/**
 * Build a Windows Task Scheduler task definition (XML). Triggers at user logon
 * and restarts on failure, running at least-privilege so no administrator is
 * required. Imported via `schtasks /Create /XML`.
 */
export function buildSchtasksXml(slug: string, startCommand: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo>',
    `    <Description>TeamAI plugin: ${escapeXml(slug)}</Description>`,
    '  </RegistrationInfo>',
    '  <Triggers>',
    '    <LogonTrigger>',
    '      <Enabled>true</Enabled>',
    '    </LogonTrigger>',
    '  </Triggers>',
    '  <Principals>',
    '    <Principal id="Author">',
    '      <LogonType>InteractiveToken</LogonType>',
    '      <RunLevel>LeastPrivilege</RunLevel>',
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <StartWhenAvailable>true</StartWhenAvailable>',
    '    <RestartOnFailure>',
    '      <Interval>PT1M</Interval>',
    '      <Count>3</Count>',
    '    </RestartOnFailure>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    '      <Command>cmd</Command>',
    `      <Arguments>/c ${escapeXml(startCommand)}</Arguments>`,
    '    </Exec>',
    '  </Actions>',
    '</Task>',
    '',
  ].join('\n');
}

/**
 * Run a service-manager CLI (systemctl / launchctl / schtasks), mapping a
 * missing binary and non-zero exit to readable errors. Output can be sizeable,
 * so the buffer is raised above the 1 MB default.
 */
async function runCli(cmd: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    const err = e as { code?: string; stderr?: string; message: string };
    if (err.code === 'ENOENT') {
      throw new Error(`${cmd} not found on PATH; cannot manage plugin services`);
    }
    const detail = (err.stderr ?? '').trim() || err.message;
    throw new Error(`${cmd} ${args.join(' ')} failed: ${detail}`);
  }
}

/**
 * Run `systemctl --user`, mapping the "no user session" failure (no user D-Bus,
 * e.g. a headless container or a Linux host without a running systemd user
 * instance) to an actionable message instead of a raw connection error.
 */
async function runSystemctlUser(args: string[]): Promise<void> {
  try {
    await runCli('systemctl', ['--user', ...args]);
  } catch (e) {
    if (/connect to .*bus/i.test((e as Error).message)) {
      throw new Error(
        'systemd user session unavailable (no user D-Bus); cannot manage plugin services on this host',
      );
    }
    throw e;
  }
}

/**
 * Register a plugin's daemon with the OS service manager for the current
 * platform: write the unit/plist/task and enable login autostart. Does not
 * start the daemon (that is `startPluginService`). Idempotent — re-registering
 * overwrites the definition. Throws on unsupported platforms.
 */
export async function registerPluginService(spec: PluginServiceSpec): Promise<void> {
  const { slug, startCommand } = spec;
  switch (process.platform) {
    case 'linux': {
      const unitPath = systemdUnitPath(slug);
      await fs.promises.mkdir(path.dirname(unitPath), { recursive: true });
      await fs.promises.writeFile(unitPath, buildSystemdUnit(slug, startCommand), 'utf8');
      await runSystemctlUser(['daemon-reload']);
      await runSystemctlUser(['enable', `${serviceName(slug)}.service`]);
      return;
    }
    case 'darwin': {
      const plistPath = launchdPlistPath(slug);
      await fs.promises.mkdir(path.dirname(plistPath), { recursive: true });
      await fs.promises.writeFile(plistPath, buildLaunchdPlist(slug, startCommand), 'utf8');
      // The plist under ~/Library/LaunchAgents is auto-loaded at next login;
      // starting now is done by startPluginService.
      return;
    }
    case 'win32': {
      const xmlPath = path.join(os.tmpdir(), `${serviceName(slug)}.xml`);
      // schtasks /Create /XML requires the file's byte encoding to match the
      // XML declaration (UTF-16); a UTF-8 file under a UTF-16 declaration is
      // rejected as malformed. Write UTF-16LE with a BOM.
      await fs.promises.writeFile(xmlPath, '\ufeff' + buildSchtasksXml(slug, startCommand), 'utf16le');
      try {
        await runCli('schtasks', ['/Create', '/TN', serviceName(slug), '/XML', xmlPath, '/F']);
      } finally {
        await fs.promises.rm(xmlPath, { force: true });
      }
      return;
    }
    default:
      throw new Error(`Plugin services are not supported on platform "${process.platform}"`);
  }
}

/** Start a plugin's already-registered service now. Throws on unsupported platforms. */
export async function startPluginService(slug: string): Promise<void> {
  switch (process.platform) {
    case 'linux':
      await runSystemctlUser(['start', `${serviceName(slug)}.service`]);
      return;
    case 'darwin': {
      const domain = `gui/${process.getuid?.() ?? ''}`;
      // `bootstrap` fails if the service is already loaded, so bootout first
      // (ignoring "not loaded") to make a repeated start idempotent.
      await runCli('launchctl', ['bootout', `${domain}/${launchdLabel(slug)}`]).catch(() => {});
      await runCli('launchctl', ['bootstrap', domain, launchdPlistPath(slug)]);
      return;
    }
    case 'win32':
      await runCli('schtasks', ['/Run', '/TN', serviceName(slug)]);
      return;
    default:
      throw new Error(`Plugin services are not supported on platform "${process.platform}"`);
  }
}

/** Stop a plugin's running service. Throws on unsupported platforms. */
export async function stopPluginService(slug: string): Promise<void> {
  switch (process.platform) {
    case 'linux':
      await runSystemctlUser(['stop', `${serviceName(slug)}.service`]);
      return;
    case 'darwin':
      await runCli('launchctl', ['bootout', `gui/${process.getuid?.() ?? ''}/${launchdLabel(slug)}`]);
      return;
    case 'win32':
      await runCli('schtasks', ['/End', '/TN', serviceName(slug)]);
      return;
    default:
      throw new Error(`Plugin services are not supported on platform "${process.platform}"`);
  }
}

/**
 * Stop a plugin's service and remove its OS registration (unit / plist / task),
 * so uninstalling the package does not leave an orphaned, auto-restarting
 * service pointing at a now-missing binary. Each teardown step is best-effort:
 * a service that is already stopped or absent is not an error.
 */
export async function deregisterPluginService(slug: string): Promise<void> {
  switch (process.platform) {
    case 'linux': {
      await runSystemctlUser(['stop', `${serviceName(slug)}.service`]).catch(() => {});
      await runSystemctlUser(['disable', `${serviceName(slug)}.service`]).catch(() => {});
      await fs.promises.rm(systemdUnitPath(slug), { force: true });
      await runSystemctlUser(['daemon-reload']).catch(() => {});
      return;
    }
    case 'darwin': {
      await runCli('launchctl', ['bootout', `gui/${process.getuid?.() ?? ''}/${launchdLabel(slug)}`]).catch(() => {});
      await fs.promises.rm(launchdPlistPath(slug), { force: true });
      return;
    }
    case 'win32': {
      await runCli('schtasks', ['/End', '/TN', serviceName(slug)]).catch(() => {});
      await runCli('schtasks', ['/Delete', '/TN', serviceName(slug), '/F']).catch(() => {});
      return;
    }
    default:
      throw new Error(`Plugin services are not supported on platform "${process.platform}"`);
  }
}
