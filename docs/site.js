// Points the download button at the newest installer and shows its version, size and SHA-256.
// Without JavaScript, or if GitHub's API is unreachable, the button still opens the latest release.
(async () => {
  try {
    const res = await fetch('https://api.github.com/repos/Orest-Z/OmniCam/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return;
    const release = await res.json();
    const asset = release.assets.find((a) => /^OmniCam-Setup-.+\.exe$/.test(a.name));
    if (!asset) return;

    const version = release.tag_name.replace(/^v/, '');
    const mb = (asset.size / 1024 / 1024).toFixed(0);
    document.getElementById('download').href = asset.browser_download_url;
    document.querySelector('#download span').textContent = `Download OmniCam ${version}`;
    document.getElementById('download-meta').textContent = `Windows 10 / 11 · 64-bit · ${mb} MB · MIT license`;

    // GitHub computes this digest itself when the file is uploaded.
    if (asset.digest?.startsWith('sha256:')) {
      const el = document.getElementById('checksum');
      el.textContent = `SHA-256 of ${asset.name}: ${asset.digest.slice(7)}`;
      el.hidden = false;
    }
  } catch {
    // Keep the static link.
  }
})();
