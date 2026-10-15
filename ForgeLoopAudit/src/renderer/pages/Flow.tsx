import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  BackgroundVariant,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ProjectSnapshot, TaskSummary, ForgeLoopPhase } from '@shared/domain';
import { PHASE_ORDER } from '@shared/domain';
import { FlowNode } from '../components/flow/FlowNode';
import { OwnershipBadge } from '../components/task/OwnershipBadge';
import { InspectorPanel } from '../components/inspectors/InspectorPanel';
import { Shield } from 'lucide-react';

interface FlowProps {
  snapshot: ProjectSnapshot;
  selectedTaskId?: string | null;
  onSelectedTaskChange?: (taskId: string) => void;
}

const nodeTypes = { flowNode: FlowNode as any };

const PHASE_DISPLAY: Record<ForgeLoopPhase, { label: string; x: number; y: number }> = {
  RECEIVED: { label: 'RECEIVED', x: 250, y: 0 },
  DISCOVERING: { label: 'DISCOVERING', x: 250, y: 80 },
  CONTRACT_READY: { label: 'CONTRACT_READY', x: 250, y: 160 },
  ROUTED: { label: 'ROUTED', x: 250, y: 240 },
  DESIGNING: { label: 'DESIGNING', x: 250, y: 320 },
  PLANNED: { label: 'PLANNED', x: 250, y: 400 },
  EXECUTING: { label: 'EXECUTING', x: 250, y: 480 },
  VERIFYING: { label: 'VERIFYING', x: 250, y: 560 },
  DIAGNOSING: { label: 'DIAGNOSING', x: 100, y: 640 },
  CORRECTING: { label: 'CORRECTING', x: 100, y: 720 },
  REVIEWING: { label: 'REVIEWING', x: 250, y: 800 },
  COMPLETE: { label: 'COMPLETE', x: 250, y: 880 },
  BLOCKED: { label: 'BLOCKED', x: 400, y: 560 },
};

const PHASE_EDGES: [ForgeLoopPhase, ForgeLoopPhase][] = [
  ['RECEIVED', 'DISCOVERING'],
  ['DISCOVERING', 'CONTRACT_READY'],
  ['CONTRACT_READY', 'ROUTED'],
  ['ROUTED', 'DESIGNING'],
  ['DESIGNING', 'PLANNED'],
  ['PLANNED', 'EXECUTING'],
  ['EXECUTING', 'VERIFYING'],
  ['VERIFYING', 'REVIEWING'],
  ['REVIEWING', 'COMPLETE'],
  ['VERIFYING', 'DIAGNOSING'],
  ['DIAGNOSING', 'CORRECTING'],
  ['CORRECTING', 'EXECUTING'],
  ];

