import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes,
  Code2,
  Container,
  GitBranch,
  GitCommit,
  Layers,
  Network,
  Package,
  Sparkles,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import type { ProjectTimeline, ProjectTimelineEvent, ProjectTimelineEventType } from '@shared/domain';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { EmptyState, ErrorState } from '../components/ui/EmptyState';
import { LoadingState } from '../components/ui/LoadingState';
import { auditApi } from '../lib/audit-client';

type TimelineFilter = 'all' | 'architecture' | 'language' | 'framework' | 'dependency' | 'git' | 'release';

const FILTERS: Array<{ id: TimelineFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'language', label: 'Languages' },
  { id: 'framework', label: 'Frameworks' },
  { id: 'dependency', label: 'Dependencies' },
  { id: 'git', label: 'Git' },
  { id: 'release', label: 'Releases' },
];

const ICONS: Record<ProjectTimelineEventType, LucideIcon> = {
  project: GitBranch,
  language: Code2,
  framework: Layers,
  module: Boxes,
  dependency: Package,
  architecture: Network,
  git: GitCommit,
  release: Tag,
  analysis: Sparkles,
};

const LOADING_MESSAGES = ['Reading project history…', 'Analyzing architectural milestones…', 'Building timeline…'];


interface TimelineProps {
  /**
   * Increments when the open project changes on disk. Without it the timeline
   * would be a one-shot capture of the project at page load.
   */
  refreshToken: number;
}

