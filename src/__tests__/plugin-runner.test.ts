import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

// execFile is mocked so service-manager argument logic and error mapping can be
// tested without spawning systemctl/launchctl/schtasks.
const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => (execFileMock as (...a: unknown[]) => void)(...args),
}));

const {
  serviceName,
  launchdLabel,
  systemdUnitPath,
  launchdPlistPath,
  buildSystemdUnit,
  buildLaunchdPlist,
  buildSchtasksXml,
  registerPluginService,
  startPluginService,
  stopPluginService,
  deregisterPluginService,
} = await import('../plugin-runner.js');

const originalPlatform = process.platform;
function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

beforeEach(() => {
  execFileMock.mockReset();
  // Default: npm-style success callback.
  execFileMock.mockImplementation((_c, _a, _o, cb: (e: unknown, r: unknown) => void) =>
    cb(null, { stdout: '', stderr: '' }));
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  vi.restoreAllMocks();
});

describe('plugin-runner: naming and paths', () => {
  it('derives a prefixed service name and launchd label', () => {
    expect(serviceName('cls-codebuddy')).toBe('teamai-plugin-cls-codebuddy');
    expect(launchdLabel('cls-codebuddy')).toBe('com.teamai.plugin.cls-codebuddy');
  });

  it('places the systemd unit and launchd plist in the user config dirs', () => {
    expect(systemdUnitPath('foo')).toMatch(/\.config\/systemd\/user\/teamai-plugin-foo\.service$/);
    expect(launchdPlistPath('foo')).toMatch(/Library\/LaunchAgents\/com\.teamai\.plugin\.foo\.plist$/);
  });
});

describe('plugin-runner: service file content', () => {
  it('builds a systemd unit that runs via login shell and restarts', () => {
    const unit = buildSystemdUnit('foo', 'cls-codebuddy start');
    expect(unit).toContain("ExecStart=/bin/sh -lc 'cls-codebuddy start'");
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('WantedBy=default.target');
  });

  it('single-quote-escapes a start command in the systemd unit', () => {
    const unit = buildSystemdUnit('foo', "run 'x'");
    // Each embedded quote is closed/escaped/reopened so the unit stays valid.
    expect(unit).toContain(`ExecStart=/bin/sh -lc 'run '\\''x'\\'''`);
  });

  it('builds a launchd plist with RunAtLoad and KeepAlive', () => {
    const plist = buildLaunchdPlist('foo', 'cls-codebuddy start');
    expect(plist).toContain('<string>com.teamai.plugin.foo</string>');
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<string>cls-codebuddy start</string>');
  });

  it('xml-escapes special characters in the launchd plist', () => {
    const plist = buildLaunchdPlist('foo', 'run a && b <x>');
    expect(plist).toContain('<string>run a &amp;&amp; b &lt;x&gt;</string>');
  });

  it('builds a schtasks task with logon trigger, restart-on-failure and least privilege', () => {
    const xml = buildSchtasksXml('foo', 'cls-codebuddy start');
    expect(xml).toContain('<LogonTrigger>');
    expect(xml).toContain('<RestartOnFailure>');
    expect(xml).toContain('<RunLevel>LeastPrivilege</RunLevel>');
    expect(xml).toContain('<Arguments>/c cls-codebuddy start</Arguments>');
  });

  it('xml-escapes the command in the schtasks arguments', () => {
    const xml = buildSchtasksXml('foo', 'run a & b');
    expect(xml).toContain('<Arguments>/c run a &amp; b</Arguments>');
  });
});

