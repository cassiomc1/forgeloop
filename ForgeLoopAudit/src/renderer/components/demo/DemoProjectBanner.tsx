import { FlaskConical } from 'lucide-react';

export function DemoProjectBanner() {
  return (
    <section
      aria-label="Demo project information"
      className="border-b border-forge-border-subtle bg-forge-secondary-surface/70 px-4 py-2"
    >
      <div className="flex items-start gap-2 text-sm">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-forge-accent" />
        <div>
          <p className="font-medium text-forge-text-primary">
            Demo scenario project
          </p>
          <p className="text-forge-text-muted text-xs mt-0.5">
            ForgeShop intentionally includes complete, verifying, executing, blocked, and planned tasks.
            Schema, integrity, validation, and ForgeLoopAudit errors are still real and are never hidden.
          </p>
        </div>
      </div>
    </section>
  );
}
