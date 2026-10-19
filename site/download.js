// Points the big button at the download for this computer, and every link at the newest
// release's file (GitHub's releases/latest/download/<file> always resolves to it).
(() => {
  const base = 'https://github.com/dreamtheater484/memora/releases/latest/download/';
  // The APK's name has the version in it: Android phones get the newest release's page.
  const release = 'https://github.com/dreamtheater484/memora/releases/latest';
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
  const agent = navigator.userAgent.toLowerCase();
  const android = agent.includes('android');
  const phone = /android|iphone|ipad|mobile/.test(agent);
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
  } else if (android) {
    button.textContent = 'Download for Android';
    button.href = release;
    note.textContent = 'On the release page, choose Memora-x.y.z-arm64.apk, then open it.';
  } else {
    // An iPhone, an iPad or another system: the list shows every download.
    button.textContent = 'See the downloads';
    note.textContent =
      'Memora runs on Windows, macOS, Ubuntu and Android. On an iPhone or iPad, use Memora Server.';
    document.getElementById('all-downloads').open = true;
  }
})();