export function Timeline({ refreshToken }: TimelineProps) {
  const [timeline, setTimeline] = useState<ProjectTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [loadingPhase, setLoadingPhase] = useState(0);
  const [visibleEvents, setVisibleEvents] = useState<Set<string>>(new Set());
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void auditApi.getProjectTimeline().then((result) => {
      if (active) setTimeline(result);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Project timeline could not be loaded.');
    });
    const timer = window.setInterval(() => setLoadingPhase((phase) => (phase + 1) % LOADING_MESSAGES.length), 900);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshToken]);

  const events = useMemo(() => {
    if (!timeline) return [];
    return timeline.events.filter((event) => matchesFilter(event, filter));
  }, [filter, timeline]);

  useEffect(() => {
    setVisibleEvents(new Set());
    if (!trackRef.current || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      setVisibleEvents((current) => {
        const next = new Set(current);
        for (const entry of entries) {
          const id = entry.target.getAttribute('data-timeline-event');
          if (id && entry.isIntersecting) next.add(id);
        }
        return next;
      });
    }, { threshold: 0.3, rootMargin: '0px 0px -10% 0px' });
    const nodes = trackRef.current.querySelectorAll<HTMLElement>('[data-timeline-event]');
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [events]);

  if (!timeline) {
    // The heading stays rendered so the page never loses its title while the
    // project is being re-read.
    return (
      <div className="mx-auto max-w-5xl space-y-6 animate-fade-in">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-forge-accent">Project evolution</p>
          <h1 className="mt-2 text-2xl font-semibold text-forge-text-primary">Project Timeline</h1>
        </div>
        {error
          ? <ErrorState message="Project timeline unavailable" details={error} onRetry={() => window.location.reload()} />
          : <LoadingState message={LOADING_MESSAGES[loadingPhase]} />}
      </div>
    );
  }
  if (timeline.events.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 animate-fade-in">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-forge-accent">Project evolution</p>
          <h1 className="mt-2 text-2xl font-semibold text-forge-text-primary">{timeline.project.name} Timeline</h1>
        </div>
        <EmptyState title="No timeline milestones available" description="ForgeLoopAudit could not derive project or Git milestones from the current project." icon={<GitBranch className="h-12 w-12" />} />
      </div>
    );
  }

  const progress = events.length === 0 ? 0 : events.reduce((latest, event, index) => visibleEvents.has(event.id) ? Math.max(latest, index + 1) : latest, 0) / events.length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-forge-accent">Project evolution</p>
          <h1 className="mt-2 text-2xl font-semibold text-forge-text-primary">{timeline.project.name} Timeline</h1>
          <p className="mt-1 max-w-2xl text-sm text-forge-text-muted">How this project evolved into the architecture ForgeLoopAudit sees today.</p>
          {error && <p className="mt-2 text-sm text-forge-danger">The latest read failed: {error}</p>}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">{timeline.git.available ? `${timeline.git.commitCount ?? 'Unknown'} commits observed` : 'Git history unavailable'}</Badge>
          {timeline.analysis.forgeLoopVersion && <Badge variant="secondary">ForgeLoop {timeline.analysis.forgeLoopVersion}</Badge>}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Current architecture</CardTitle>
          <CardDescription>{timeline.analysis.architecture ?? 'Architecture could not be inferred from the available project signals.'}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pt-0 sm:grid-cols-4">
          <Summary label="Project roots" value={timeline.analysis.projectCount} />
          <Summary label="Languages" value={timeline.analysis.languages.length} />
          <Summary label="Frameworks" value={timeline.analysis.frameworks.length} />
          <Summary label="Modules" value={timeline.analysis.modules.length} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Timeline filters">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`btn ${filter === option.id ? 'bg-forge-accent text-forge-background' : 'btn-secondary'}`}
            onClick={() => setFilter(option.id)}
            aria-pressed={filter === option.id}
          >
            {option.label}
          </button>
        ))}
      </div>

      {!timeline.git.available && (
        <div className="flex gap-3 rounded-10 border border-forge-warning/30 bg-forge-warning/10 p-4 text-sm text-forge-text-secondary" role="status">
          <Container className="mt-0.5 h-5 w-5 shrink-0 text-forge-warning" aria-hidden="true" />
          <div><p className="font-medium text-forge-warning">Project history is unavailable</p><p className="mt-1">This project does not contain enough Git history to reconstruct its evolution. Current ForgeLoop analysis milestones are still shown.</p></div>
        </div>
      )}

      {timeline.warnings.length > 0 && <p className="text-xs text-forge-text-muted">{timeline.warnings.join(' ')}</p>}

      {events.length === 0 ? (
        <EmptyState title="No milestones match this filter" description="Choose another category to see the project signals available in this analysis." />
      ) : (
        <div ref={trackRef} className="relative pb-6 pl-8 sm:pl-12" aria-label="Project evolution milestones">
          <div className="absolute bottom-0 left-[15px] top-2 w-px bg-forge-border-strong/70 sm:left-[23px]" aria-hidden="true" />
          <div className="timeline-progress absolute left-[15px] top-2 w-px origin-top bg-forge-accent transition-[height] duration-500 motion-reduce:transition-none sm:left-[23px]" style={{ height: `${Math.max(progress * 100, 3)}%` }} aria-hidden="true" />
          <div className="space-y-5">
            {events.map((event) => <TimelineEventCard key={event.id} event={event} visible={visibleEvents.has(event.id)} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineEventCard({ event, visible }: { event: ProjectTimelineEvent; visible: boolean }) {
  const Icon = ICONS[event.type];
  return (
    <article data-timeline-event={event.id} className={`relative transition-all duration-500 motion-reduce:transition-none ${visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-70'}`}>
      <div className={`absolute -left-8 top-1 flex h-7 w-7 items-center justify-center rounded-full border-2 bg-forge-primary-surface sm:-left-12 ${event.current ? 'border-forge-accent text-forge-accent shadow-[0_0_0_5px_rgb(var(--color-accent)/0.12)]' : 'border-forge-border-strong text-forge-text-muted'}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </div>
      <Card className={event.current ? 'border-forge-accent/50 shadow-[0_12px_36px_rgb(var(--color-accent)/0.1)]' : ''}>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wider text-forge-text-muted">
            <span>{formatTimelineDate(event.timestamp)}</span>
            <span aria-hidden="true">·</span>
            <span>{event.type}</span>
            {event.current && <Badge variant="default">Current</Badge>}
          </div>
          <h2 className="mt-2 text-base font-semibold text-forge-text-primary">{event.title}</h2>
          {event.description && <p className="mt-1 text-sm leading-6 text-forge-text-secondary">{event.description}</p>}
          <details className="mt-3 rounded-8 bg-forge-secondary-surface/60 px-3 py-2 text-xs text-forge-text-muted">
            <summary className="cursor-pointer font-medium text-forge-text-secondary">Evidence and details</summary>
            <div className="mt-3 space-y-2">
              <p>Confidence: <span className="font-medium text-forge-text-primary">{event.confidence}</span></p>
              {event.source && <p>Source: <span className="break-words text-forge-text-primary">{event.source}</span></p>}
              {event.evidence.length > 0 && <ul className="list-disc space-y-1 pl-4">{event.evidence.map((evidence) => <li key={`${evidence.type}-${evidence.source}-${evidence.commit ?? ''}`} className="break-words">{evidence.source}{evidence.commit ? ` · ${evidence.commit.slice(0, 7)}` : ''}</li>)}</ul>}
            </div>
          </details>
        </CardContent>
      </Card>
    </article>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-8 bg-forge-secondary-surface/60 p-3"><p className="text-[11px] uppercase tracking-wider text-forge-text-muted">{label}</p><p className="mt-1 text-xl font-semibold text-forge-text-primary">{value}</p></div>;
}

function matchesFilter(event: ProjectTimelineEvent, filter: TimelineFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'architecture') return event.type === 'architecture' || event.type === 'module' || event.type === 'analysis';
  if (filter === 'git') return event.type === 'git' || event.type === 'project';
  return event.type === filter;
}

function formatTimelineDate(timestamp?: string): string {
  if (!timestamp) return 'Date unavailable';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}
