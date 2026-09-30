// Points the big button at the download for this computer, and every link at the newest
// release's file (GitHub's releases/latest/download/<file> always resolves to it).
(() => {
  const base = 'https://github.com/dreamtheater484/memora/releases/latest/download/';
  const systems = {
    windows: ['Download for Windows', 'Memora-Setup.exe', 'For Windows 10 and 11.'],
    mac: ['Download for macOS', 'Memora.dmg', 'For Intel and Apple Silicon Macs.'],
    ubuntu: ['Download for Ubuntu', 'Memora-amd64.deb', 'For Ubuntu on an Intel or AMD PC.'],
  };
  for (const link of document.querySelectorAll('a[data-file]')) {
    link.href = base + link.dataset.file;
  }
  const hint = (
    navigator.userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent
  ).toLowerCase();
  const phone = /android|iphone|ipad|mobile/.test(navigator.userAgent.toLowerCase());
  const system = phone
    ? null
    : hint.includes('win')
      ? 'windows'
      : hint.includes('mac')
        ? 'mac'
        : hint.includes('linux') || hint.includes('x11')
          ? 'ubuntu'
          : null;
  const button = document.getElementById('download');
  const note = document.getElementById('download-note');
  if (system) {
    const [label, file, detail] = systems[system];
    button.textContent = label;
    button.href = base + file;
    note.textContent = `${detail} Other systems and ARM: All downloads.`;
  } else {
    // A phone or tablet: the app is for computers; the list shows every download.
    button.textContent = 'See the downloads';
    note.textContent =
      'Memora for your computer runs on Windows, macOS and Ubuntu. On a phone, use Memora Server.';
    document.getElementById('all-downloads').open = true;
  }
})();
