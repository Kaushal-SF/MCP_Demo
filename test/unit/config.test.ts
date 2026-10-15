import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('applies defaults for optional settings', () => {
    expect(loadConfig({ GITHUB_TOKEN: 'ghp_x' })).toEqual({
      github: { token: 'ghp_x', apiUrl: undefined },
      logLevel: 'info',
      extraSensitivePaths: [],
    });
  });

  it('reads all settings', () => {
    const config = loadConfig({
      GITHUB_TOKEN: ' ghp_x ',
      GITHUB_API_URL: 'https://ghe.corp.io/api/v3',
      DEVFLOW_LOG_LEVEL: 'debug',
      DEVFLOW_SENSITIVE_PATHS: 'src/payments/**, infra/** ,,',
    });
    expect(config.github).toEqual({ token: 'ghp_x', apiUrl: 'https://ghe.corp.io/api/v3' });
    expect(config.logLevel).toBe('debug');
    expect(config.extraSensitivePaths).toEqual(['src/payments/**', 'infra/**']);
  });

  it('fails fast with a readable message listing every problem', () => {
    expect(() => loadConfig({ GITHUB_API_URL: 'not a url', DEVFLOW_LOG_LEVEL: 'loud' })).toThrow(
      ConfigError,
    );
    try {
      loadConfig({ GITHUB_API_URL: 'not a url' });
    } catch (error) {
      expect((error as Error).message).toContain('GITHUB_TOKEN is required');
      expect((error as Error).message).toContain('GITHUB_API_URL must be a valid URL');
    }
  });
});
