import { describe, expect, it } from 'vitest';
import { buildAgentsImUrl, buildJobDetailUrl, buildMemorySpaceUrl } from './orchestratorLinks';

describe('buildJobDetailUrl', () => {
  it('matches the user-supplied reference URL for the Memory tenant (and strips `.api.` from the API base)', () => {
    const url = buildJobDetailUrl({
      baseUrl: 'https://cloud.api.uipath.com',
      orgName: 'your-org',
      tenantName: 'Memory',
      tenantIdLong: '999999',
      folderId: 999999,
      jobKey: 'e96d6373-127d-45f8-b0af-8cf94f68b2f4',
    });
    expect(url).toBe(
      'https://cloud.uipath.com/your-org/Memory/orchestrator_/jobs(sidepanel:sidepanel/jobs/e96d6373-127d-45f8-b0af-8cf94f68b2f4/traces/:id)?tid=999999&fid=999999',
    );
  });

  it('leaves a portal-host baseUrl unchanged (no `.api.` to strip)', () => {
    const url = buildJobDetailUrl({
      baseUrl: 'https://cloud.uipath.com',
      orgName: 'your-org',
      tenantName: 'Memory',
      tenantIdLong: '999999',
      folderId: 999999,
      jobKey: 'abc',
    });
    expect(url.startsWith('https://cloud.uipath.com/')).toBe(true);
  });

  it('serializes the folderId as a decimal string in the `fid` param', () => {
    const url = buildJobDetailUrl({
      baseUrl: 'https://x.example',
      orgName: 'org',
      tenantName: 'Tenant',
      tenantIdLong: '1',
      folderId: 42,
      jobKey: 'k',
    });
    expect(url).toContain('fid=42');
    expect(url).toContain('tid=1');
  });
});

describe('buildMemorySpaceUrl', () => {
  it('builds the agents-portal URL on the portal host (stripping `.api.`)', () => {
    expect(
      buildMemorySpaceUrl({
        baseUrl: 'https://cloud.api.uipath.com',
        orgName: 'your-org',
        memoryId: '44444444-4444-4444-4444-444444444444',
      }),
    ).toBe(
      'https://cloud.uipath.com/your-org/agents_/memory/44444444-4444-4444-4444-444444444444',
    );
  });
});

describe('buildAgentsImUrl', () => {
  it('matches the user-supplied reference URL for the Perf Tests setup', () => {
    expect(
      buildAgentsImUrl({
        baseUrl: 'https://cloud.api.uipath.com',
        orgName: 'your-org',
        folderKey: '22222222-2222-2222-2222-222222222222',
        processKey: '55555555-5555-5555-5555-555555555555',
        agentId: '33333333-3333-3333-3333-333333333333',
        version: '1.0.3',
        tab: 'feedback',
      }),
    ).toBe(
      'https://cloud.uipath.com/your-org/agents_/deployed/22222222-2222-2222-2222-222222222222/55555555-5555-5555-5555-555555555555/33333333-3333-3333-3333-333333333333/1.0.3?tab=feedback',
    );
  });

  it('omits the query string when tab is undefined', () => {
    const u = buildAgentsImUrl({
      baseUrl: 'https://x.example',
      orgName: 'org',
      folderKey: 'fk',
      processKey: 'pk',
      agentId: 'aid',
      version: '2.0.0',
    });
    expect(u.endsWith('/org/agents_/deployed/fk/pk/aid/2.0.0')).toBe(true);
  });
});
