// Points the download buttons at the newest installer, shows its version, size and SHA-256, and fills the
// numbers strip (downloads, stars, forks, releases) from GitHub's API, so they are always current.
// Without JavaScript, or if the API is unreachable, the buttons still open the latest release and the strip stays hidden.
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
    for (const a of document.querySelectorAll('[data-download]')) {
      a.href = asset.browser_download_url;
      a.querySelector('span').textContent = `Download OmniCam ${version}`;
    }
    for (const p of document.querySelectorAll('[data-download-meta]')) p.textContent = `Windows 10 / 11 · 64-bit · ${mb} MB · MIT license`;

    // GitHub computes this digest itself when the file is uploaded.
    if (asset.digest?.startsWith('sha256:')) {
      const el = document.getElementById('checksum');
      el.textContent = `SHA-256 of ${asset.name}: ${asset.digest.slice(7)}`;
      el.hidden = false;
    }
  } catch {
    // Keep the static links.
  }
})();

// Demo video. It autoplays muted and looping while it is on screen: browsers refuse autoplay with sound until the
// visitor has interacted with the page. "Watch with sound" restarts it from the top, unmuted, with controls.
// Reduced motion or Data Saver: no autoplay, just the poster and the button.
{
  const video = document.getElementById('demo');
  const play = document.querySelector('.play');
  let teaser = !matchMedia('(prefers-reduced-motion: reduce)').matches && !navigator.connection?.saveData;

  video.controls = false;
  play.hidden = false;

  if (teaser) {
    video.loop = true;
    video.preload = 'auto';
    new IntersectionObserver(([e]) => {
      if (!teaser) return;
      if (e.isIntersecting) video.play().catch(() => {});
      else video.pause();
    }).observe(video);
  }

  const full = () => {
    teaser = false;
    play.hidden = true;
    video.loop = false;
    video.controls = true;
    video.muted = false;
    video.currentTime = 0;
    video.play().catch(() => {});
  };
  for (const el of document.querySelectorAll('[data-play]')) el.addEventListener('click', (e) => {
    e.preventDefault();
    video.scrollIntoView({ behavior: 'smooth', block: 'center' });
    full();
  });
  video.addEventListener('click', () => teaser && full());
}

// Scroll reveals, staggered within each group, and the cursor spotlight on cards.
{
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const el of document.querySelectorAll('.reveal')) {
    const i = [...el.parentElement.children].filter((c) => c.classList.contains('reveal')).indexOf(el);
    el.style.setProperty('--d', `${Math.min(i, 5) * 70}ms`);
    io.observe(el);
  }

  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest?.('.card');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--x', `${e.clientX - r.left}px`);
    card.style.setProperty('--y', `${e.clientY - r.top}px`);
  });
}
