import { Moon, Sun } from 'lucide-react';
import { Button } from './button';
import { useTheme } from '../../lib/theme';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      aria-label={`Switch to ${nextTheme} theme`}
      title={`Switch to ${nextTheme} theme`}
      variant="ghost"
      size="icon"
      onClick={() => setTheme(nextTheme)}
    >
      {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
