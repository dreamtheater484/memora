import { useNavigate } from '@tanstack/react-router';
import { AuthLayout } from './AuthLayout';
import { useCurrentUser, useLogout } from './queries';
import { TwoFactorSetup } from './TwoFactor';

/** Shown when an administrator requires two-step verification and it isn't set up yet. */
export function TwoFactorRequiredPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const logout = useLogout();
  return (
    <AuthLayout
      title="Set up two-step verification"
      description={
        <>
          Hi {user.displayName}. Your administrator asks everyone to log in with a code from their
          phone as well as their password.
        </>
      }
      footer={
        <button
          type="button"
          className="underline underline-offset-2 hover:text-fg"
          onClick={() => logout.mutate()}
        >
          Log out instead
        </button>
      }
    >
      <TwoFactorSetup
        username={user.username}
        done="Continue to Memora"
        onDone={() => void navigate({ to: '/', replace: true })}
      />
    </AuthLayout>
  );
}
