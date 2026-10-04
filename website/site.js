// Points the download button at the newest installer, shows its version, size and SHA-256, and fills the
// numbers strip (downloads, stars, forks, releases) from GitHub's API, so they are always current.
// Without JavaScript, or if the API is unreachable, the button still opens the latest release and the strip stays hidden.
const api = (path) =>
  fetch(`https://api.github.com/repos/Orest-Z/OmniCam${path}`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((res) => (res.ok ? res.json() : Promise.reject(res.status)));
const installer = (a) => /^OmniCam-Setup-.+\.exe$/.test(a.name);
const count = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

(async () => {
  try {
    const [repo, releases] = await Promise.all([api(''), api('/releases?per_page=100')]);
    const published = releases.filter((r) => !r.draft && !r.prerelease);

    // Only installer downloads count; latest.yml is fetched by every update check and would inflate the number.
    const downloads = published.flatMap((r) => r.assets).filter(installer).reduce((n, a) => n + a.download_count, 0);
    const since = new Date(published.at(-1).published_at).toLocaleDateString('en', { month: 'long', year: 'numeric' });
    const set = (key, text) => (document.querySelector(`[data-stat="${key}"]`).textContent = text);
    set('downloads', count.format(downloads));
    set('stars', count.format(repo.stargazers_count));
    set('forks', count.format(repo.forks_count));
    set('releases', published.length);
    set('released', `releases since ${since}`);
    document.getElementById('stats').hidden = false;

    const release = published[0];
    const asset = release.assets.find(installer);
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
