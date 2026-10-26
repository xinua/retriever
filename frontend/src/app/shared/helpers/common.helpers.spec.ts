import { versionStatus } from './common.helpers';

describe('versionStatus', () => {
  it('reports an update when a newer version is published', () => {
    expect(versionStatus('1.0.3', '1.0.4')).toBe('update');
    expect(versionStatus('1.0.9', '1.0.10')).toBe('update');
    expect(versionStatus('1.3.1-rc1', '1.3.1')).toBe('update');
  });

  it('reports a build newer than the published one as ahead', () => {
    expect(versionStatus('1.0.4', '1.0.3')).toBe('ahead');
    expect(versionStatus('1.0.10', '1.0.9')).toBe('ahead');
  });

  it('reports the same version as current, with or without a leading v', () => {
    expect(versionStatus('1.0.4', '1.0.4')).toBe('current');
    expect(versionStatus('v1.0.4', '1.0.4')).toBe('current');
  });

  it('reports unknown when either side is missing or not a version', () => {
    expect(versionStatus(null, '1.0.4')).toBe('unknown');
    expect(versionStatus('1.0.4', undefined)).toBe('unknown');
    expect(versionStatus('1.0.4', 'latest')).toBe('unknown');
  });
});
