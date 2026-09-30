import { Outlet } from '@tanstack/react-router';
import { TransferStatus } from './transfer/TransferStatus';

/** Everything a signed-in user sees; imports and exports follow them from notes to settings. */
export function SignedIn() {
  return (
    <>
      <Outlet />
      <TransferStatus />
    </>
  );
}
