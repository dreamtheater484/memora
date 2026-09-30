import { Outlet } from '@tanstack/react-router';
import { useKeepAllPages } from './sync/keepAll';
import { TransferStatus } from './transfer/TransferStatus';

/**
 * Everything a signed-in user sees; imports and exports follow them from notes to settings,
 * and so does keeping every page on the device.
 */
export function SignedIn() {
  useKeepAllPages();
  return (
    <>
      <Outlet />
      <TransferStatus />
    </>
  );
}