describe('plugin-runner: register/start/stop on linux', () => {
  it('writes the unit then daemon-reloads and enables it', async () => {
    setPlatform('linux');
    const mkdir = vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined as never);
    const writeFile = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined as never);

    await registerPluginService({ slug: 'foo', startCommand: 'cls-codebuddy start' });

    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/teamai-plugin-foo\.service$/),
      expect.stringContaining('ExecStart='),
      'utf8',
    );
    const calls = execFileMock.mock.calls.map((c) => [c[0], (c[1] as string[]).join(' ')]);
    expect(calls).toContainEqual(['systemctl', '--user daemon-reload']);
    expect(calls).toContainEqual(['systemctl', '--user enable teamai-plugin-foo.service']);
  });

  it('starts and stops via systemctl --user', async () => {
    setPlatform('linux');
    await startPluginService('foo');
    expect(execFileMock).toHaveBeenCalledWith(
      'systemctl', ['--user', 'start', 'teamai-plugin-foo.service'], expect.any(Object), expect.any(Function));

    execFileMock.mockClear();
    await stopPluginService('foo');
    expect(execFileMock).toHaveBeenCalledWith(
      'systemctl', ['--user', 'stop', 'teamai-plugin-foo.service'], expect.any(Object), expect.any(Function));
  });

  it('maps a missing service-manager binary to a clear error', async () => {
    setPlatform('linux');
    execFileMock.mockImplementation((_c, _a, _o, cb: (e: unknown) => void) =>
      cb(Object.assign(new Error('spawn systemctl ENOENT'), { code: 'ENOENT' })));
    await expect(startPluginService('foo')).rejects.toThrow(/systemctl not found on PATH/);
  });

  it('maps a missing systemd user session to an actionable error', async () => {
    setPlatform('linux');
    execFileMock.mockImplementation((_c, _a, _o, cb: (e: unknown) => void) =>
      cb(Object.assign(new Error('exit 1'), { stderr: 'Failed to connect to bus: No medium found' })));
    await expect(startPluginService('foo')).rejects.toThrow(/systemd user session unavailable/);
  });
});

describe('plugin-runner: start/deregister idempotency', () => {
  it('boots out a stale instance before bootstrapping on macOS (idempotent start)', async () => {
    setPlatform('darwin');
    await startPluginService('foo');
    const verbs = execFileMock.mock.calls.map((c) => (c[1] as string[])[0]);
    // bootout must precede bootstrap so a repeated start does not fail as
    // "already loaded".
    expect(verbs).toEqual(['bootout', 'bootstrap']);
  });

  it('does not fail start on macOS when the stale bootout errors', async () => {
    setPlatform('darwin');
    execFileMock.mockImplementation((_c, args: string[], _o, cb: (e: unknown, r?: unknown) => void) => {
      if (args[0] === 'bootout') return cb(Object.assign(new Error('exit 1'), { stderr: 'not loaded' }));
      return cb(null, { stdout: '', stderr: '' });
    });
    await expect(startPluginService('foo')).resolves.toBeUndefined();
  });

  it('stops, disables, removes the unit and reloads on linux deregister', async () => {
    setPlatform('linux');
    const rm = vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined as never);
    await deregisterPluginService('foo');
    const cmds = execFileMock.mock.calls.map((c) => (c[1] as string[]).join(' '));
    expect(cmds).toContain('--user stop teamai-plugin-foo.service');
    expect(cmds).toContain('--user disable teamai-plugin-foo.service');
    expect(cmds).toContain('--user daemon-reload');
    expect(rm).toHaveBeenCalledWith(expect.stringMatching(/teamai-plugin-foo\.service$/), { force: true });
  });

  it('deregister tolerates a service that was never running', async () => {
    setPlatform('linux');
    vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined as never);
    execFileMock.mockImplementation((_c, _a, _o, cb: (e: unknown) => void) =>
      cb(Object.assign(new Error('exit 5'), { stderr: 'Unit teamai-plugin-foo.service not loaded.' })));
    await expect(deregisterPluginService('foo')).resolves.toBeUndefined();
  });
});

describe('plugin-runner: register on windows', () => {
  it('writes the schtasks XML as UTF-16LE with a BOM and imports it', async () => {
    setPlatform('win32');
    let written: { data: unknown; enc: unknown } | undefined;
    vi.spyOn(fs.promises, 'writeFile').mockImplementation(
      (async (_p: unknown, d: unknown, e: unknown) => { written = { data: d, enc: e }; }) as never);
    vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined as never);

    await registerPluginService({ slug: 'foo', startCommand: 'cls start' });

    // schtasks rejects a file whose bytes do not match the declared UTF-16
    // encoding, so it must be written as UTF-16LE with a leading BOM.
    expect(written?.enc).toBe('utf16le');
    expect((written?.data as string).charCodeAt(0)).toBe(0xfeff);
    expect(execFileMock).toHaveBeenCalledWith(
      'schtasks',
      expect.arrayContaining(['/Create', '/TN', 'teamai-plugin-foo', '/XML', '/F']),
      expect.any(Object), expect.any(Function));
  });
});

describe('plugin-runner: unsupported platform', () => {
  it('throws for an unknown platform', async () => {
    setPlatform('sunos');
    await expect(registerPluginService({ slug: 'foo', startCommand: 'x' }))
      .rejects.toThrow(/not supported on platform "sunos"/);
    await expect(startPluginService('foo')).rejects.toThrow(/not supported on platform "sunos"/);
    await expect(stopPluginService('foo')).rejects.toThrow(/not supported on platform "sunos"/);
  });
});
