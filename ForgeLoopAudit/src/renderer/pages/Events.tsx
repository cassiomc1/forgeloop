import { useState, useEffect, useCallback, useRef } from 'react';
import type { ProjectSnapshot, TaskSummary, EventRecord, EventPage } from '@shared/domain';
import { NoEventsState } from '../components/ui/EmptyState';
import { cn, formatDate, shortHash } from '../lib/utils';
import { EVENT_FILTERS, EVENT_TONE_CLASS, eventTone, matchesEventFilter } from '../lib/event-presentation';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { auditApi } from '../lib/audit-client';

interface EventsProps {
  snapshot: ProjectSnapshot;
  selectedTaskId?: string | null;
  eventsRefreshToken?: number;
  onSelectedTaskChange?: (taskId: string) => void;
}

export function Events({ snapshot, selectedTaskId, eventsRefreshToken = 0, onSelectedTaskChange }: EventsProps) {
  const [selectedTask, setSelectedTask] = useState<TaskSummary | null>(
    snapshot.tasks.find((t) => t.taskId === snapshot.activeTaskId) || snapshot.tasks[0] || null
  );
  useEffect(() => { setSelectedTask(snapshot.tasks.find((t) => t.taskId === selectedTaskId) || snapshot.tasks.find((t) => t.taskId === snapshot.activeTaskId) || snapshot.tasks[0] || null); }, [snapshot, selectedTaskId]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [validation, setValidation] = useState<EventPage['validation']>();
  const [hasMore, setHasMore] = useState(false);
  const eventsRef = useRef<EventRecord[]>([]);
  const cursorRef = useRef<string | undefined>(undefined);
  const hasMoreRef = useRef(false);
  const currentTaskRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  const loadEvents = useCallback(async (taskId: string, append = false) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const result = await auditApi.getTaskEvents(taskId, append ? cursorRef.current : undefined, 100);
      if (requestId !== requestIdRef.current) return;

      const previousEvents = eventsRef.current;
      const mergedEvents = Array.from(new Map(
        [...previousEvents, ...(result.events || [])].map((event) => [event.hash, event]),
      ).values()).sort((a, b) => b.seq - a.seq);
      eventsRef.current = mergedEvents;
      setEvents(mergedEvents);
      setValidation(result.validation);
      if (append || previousEvents.length === 0) cursorRef.current = result.cursor;
      const retainedOlderEvents = previousEvents.some((event) => !(result.events || []).some((next) => next.hash === event.hash));
      const nextHasMore = Boolean(result.hasMore || retainedOlderEvents);
      hasMoreRef.current = nextHasMore;
      setHasMore(nextHasMore);
      setSelectedEvent((current) => current ? mergedEvents.find((event) => event.hash === current.hash) || null : null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error('Failed to load events:', err);
      if (!append) {
        eventsRef.current = [];
        setEvents([]);
        cursorRef.current = undefined;
        hasMoreRef.current = false;
        setHasMore(false);
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const taskId = selectedTask?.taskId || null;
    if (currentTaskRef.current !== taskId) {
      requestIdRef.current++;
      currentTaskRef.current = taskId;
      eventsRef.current = [];
      cursorRef.current = undefined;
      hasMoreRef.current = false;
      setEvents([]);
      setHasMore(false);
      setValidation(undefined);
      setSelectedEvent(null);
    }
    if (taskId) void loadEvents(taskId);
  }, [selectedTask?.taskId, eventsRefreshToken, loadEvents]);

  const loadOlderEvents = useCallback(() => {
    if (!selectedTask || loading || !hasMoreRef.current || !cursorRef.current) return;
    void loadEvents(selectedTask.taskId, true);
  }, [loadEvents, loading, selectedTask]);

  const validateLedger = async () => {
    if (!selectedTask) return;
    try { setValidation(await auditApi.validateEventLedger(selectedTask.taskId)); }
    catch { setValidation({ schema: 'INVALID', chain: 'INVALID', scope: 'LEDGER', errors: ['Ledger validation failed'] }); }
  };

  const filteredEvents = events.filter((event) => matchesEventFilter(event.event, filter));

  const getEventColor = (event: string) => EVENT_TONE_CLASS[eventTone(event)];

  if (snapshot.tasks.length === 0) {
    return <NoEventsState />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-forge-text-primary">Event Ledger</h1>
          <p className="text-sm text-forge-text-muted mt-1">Chronological engineering timeline</p>
          <p className="text-xs text-forge-text-muted mt-2" role="status" aria-live="polite">
            Live updates enabled · Showing {events.length} event{events.length === 1 ? '' : 's'}
          </p>
        </div>
          <div className="flex items-center gap-3">
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
            <button className="btn-secondary text-xs" onClick={() => void validateLedger()}>Validate ledger</button>
          <div className="flex items-center gap-1 bg-forge-secondary-surface rounded-6 p-0.5">
            {EVENT_FILTERS.map((f) => (
              <button
                key={f}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-4 transition-colors',
                  filter === f
                    ? 'bg-forge-accent/10 text-forge-accent'
                    : 'text-forge-text-muted hover:text-forge-text-primary'
                )}
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {validation && (
        <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-3 text-xs text-forge-text-secondary">
          <span>Page schema: {validation.schema}</span> · <span>Ledger chain: {validation.chain}</span>
          {validation.invalidLineCount ? <span> · Invalid lines: {validation.invalidLineCount}</span> : null}
          {validation.errors && validation.errors.length > 0 ? <p className="mt-1 text-forge-danger">{validation.errors.join(' · ')}</p> : null}
        </div>
      )}

      <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-forge-text-muted">Loading events...</div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-8 text-center text-sm text-forge-text-muted">No events found</div>
        ) : (
          <div className="divide-y divide-forge-border-subtle/50" aria-live="polite">
            {filteredEvents.map((event) => (
              <button
                key={event.hash}
                className={cn(
                  'w-full px-4 py-3 flex items-center gap-4 hover:bg-forge-hover-surface transition-colors text-left',
                  selectedEvent?.hash === event.hash && 'bg-forge-accent/5'
                )}
                onClick={() => setSelectedEvent(selectedEvent?.hash === event.hash ? null : event)}
              >
                <span className="text-xs font-mono text-forge-text-muted w-12">#{event.seq}</span>
                <span className={cn('text-sm font-medium flex-1', getEventColor(event.event))}>
                  {event.event}
                </span>
                <span className="text-xs text-forge-text-muted font-mono">
                  {shortHash(event.hash)}
                </span>
                <span className="text-xs text-forge-text-muted">
                  {new Date(event.at).toLocaleTimeString()}
                </span>
                {selectedEvent?.hash === event.hash ? (
                  <ChevronUp className="w-4 h-4 text-forge-text-muted" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-forge-text-muted" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {hasMore && (
        <div className="flex justify-center">
          <button className="btn-secondary text-xs" onClick={loadOlderEvents} disabled={loading}>
            {loading ? 'Loading older events…' : 'Load older events'}
          </button>
        </div>
      )}

      {selectedEvent && (
        <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4 animate-fade-in">
          <h3 className="text-sm font-semibold text-forge-text-primary mb-3">Event Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-forge-text-muted mb-1">Sequence</p>
              <p className="text-sm font-mono text-forge-text-primary">#{selectedEvent.seq}</p>
            </div>
            <div>
              <p className="text-xs text-forge-text-muted mb-1">Event</p>
              <p className="text-sm text-forge-text-primary">{selectedEvent.event}</p>
            </div>
            <div>
              <p className="text-xs text-forge-text-muted mb-1">Timestamp</p>
              <p className="text-sm font-mono text-forge-text-primary">{formatDate(selectedEvent.at)}</p>
            </div>
            <div>
              <p className="text-xs text-forge-text-muted mb-1">Task</p>
              <p className="text-sm font-mono text-forge-text-primary">{selectedEvent.taskId}</p>
            </div>
            <div>
              <p className="text-xs text-forge-text-muted mb-1">Hash</p>
              <p className="text-sm font-mono text-forge-text-primary break-all">{selectedEvent.hash}</p>
            </div>
            <div>
              <p className="text-xs text-forge-text-muted mb-1">Previous Hash</p>
              <p className="text-sm font-mono text-forge-text-primary break-all">
                {selectedEvent.previousHash || 'None'}
              </p>
            </div>
            {selectedEvent.fingerprint && (
              <div>
                <p className="text-xs text-forge-text-muted mb-1">Fingerprint</p>
                <p className="text-sm font-mono text-forge-text-primary break-all">{selectedEvent.fingerprint}</p>
              </div>
            )}
          </div>
          {selectedEvent.details && Object.keys(selectedEvent.details).length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-forge-text-muted mb-2">Details</p>
              <pre className="text-xs text-forge-text-secondary font-mono bg-forge-secondary-surface rounded-6 p-3 overflow-auto max-h-[200px]">
                {JSON.stringify(selectedEvent.details, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
