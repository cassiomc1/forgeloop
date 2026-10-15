import { EventRecord } from '@shared/domain';
import { formatDate } from '../../lib/utils';

interface EventTimelineMiniProps {
  events: EventRecord[];
  maxEvents?: number;
}

export function EventTimelineMini({ events, maxEvents = 5 }: EventTimelineMiniProps) {
  const recentEvents = events.slice(0, maxEvents);

  if (recentEvents.length === 0) {
    return (
      <div className="text-xs text-forge-text-muted py-2">No events</div>
    );
  }

  return (
    <div className="space-y-2">
      {recentEvents.map((event) => (
        <div key={event.hash} className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div className="w-2 h-2 rounded-full bg-forge-accent mt-1.5" />
            <div className="w-px h-full bg-forge-border-subtle min-h-[20px]" />
          </div>
          <div className="min-w-0 flex-1 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-forge-text-primary">{event.event}</span>
              <span className="text-xs text-forge-text-muted font-mono">#{event.seq}</span>
            </div>
            <div className="text-xs text-forge-text-muted mt-0.5">
              {formatDate(event.at)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}