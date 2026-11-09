// Points each download link at its file in the newest release, with the version and sizes, shows the SHA-256 of the
// visitor's main download, and fills the numbers line (downloads, stars, forks, releases) from GitHub's API, so they
// are always current. Without JavaScript, or if the API is unreachable, the links still open the latest release and
// the numbers stay hidden. The inline script in <head> has already set data-os on <html>.
const api = (path) =>
  fetch(`https://api.github.com/repos/Orest-Z/OmniCam${path}`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((res) => (res.ok ? res.json() : Promise.reject(res.status)));
const windowsInstaller = (a) => /^OmniCam-Setup-.+\.exe$/.test(a.name);
const linuxPackage = (a) => /^OmniCam-.+\.(AppImage|rpm|deb)$/.test(a.name);
const installer = (a) => windowsInstaller(a) || linuxPackage(a);
const os = document.documentElement.dataset.os;
const count = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

(async () => {
  try {
    const [repo, releases] = await Promise.all([api(''), api('/releases?per_page=100')]);
    const published = releases.filter((r) => !r.draft && !r.prerelease);

    // Every version's installers and packages, shown exactly. latest.yml and the .blockmap files don't count: the app's
    // update checks fetch them, and they would inflate the number.
    const downloads = published.flatMap((r) => r.assets).filter(installer).reduce((n, a) => n + a.download_count, 0);
    const since = new Date(published.at(-1).published_at).toLocaleDateString('en', { month: 'long', year: 'numeric' });
    const set = (key, text) => (document.querySelector(`[data-stat="${key}"]`).textContent = text);
    set('downloads', downloads.toLocaleString('en'));
    set('stars', count.format(repo.stargazers_count));
    set('forks', count.format(repo.forks_count));
    set('releases', published.length);
    set('released', `releases since ${since}`);
    document.getElementById('stats').hidden = false;

    const release = published[0];
    const version = release.tag_name.replace(/^v/, '');
    for (const p of document.querySelectorAll('[data-download-meta]')) p.textContent = `Version ${version} · free · MIT license`;
    for (const el of document.querySelectorAll('[data-version]')) el.textContent = version;

    const files = { exe: /\.exe$/, AppImage: /\.AppImage$/, rpm: /\.rpm$/, deb: /\.deb$/ };
    const assets = {};
    for (const [kind, file] of Object.entries(files)) {
      const asset = (assets[kind] = release.assets.find((a) => installer(a) && file.test(a.name)));
      if (!asset) continue;
      for (const a of document.querySelectorAll(`[data-asset="${kind}"]`)) {
        a.href = asset.browser_download_url;
        const size = a.querySelector('[data-size]');
        if (size) size.textContent = ` · ${(asset.size / 1024 / 1024).toFixed(0)} MB`;
      }
    }
    const asset = os === 'linux' ? assets.AppImage : assets.exe;

    // GitHub computes this digest itself when the file is uploaded.
    if (asset?.digest?.startsWith('sha256:')) {
      const el = document.getElementById('checksum');
      el.textContent = `SHA-256 of ${asset.name}: ${asset.digest.slice(7)}`;
      el.hidden = false;
    }
  } catch {
    // Keep the static links.
  }
})();

// On a phone there is nothing to download: share the page to the PC instead, or copy the link.
document.querySelector('[data-share]').addEventListener('click', async () => {
  const url = location.href.split('#')[0];
  const status = document.querySelector('[data-share-status]');
  try {
    if (navigator.share) return await navigator.share({ title: document.title, url });
    await navigator.clipboard.writeText(url);
    status.textContent = 'Link copied. Paste it on your PC.';
  } catch (e) {
    if (e.name !== 'AbortError') status.textContent = url;
  }
});

// Demo video. While it is on screen it plays muted, looping the part from the phone-to-PC shot (0:11) to the end
// card: the film opens and closes on black. Browsers refuse autoplay with sound until the visitor has interacted
// with the page. "Watch with sound" plays it from the top, unmuted, with controls, and a chapter plays it the same
// way from that chapter. Reduced motion or Data Saver: no autoplay, just the poster and the button.
{
  const video = document.getElementById('demo');
  const stage = video.closest('.viewfinder');
  const play = stage.querySelector('.play');
  const chapters = [...document.querySelectorAll('.chapters button')];
  const starts = chapters.map((b) => Number(b.dataset.t));
  const loop = { from: 11, to: 59 };
  let teaser = !matchMedia('(prefers-reduced-motion: reduce)').matches && !navigator.connection?.saveData;

  const unplayable = () => {
    stage.classList.add('unplayable');
    video.controls = false;
  };
  const start = () => video.play().catch((e) => e.name === 'NotSupportedError' && unplayable());
  video.querySelector('source').addEventListener('error', unplayable);
  video.addEventListener('error', unplayable);

  video.controls = false;
  play.hidden = false;

  if (teaser) {
    video.loop = true;
    video.preload = 'auto';
    video.addEventListener('loadedmetadata', () => teaser && (video.currentTime = loop.from), { once: true });
    video.addEventListener('timeupdate', () => teaser && video.currentTime >= loop.to && (video.currentTime = loop.from));
    new IntersectionObserver(([e]) => {
      if (!teaser) return;
      if (e.isIntersecting) start();
      else video.pause();
    }).observe(video);
  }

  const watch = (from) => {
    teaser = false;
    play.hidden = true;
    video.loop = false;
    video.controls = true;
    video.muted = false;
    video.currentTime = from;
    start();
  };
  for (const el of document.querySelectorAll('[data-play]')) el.addEventListener('click', (e) => {
    e.preventDefault();
    video.scrollIntoView({ behavior: 'smooth', block: 'center' });
    watch(0);
  });
  video.addEventListener('click', () => teaser && watch(0));
  chapters.forEach((b, i) => b.addEventListener('click', () => watch(starts[i])));

  video.addEventListener('playing', () => stage.classList.add('is-live'));
  for (const type of ['pause', 'ended', 'emptied']) video.addEventListener(type, () => stage.classList.remove('is-live'));

  // The rail: the current chapter is marked, and its bar fills as it plays.
  let current = -1;
  let frame = 0;
  const follow = () => {
    const t = video.currentTime;
    const at = starts.findLastIndex((s) => t >= s);
    if (at !== current) {
      chapters.forEach((b, i) => {
        if (i === at) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
        b.style.setProperty('--p', i < at ? 1 : 0);
      });
      current = at;
    }
    const end = starts[at + 1] ?? video.duration;
    if (at >= 0 && end > starts[at]) chapters[at].style.setProperty('--p', Math.min(1, (t - starts[at]) / (end - starts[at])));
    frame = video.paused ? 0 : requestAnimationFrame(follow);
  };
  video.addEventListener('playing', () => {
    cancelAnimationFrame(frame);
    follow();
  });
  video.addEventListener('seeked', follow);
}
