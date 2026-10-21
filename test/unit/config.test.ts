import { describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig, resolveGitHubToken } from '../../src/config.js';

describe('loadConfig', () => {
  it('applies defaults for optional settings', () => {
    expect(loadConfig({ GITHUB_TOKEN: 'ghp_x' })).toEqual({
      github: { token: 'ghp_x', apiUrl: undefined },
      logLevel: 'info',
      extraSensitivePaths: [],
      checklistsDir: undefined,
    });
  });

  it('reads all settings', () => {
    const config = loadConfig({
      GITHUB_TOKEN: ' ghp_x ',
      GITHUB_API_URL: 'https://ghe.corp.io/api/v3',
      DEVFLOW_LOG_LEVEL: 'debug',
      DEVFLOW_SENSITIVE_PATHS: 'src/payments/**, infra/** ,,',
      DEVFLOW_CHECKLISTS_DIR: '/team/checklists',
    });
    expect(config.checklistsDir).toBe('/team/checklists');
    expect(config.github).toEqual({ token: 'ghp_x', apiUrl: 'https://ghe.corp.io/api/v3' });
    expect(config.logLevel).toBe('debug');
    expect(config.extraSensitivePaths).toEqual(['src/payments/**', 'infra/**']);
  });

  it('treats a missing or blank GITHUB_TOKEN as unset', () => {
    expect(loadConfig({}).github.token).toBeUndefined();
    expect(loadConfig({ GITHUB_TOKEN: '  ' }).github.token).toBeUndefined();
  });

  it('fails fast with a readable message listing every problem', () => {
    expect(() => loadConfig({ GITHUB_API_URL: 'not a url', DEVFLOW_LOG_LEVEL: 'loud' })).toThrow(
      ConfigError,
    );
    try {
      loadConfig({ GITHUB_API_URL: 'not a url', DEVFLOW_LOG_LEVEL: 'loud' });
    } catch (error) {
      expect((error as Error).message).toContain('GITHUB_API_URL must be a valid URL');
      expect((error as Error).message).toContain('DEVFLOW_LOG_LEVEL');
    }
  });
});

describe('resolveGitHubToken', () => {
  it('prefers GITHUB_TOKEN and never runs the GitHub CLI', async () => {
    const run = vi.fn();
    await expect(resolveGitHubToken({ token: 'ghp_env', apiUrl: undefined }, run)).resolves.toEqual(
      { token: 'ghp_env', source: 'env' },
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('falls back to the GitHub CLI login', async () => {
    const run = vi.fn().mockResolvedValue('gho_cli\n');
    await expect(resolveGitHubToken({ token: undefined, apiUrl: undefined }, run)).resolves.toEqual(
      { token: 'gho_cli', source: 'gh' },
    );
    expect(run).toHaveBeenCalledWith('gh', ['auth', 'token']);
  });

  it('tries known install paths when gh is not on PATH', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce('gho_brew');
    await expect(resolveGitHubToken({ token: undefined, apiUrl: undefined }, run)).resolves.toEqual(
      { token: 'gho_brew', source: 'gh' },
    );
    expect(run).toHaveBeenLastCalledWith('/opt/homebrew/bin/gh', ['auth', 'token']);
  });

  it('asks gh for the Enterprise host when GITHUB_API_URL points at one', async () => {
    const run = vi.fn().mockResolvedValue('gho_ghe');
    await resolveGitHubToken({ token: undefined, apiUrl: 'https://ghe.corp.io/api/v3' }, run);
    expect(run).toHaveBeenCalledWith('gh', ['auth', 'token', '--hostname', 'ghe.corp.io']);
  });

  it('explains both ways to sign in when no token is available', async () => {
    const run = vi.fn().mockRejectedValue(new Error('not logged in'));
    const result = resolveGitHubToken({ token: undefined, apiUrl: undefined }, run);
    await expect(result).rejects.toThrow(ConfigError);
    await expect(result).rejects.toThrow(/gh auth login.*\n.*GITHUB_TOKEN/s);
  });
});