export function Flow({ snapshot, selectedTaskId, onSelectedTaskChange }: FlowProps) {
  const [selectedTask, setSelectedTask] = useState<TaskSummary | null>(
    snapshot.tasks.find((t) => t.taskId === selectedTaskId) || snapshot.tasks.find((t) => t.taskId === snapshot.activeTaskId) || snapshot.tasks[0] || null
  );
  const [inspectorOpen, setInspectorOpen] = useState(false);
  useEffect(() => {
    setSelectedTask(snapshot.tasks.find((t) => t.taskId === selectedTaskId) || snapshot.tasks.find((t) => t.taskId === snapshot.activeTaskId) || snapshot.tasks[0] || null);
  }, [snapshot, selectedTaskId]);

  const getPhaseState = useCallback((phase: ForgeLoopPhase, task: TaskSummary): 'completed' | 'current' | 'pending' | 'blocked' | 'failed' => {
    if (task.phase === 'BLOCKED') {
      if (phase === 'BLOCKED') return 'blocked';
      if (phase === task.previousPhase) return 'failed';
      if (task.completedSteps.some((step) => step === phase || step.includes(phase))) return 'completed';
      return 'pending';
    }
    if (task.phase === phase) return 'current';
    if (task.phase === 'COMPLETE') return 'completed';

    if (task.phase === 'DIAGNOSING') {
      if (phase === 'VERIFYING') return 'failed';
      if (phase === 'DIAGNOSING') return 'current';
    }

    if (task.phase === 'CORRECTING') {
      if (phase === 'VERIFYING') return 'failed';
      if (phase === 'DIAGNOSING') return 'completed';
      if (phase === 'CORRECTING') return 'current';
    }

    const currentPhaseOrder = PHASE_ORDER[task.phase] ?? 0;
    const phaseOrder = PHASE_ORDER[phase] ?? 0;

    if (phaseOrder < currentPhaseOrder) return 'completed';

    if (task.phase === 'VERIFYING' && phase === 'EXECUTING') return 'completed';

    return 'pending';
  }, []);

  const nodes: Node[] = useMemo(() => {
    if (!selectedTask) return [];

    return (Object.keys(PHASE_DISPLAY) as ForgeLoopPhase[]).map((phase) => {
      const display = PHASE_DISPLAY[phase];
      const state = getPhaseState(phase, selectedTask);
      const hasEvents = selectedTask.checks.some((c) => {
        const eventPhases: Record<string, ForgeLoopPhase> = {
          'passed': 'VERIFYING',
          'failed': 'VERIFYING',
        };
        return eventPhases[c.status] === phase;
      });

      return {
        id: phase,
        type: 'flowNode',
        position: { x: display.x, y: display.y },
        data: {
          label: display.label,
          phase,
          state,
          hasEvents,
          taskId: selectedTask.taskId,
        },
        selectable: true,
      };
    });
  }, [selectedTask, getPhaseState]);

  const edges: Edge[] = useMemo(() => {
    const blockedEdge: [ForgeLoopPhase, ForgeLoopPhase][] = selectedTask?.phase === 'BLOCKED' && selectedTask.previousPhase
      ? [[selectedTask.previousPhase, 'BLOCKED']]
      : [];
    return [...PHASE_EDGES, ...blockedEdge].map(([source, target]) => ({
      id: `${source}-${target}`,
      source,
      target,
      type: 'smoothstep',
      animated: false,
      style: { stroke: '#303038', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#303038' },
    }));
  }, [selectedTask]);

  const handleNodeClick = useCallback(() => {
    setInspectorOpen(true);
  }, []);

  if (snapshot.tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-forge-text-muted">No tasks to visualize</p>
      </div>
    );
  }

  return (
    <div className="h-full flex animate-fade-in">
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-forge-text-primary">Lifecycle Flow</h1>
            <p className="text-sm text-forge-text-muted mt-1">ForgeLoop protocol lifecycle visualization</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedTask && (
              <div className="flex items-center gap-2 mr-2">
                <span className="text-xs text-forge-text-muted">Ownership:</span>
                <OwnershipBadge state={selectedTask.operationalState} />
              </div>
            )}
            <select
              className="input w-48"
              value={selectedTask?.taskId || ''}
              onChange={(e) => {
                const task = snapshot.tasks.find((t) => t.taskId === e.target.value);
                setSelectedTask(task || null);
                if (task) onSelectedTaskChange?.(task.taskId);
              }}
            >
              {snapshot.tasks.map((task) => (
                <option key={task.taskId} value={task.taskId}>
                  {task.taskId}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedTask && (
          <div className="mb-4 rounded-10 border border-forge-border-subtle bg-forge-primary-surface px-4 py-3" aria-label="Contextual task boundaries">
            <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-forge-accent" /><span className="text-xs font-semibold uppercase tracking-wider text-forge-text-muted">Contextual evidence</span></div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-6 bg-forge-secondary-surface px-2 py-1 text-forge-text-secondary">Task + Claims</span>
              {snapshot.protocol.featureSupport?.workspaceBinding === true && <span className="rounded-6 bg-forge-secondary-surface px-2 py-1 text-forge-text-secondary">Optional Workspace Binding</span>}
              {snapshot.protocol.featureSupport?.responsibilityConstraints === true && <span className="rounded-6 bg-forge-secondary-surface px-2 py-1 text-forge-text-secondary">Optional Responsibility</span>}
              {snapshot.protocol.featureSupport?.differentialVerificationScope === true && <span className="rounded-6 bg-forge-secondary-surface px-2 py-1 text-forge-text-secondary">Verification Scope</span>}
              <span className="rounded-6 bg-forge-secondary-surface px-2 py-1 text-forge-text-secondary">Execution Evidence</span>
              <span className="rounded-6 bg-forge-secondary-surface px-2 py-1 text-forge-text-secondary">Completion Validation</span>
              {snapshot.protocol.featureSupport?.codeAttestation === true && <span className="rounded-6 bg-forge-secondary-surface px-2 py-1 text-forge-text-secondary">Optional Attestation</span>}
            </div>
          </div>
        )}

        <div className="flex-1 bg-forge-primary-surface border border-forge-border-subtle rounded-10 overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodesDraggable={false}
            nodesConnectable={false}
            onNodeClick={handleNodeClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.5}
            maxZoom={1.5}
            defaultEdgeOptions={{
              type: 'smoothstep',
              style: { stroke: '#303038', strokeWidth: 2 },
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#24242A" />
            <Controls
              showInteractive={false}
              className="!bg-forge-secondary-surface !border-forge-border-subtle !rounded-8 !shadow-lg"
            />
            <MiniMap
              nodeColor={(node) => {
                const state = node.data.state;
                switch (state) {
                  case 'completed': return '#22C55E';
                  case 'current': return '#FF7A18';
                  case 'blocked': return '#EF4444';
                  case 'failed': return '#F59E0B';
                  default: return '#303038';
                }
              }}
              maskColor="rgba(9, 9, 11, 0.7)"
              className="!bg-forge-secondary-surface !border-forge-border-subtle !rounded-8"
            />
          </ReactFlow>
        </div>
      </div>

      {inspectorOpen && selectedTask && (
        <InspectorPanel
          task={selectedTask}
          onClose={() => setInspectorOpen(false)}
        />
      )}
    </div>
  );
}
