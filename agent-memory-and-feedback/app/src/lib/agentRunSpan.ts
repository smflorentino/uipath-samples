import type { RawSpan } from './traceTree';

/**
 * Returns the `Id` of the trace's `agentRun` span — the one the LLM Ops
 * Feedback API keys feedback against.
 *
 * The agentRun span is *not* always the trace root. Jobs launched by
 * Orchestrator have outer execution spans (`RobotJob`, `RunJob`,
 * `RunJob.WaitForJob`, …) wrapping the agent invocation, so the agentRun
 * lives several levels deep. We search the flat span list for the unique
 * `SpanType === 'agentRun'` entry rather than walking only roots.
 *
 * Returns null when no agentRun span is present — callers should block
 * feedback submission in that case.
 */
export function findRootAgentRunSpanId(spans: RawSpan[]): string | null {
  if (!spans || spans.length === 0) return null;
  const agentRunSpan = spans.find((s) => s.SpanType === 'agentRun');
  return agentRunSpan?.Id ?? null;
}
