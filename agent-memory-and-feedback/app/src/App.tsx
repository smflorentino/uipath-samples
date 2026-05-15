import { useEffect, useMemo, useState } from 'react';
import {
  HashRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import type { UiPathSDKConfig } from '@uipath/uipath-typescript/core';
import { Processes } from '@uipath/uipath-typescript/processes';
import type { ProcessGetResponse } from '@uipath/uipath-typescript/processes';
import { TraceViewer } from './components/TraceViewer';
import { DisputeDraftsPanel } from './components/DisputeDraftsPanel';
import { FeedbackTriagePanel } from './components/FeedbackTriagePanel';
import { SettingsPanel } from './components/SettingsPanel';
import {
  AGENT_TARGETS,
  setActiveAgentTargetKey,
  useActiveAgentTarget,
  useActiveAgentTargetKey,
  type AgentTargetKey,
} from './config/agentTargets';
import { useFolders } from './hooks/useFolders';
import { useJobsForFolder } from './hooks/useJobsForFolder';
import { useTenants } from './hooks/useTenants';
import { getActiveTenant, setActiveTenant } from './lib/activeTenant';
import logoUrl from './assets/path-industries-logo.jpg';

const buildAuthConfig = (tenantName: string): UiPathSDKConfig => ({
  clientId: import.meta.env.VITE_UIPATH_CLIENT_ID,
  orgName: import.meta.env.VITE_UIPATH_ORG_NAME,
  tenantName,
  baseUrl: import.meta.env.VITE_UIPATH_BASE_URL,
  redirectUri: window.location.origin + window.location.pathname,
  scope: import.meta.env.VITE_UIPATH_SCOPE,
});

// Tab routing is URL-driven via react-router-dom; no `Tab` enum needed.

function ProcessesPanel() {
  const { sdk } = useAuth();
  const processes = useMemo(() => new Processes(sdk), [sdk]);
  const [items, setItems] = useState<ProcessGetResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await processes.getAll({ pageSize: 50 });
        if (!cancelled) setItems(result.items);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load processes');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [processes]);

  if (loading) return <div className="p-4 text-gray-500">Loading processes...</div>;
  if (error) return <div className="p-4 text-red-600">{error}</div>;
  if (items.length === 0) return <div className="p-4 text-gray-500">No processes found.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Folder</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Package</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Version</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {items.map((p) => (
            <tr key={p.id} className="hover:bg-gray-50">
              <td className="px-4 py-2 text-sm font-medium text-gray-900">{p.name}</td>
              <td className="px-4 py-2 text-sm text-gray-700">{p.folderName ?? '—'}</td>
              <td className="px-4 py-2 text-sm text-gray-700">{p.packageKey}</td>
              <td className="px-4 py-2 text-sm text-gray-700">{p.packageVersion}</td>
              <td className="px-4 py-2 text-sm text-gray-700">{p.packageType ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobsPanel() {
  const folders = useFolders();
  const jobsResult = useJobsForFolder({
    folderId: folders.selectedFolder?.id ?? null,
    pageSize: 50,
  });

  const [openTrace, setOpenTrace] = useState<{ traceId: string; jobKey: string; jobLabel?: string } | null>(null);

  if (folders.loading) return <div className="p-4 text-gray-500">Loading folders...</div>;
  if (folders.error && folders.folders.length === 0)
    return <div className="p-4 text-red-600">{folders.error}</div>;
  if (folders.folders.length === 0) return <div className="p-4 text-gray-500">No folders found.</div>;

  const selected = folders.selectedFolder;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <aside className="md:col-span-1">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Folders</h3>
          <ul className="border border-gray-200 rounded divide-y divide-gray-200 bg-white max-h-[70vh] overflow-y-auto">
            {folders.folders.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => folders.setSelectedFolder(f)}
                  className={`w-full text-left py-2 text-sm hover:bg-gray-50 ${
                    selected?.id === f.id ? 'bg-blue-50 text-blue-800 font-medium' : 'text-gray-800'
                  }`}
                  style={{ paddingLeft: `${12 + f.level * 16}px`, paddingRight: '12px' }}
                  title={f.fullyQualifiedName}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate flex-1">{f.displayName}</span>
                    {f.folderType === 'Personal' && (
                      <span className="text-[10px] uppercase tracking-wide text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded">
                        Personal
                      </span>
                    )}
                    {f.folderType === 'Solution' && (
                      <span className="text-[10px] uppercase tracking-wide text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                        Solution
                      </span>
                    )}
                  </div>
                  {f.level === 0 && f.fullyQualifiedName !== f.displayName && (
                    <div className="text-xs text-gray-500 truncate">{f.fullyQualifiedName}</div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="md:col-span-3">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Jobs in {selected?.displayName}{' '}
            {jobsResult.loading && <span className="text-gray-400">(loading...)</span>}
          </h3>
          {jobsResult.error && (
            <div className="mb-2 p-2 bg-red-50 text-red-700 text-sm rounded">{jobsResult.error}</div>
          )}
          {jobsResult.jobs.length === 0 && !jobsResult.loading ? (
            <div className="text-sm text-gray-500">No jobs in this folder.</div>
          ) : (
            <div className="overflow-x-auto bg-white rounded border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Process</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">State</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Started</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Ended</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Key</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {jobsResult.jobs.map((j) => {
                    const hasTrace = typeof j.traceId === 'string' && j.traceId.length > 0;
                    return (
                      <tr
                        key={j.key}
                        data-testid="job-row"
                        data-job-key={j.key}
                        data-trace-id={j.traceId ?? ''}
                        className={`hover:bg-blue-50 ${hasTrace ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
                        onClick={() => {
                          if (hasTrace && j.traceId) {
                            setOpenTrace({
                              traceId: j.traceId,
                              jobKey: j.key,
                              jobLabel: j.processName ?? undefined,
                            });
                          }
                        }}
                        title={hasTrace ? 'View trace' : 'No trace recorded'}
                      >
                        <td className="px-3 py-2 text-sm text-gray-900">{j.processName ?? '—'}</td>
                        <td className="px-3 py-2 text-sm">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${stateBadge(String(j.state))}`}>
                            {String(j.state)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-700">{j.startTime ? new Date(j.startTime).toLocaleString() : '—'}</td>
                        <td className="px-3 py-2 text-sm text-gray-700">{j.endTime ? new Date(j.endTime).toLocaleString() : '—'}</td>
                        <td className="px-3 py-2 text-xs text-gray-500 font-mono">{j.key.slice(0, 8)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {openTrace && (
        <TraceViewer
          traceId={openTrace.traceId}
          jobKey={openTrace.jobKey}
          jobLabel={openTrace.jobLabel}
          onClose={() => setOpenTrace(null)}
        />
      )}
    </>
  );
}

function stateBadge(state: string): string {
  const s = state.toLowerCase();
  if (s.includes('success')) return 'bg-emerald-100 text-emerald-800';
  if (s.includes('fault') || s.includes('error') || s.includes('stopped')) return 'bg-red-100 text-red-800';
  if (s.includes('running')) return 'bg-blue-100 text-blue-800';
  if (s.includes('pending')) return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-800';
}

function TenantSwitcher({
  current,
  onChange,
}: {
  current: string;
  onChange: (name: string) => void;
}) {
  const { tenants, loading, error } = useTenants();

  if (loading) {
    return (
      <div className="text-sm text-gray-500" data-testid="tenant-switcher-loading">
        Loading tenants…
      </div>
    );
  }
  if (error || tenants.length === 0) {
    return (
      <div className="text-sm text-gray-600" data-testid="tenant-info" title={current}>
        Tenant: <span className="font-medium text-gray-900">{current}</span>
      </div>
    );
  }
  return (
    <label className="flex items-center gap-2 text-sm text-gray-600" data-testid="tenant-switcher">
      <span className="text-gray-400">Tenant</span>
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="border border-gray-300 rounded px-2 py-1 text-sm font-medium text-gray-900 bg-white"
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.name}>
            {t.name}
            {t.region ? ` · ${t.region}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Global picker for the active agent target. All tabs (Drafts, Feedback
 * Triage, Settings) re-render off `useActiveAgentTarget()`, so flipping
 * this dropdown changes which agent's folder, processes, and entities the
 * app is working against. Choice persists to localStorage.
 */
function AgentTargetSwitcher({ current }: { current: AgentTargetKey }) {
  return (
    <label
      className="flex items-center gap-2 text-sm text-gray-600"
      data-testid="agent-target-switcher"
    >
      <span className="text-gray-400">Setup</span>
      <select
        value={current}
        onChange={(e) => setActiveAgentTargetKey(e.target.value as AgentTargetKey)}
        title={AGENT_TARGETS[current].target.match.folderName ?? current}
        className="border border-gray-300 rounded px-2 py-1 text-sm font-medium text-gray-900 bg-white"
      >
        {Object.entries(AGENT_TARGETS).map(([key, entry]) => (
          <option key={key} value={key} title={entry.target.match.folderName}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function AppContent({
  tenantName,
  onTenantChange,
}: {
  tenantName: string;
  onTenantChange: (name: string) => void;
}) {
  const { isAuthenticated, isLoading, error, login, logout } = useAuth();
  const activeTarget = useActiveAgentTarget();
  const activeTargetKey = useActiveAgentTargetKey();

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (error) return <div className="p-8 text-red-600">Error: {error}</div>;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <div
          className="h-1.5"
          style={{
            background:
              'linear-gradient(90deg, #1f7a80 0%, #2a8e94 35%, #e8722a 100%)',
          }}
          aria-hidden="true"
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-lg w-full bg-white rounded-lg shadow p-10 text-center">
            <img
              src={logoUrl}
              alt="PATH Industries"
              className="h-56 w-auto mx-auto mb-6"
            />
            <h1 className="text-2xl font-semibold mb-1 text-gray-900">Resolution Drafts</h1>
            <p className="text-sm text-gray-600 mb-6">Sign in with your UiPath account to continue.</p>
            <button
              onClick={login}
              className="w-full py-2 px-4 rounded text-white font-medium"
              style={{
                background: 'linear-gradient(90deg, #1f7a80 0%, #2a8e94 100%)',
              }}
            >
              Sign in with UiPath
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Brand gradient strip — teal → orange to match the PATH Industries logo */}
      <div
        className="h-1.5"
        style={{
          background:
            'linear-gradient(90deg, #1f7a80 0%, #2a8e94 35%, #e8722a 100%)',
        }}
        aria-hidden="true"
      />
      <header className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center gap-4">
          <div className="flex items-center gap-5 min-w-0">
            <img
              src={logoUrl}
              alt="PATH Industries"
              className="h-[120px] w-auto"
              data-testid="brand-logo"
            />
            <span className="hidden sm:inline-block h-14 w-px bg-gray-200" aria-hidden="true" />
            <span className="hidden sm:inline-block text-base uppercase tracking-wide text-gray-500">
              Customer Management
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">
              Org: <span className="font-medium text-gray-900">{import.meta.env.VITE_UIPATH_ORG_NAME}</span>
            </span>
            <TenantSwitcher current={tenantName} onChange={onTenantChange} />
            <AgentTargetSwitcher current={activeTargetKey} />
            <button
              onClick={logout}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Sign out
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6">
          <nav className="flex gap-4 -mb-px">
            <TabLink to="/processes">Processes</TabLink>
            <TabLink to="/jobs">Jobs</TabLink>
            <TabLink to="/drafts">{activeTarget.tabLabel}</TabLink>
            {activeTarget.memorySpace && (
              <TabLink to="/feedback-triage">Feedback Triage</TabLink>
            )}
            <TabLink to="/settings">Settings</TabLink>
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-6">
        <Routes>
          <Route path="/processes" element={<ProcessesPanel />} />
          <Route path="/jobs" element={<JobsPanel />} />
          <Route path="/drafts" element={<DisputeDraftsPanel />} />
          <Route path="/drafts/:disputeId" element={<DisputeDraftsPanel />} />
          <Route path="/feedback-triage" element={<FeedbackTriagePanel />} />
          <Route path="/feedback-triage/:feedbackId" element={<FeedbackTriagePanel />} />
          <Route path="/settings" element={<SettingsPanel />} />
          <Route path="*" element={<Navigate to="/processes" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function TabLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `py-2 px-1 border-b-2 text-sm font-medium ${
          isActive
            ? 'border-blue-600 text-blue-700'
            : 'border-transparent text-gray-600 hover:text-gray-900'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

function App() {
  const [tenantName, setTenantName] = useState<string>(() => getActiveTenant());

  const onTenantChange = (next: string) => {
    if (next === tenantName) return;
    setActiveTenant(next);
    setTenantName(next);
  };

  const config = useMemo(() => buildAuthConfig(tenantName), [tenantName]);

  return (
    // Re-mount AuthProvider on tenant switch so the SDK re-initializes with the
    // new tenantName. The OAuth token is org-scoped, so the user stays signed in.
    <HashRouter>
      <AuthProvider key={tenantName} config={config}>
        <AppContent tenantName={tenantName} onTenantChange={onTenantChange} />
      </AuthProvider>
    </HashRouter>
  );
}

export default App;
