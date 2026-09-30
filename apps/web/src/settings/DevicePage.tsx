import { Download, MonitorSmartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Switch } from '../components/ui';
import { formatBytes } from '../lib/bytes';
import { install, useInstall } from '../lib/install';
import { useKeepAll } from '../sync/keepAll';
import { SettingsSection } from './SettingsLayout';
import { HelpLink } from '../components/HelpLink';
import { HELP } from '../lib/help';

/*
 * This device (Phase 11): what is kept here for working without a connection, and installing
 * Memora as an app. These settings belong to the device, not to the user.
 */

function useStorageEstimate(): { usage: number; quota: number } | null {
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    let live = true;
    void navigator.storage
      ?.estimate?.()
      .then((e) => live && setEstimate({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return estimate;
}

export function DevicePage() {
  const { on, done, total, setOn } = useKeepAll();
  const estimate = useStorageEstimate();
  const prompt = useInstall((s) => s.prompt);
  const installed = useInstall((s) => s.installed);
  return (
    <>
      <SettingsSection
        title="Offline"
        description="The pages opened lately are always kept on this device, so they open without a connection. Changes made offline are sent when the connection is back."
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <label htmlFor="keep-all" className="text-sm font-medium">
              Keep every page on this device
            </label>
            <p className="text-xs text-fg-2" aria-live="polite">
              {on
                ? total && done < total
                  ? `Keeping pages: ${done} of ${total}…`
                  : total
                    ? `All ${total} pages are kept here.`
                    : 'Pages are kept as they are fetched.'
                : 'Every page opens offline, at the cost of more space on this device.'}
            </p>
          </div>
          <Switch id="keep-all" checked={on} onCheckedChange={setOn} />
        </div>
        {estimate && estimate.quota > 0 && (
          <p className="mt-3 border-t border-line pt-3 text-xs text-fg-2">
            Memora uses {formatBytes(estimate.usage)} on this device, of{' '}
            {formatBytes(estimate.quota)} the browser allows.
          </p>
        )}
      </SettingsSection>
      <SettingsSection
        title="App"
        description={
          <>
            Installed, Memora opens in its own window and from the home screen or dock, like other
            apps. <HelpLink href={HELP.offline}>Offline use and installing the app</HelpLink>
          </>
        }
      >
        {installed ? (
          <p className="flex items-center gap-2 text-sm [&_svg]:size-4 [&_svg]:text-fg-3">
            <MonitorSmartphone aria-hidden />
            Memora is installed on this device.
          </p>
        ) : prompt ? (
          <Button variant="primary" onClick={() => void install()}>
            <Download aria-hidden />
            Install Memora
          </Button>
        ) : (
          <p className="text-sm text-fg-2">
            In Chrome or Edge, choose Install in the address bar or the browser’s menu. On an iPhone
            or iPad, tap Share, then Add to Home Screen.
          </p>
        )}
      </SettingsSection>
    </>
  );
}
