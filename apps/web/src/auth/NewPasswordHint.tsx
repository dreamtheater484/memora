import { PASSWORD_MIN_LENGTH } from '@memora/shared';
import { cn } from '../lib/cn';
import { passwordStrength } from '../lib/passwordStrength';

const TONES = ['bg-danger', 'bg-danger', 'bg-warn', 'bg-ok', 'bg-ok'];

/** Under a new password: the rule while empty, then how strong it looks. */
export function NewPasswordHint({ password, username }: { password: string; username?: string }) {
  if (!password) {
    return <>At least {PASSWORD_MIN_LENGTH} characters. A few unrelated words work well.</>;
  }
  const { score, label } = passwordStrength(password, username);
  return (
    <span className="flex items-center gap-2">
      <span
        role="meter"
        aria-label="Password strength"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={score}
        aria-valuetext={label}
        className="flex w-24 shrink-0 gap-0.5"
      >
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn('h-1 flex-1 rounded-full', step <= score ? TONES[score] : 'bg-line')}
          />
        ))}
      </span>
      <span aria-hidden>{label}</span>
    </span>
  );
}
