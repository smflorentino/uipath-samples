import { useActiveAgentTarget } from '../config/agentTargets';

interface FieldSpec {
  label: string;
  value: string | number | undefined | null;
  mono?: boolean;
  hint?: string;
}

function FieldList({ fields }: { fields: FieldSpec[] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-[max-content,1fr] gap-x-6 gap-y-3 text-sm">
      {fields.map((f) => (
        <div key={f.label} className="contents">
          <dt className="text-xs uppercase tracking-wide text-gray-500 pt-0.5">{f.label}</dt>
          <dd
            className={`text-gray-900 break-all ${f.mono ? 'font-mono text-xs' : ''}`}
            data-testid={`setting-${f.label.toLowerCase().replace(/\s+/g, '-')}`}
          >
            {f.value == null || f.value === '' ? (
              <span className="text-gray-400 italic">— not set —</span>
            ) : (
              String(f.value)
            )}
            {f.hint && <div className="text-xs text-gray-500 italic mt-0.5">{f.hint}</div>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SettingsPanel() {
  const t = useActiveAgentTarget();

  const agentFields: FieldSpec[] = [
    { label: 'Process name', value: t.match.processName, mono: true, hint: "OData filter: ReleaseName eq '<this>'" },
    { label: 'Process key', value: t.match.processKey, mono: true, hint: 'Informational — captured from a recent agentRun span.' },
    { label: 'Agent ID', value: t.agentId, mono: true, hint: 'Sent in the LLM Ops Feedback POST body.' },
    {
      label: 'Agent version',
      value: '—',
      hint: 'Resolved dynamically per draft from Jobs.getById(...).processVersion at submit time.',
    },
  ];

  const folderFields: FieldSpec[] = [
    { label: 'Folder name', value: t.match.folderName },
    { label: 'Folder key', value: t.match.folderKey, mono: true, hint: 'Sent as x-uipath-folderkey on the Feedback POST.' },
    { label: 'Folder ID', value: t.match.folderId, mono: true, hint: 'Used as the Jobs.getById folder context.' },
    { label: 'Tenant', value: t.match.tenantName, hint: 'Tenant slug where the agent is deployed.' },
  ];

  const dataFabricFields: FieldSpec[] = t.dataFabric
    ? [
        { label: 'Drafts entity ID', value: t.dataFabric.draftsEntityId, mono: true },
        { label: 'Disputes entity ID', value: t.dataFabric.disputesEntityId, mono: true },
        { label: 'Job key field', value: t.dataFabric.jobKeyField, mono: true },
        { label: 'Dispute ID field', value: t.dataFabric.disputeIdField, mono: true },
        { label: 'Subject field', value: t.dataFabric.subjectField, mono: true },
        { label: 'Body field', value: t.dataFabric.bodyField, mono: true },
      ]
    : [];

  const memorySpaceFields: FieldSpec[] = t.memorySpace
    ? [
        { label: 'Memory name', value: t.memorySpace.memoryName },
        { label: 'Memory ID', value: t.memorySpace.memoryId, mono: true },
        {
          label: 'Memory folder key',
          value: t.memorySpace.memoryFolderKey,
          mono: true,
          hint: 'X-UiPath-FolderKey sent on the ingest POST.',
        },
        {
          label: 'Internal tenant ID',
          value: t.memorySpace.internalTenantIdGuid,
          mono: true,
          hint: 'Tenant GUID used in /api/Agent/* URL paths and X-UiPath-Internal-TenantId.',
        },
        {
          label: 'Internal account ID',
          value: t.memorySpace.internalAccountId,
          mono: true,
          hint: 'Org-level account GUID sent in X-UiPath-Internal-AccountId.',
        },
      ]
    : [];

  return (
    <div className="max-w-3xl space-y-6" data-testid="settings-panel">
      <header>
        <h2 className="text-xl font-semibold text-gray-900">Settings</h2>
        <p className="text-sm text-gray-600 max-w-2xl mt-1">
          Active agent target — these values are used to look up jobs and traces and to
          chain feedback through the LLM Ops API. Edit{' '}
          <span className="font-mono text-xs">src/config/agentTargets.ts</span> to change them.
        </p>
      </header>

      <section className="bg-white rounded-lg border border-gray-200">
        <header className="px-5 py-3 border-b">
          <h3 className="text-sm font-semibold text-gray-800">{t.tabLabel}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
        </header>
        <div className="px-5 py-4 space-y-6">
          <div>
            <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-3">Agent</h4>
            <FieldList fields={agentFields} />
          </div>
          <div>
            <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-3">Orchestrator folder</h4>
            <FieldList fields={folderFields} />
          </div>
          {dataFabricFields.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-3">Data Fabric</h4>
              <FieldList fields={dataFabricFields} />
            </div>
          )}
          {memorySpaceFields.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-3">
                Agent Memory space
              </h4>
              <FieldList fields={memorySpaceFields} />
            </div>
          )}
        </div>
      </section>

      <p className="text-xs text-gray-500 italic">
        Read-only for now. A future version of this page will let admins edit these values
        without redeploying the app.
      </p>
    </div>
  );
}

export default SettingsPanel;
