import * as Tooltip from '@radix-ui/react-tooltip';
import { FlaskConical, AlertTriangle } from 'lucide-react';
import type { DemoScenarioMatch } from '../../lib/demo-scenarios';

interface DemoScenarioBadgeProps {
  match: DemoScenarioMatch;
}

export function DemoScenarioBadge({ match }: DemoScenarioBadgeProps) {
  if (match.kind === 'unknown') return null;

  if (match.kind === 'intentional') {
    const description = `Intentional demo scenario: ${match.scenario.label}. ${match.scenario.summary}`;
    return (
      <Tooltip.Provider delayDuration={150}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span
              tabIndex={0}
              aria-label={description}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-6 bg-forge-accent/10 text-forge-accent cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forge-accent"
            >
              <FlaskConical className="w-3 h-3" />
              Demo scenario
            </span>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content sideOffset={4} className="max-w-xs rounded-8 bg-forge-secondary-surface border border-forge-border-subtle px-3 py-2 text-xs text-forge-text-primary shadow-lg z-50">
              {description}
              <Tooltip.Arrow className="fill-forge-border-subtle" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    );
  }

  const description = `Demo scenario drift: ${match.scenario.taskId} is expected to be ${match.scenario.expectedPhase} but is currently ${match.actualPhase}. This bundled demo no longer matches its documented scenario. Run npm run demo:verify and inspect the demo generator.`;
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span
            tabIndex={0}
            aria-label={description}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-6 bg-forge-warning/10 text-forge-warning cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forge-warning"
          >
            <AlertTriangle className="w-3 h-3" />
            Demo drift
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content sideOffset={4} className="max-w-xs rounded-8 bg-forge-secondary-surface border border-forge-border-subtle px-3 py-2 text-xs text-forge-text-primary shadow-lg z-50">
            {description}
            <Tooltip.Arrow className="fill-forge-border-subtle" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
