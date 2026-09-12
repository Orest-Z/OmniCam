import { Controls } from './components/Controls';
import { Pairing } from './components/Pairing';
import { Preview } from './components/Preview';
import { Settings } from './components/Settings';
import { useAppState } from './useAppState';

const STATE_LABEL = {
  idle: 'Waiting for phone',
  connecting: 'Connecting…',
  connected: 'Live',
  stalled: 'Paused on phone',
  disconnected: 'Disconnected',
} as const;

export function App() {
  const { state, setSettings, control } = useAppState();
  if (!state) return <div className="app" />;

  const { pairing, settings, stats, vcam, vcamError, version } = state;
  const phoneLabel = stats.device ? `${stats.device.platform}` : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" /> OmniCam
        </div>
        <span className={`pill ${stats.state}`}>
          {STATE_LABEL[stats.state]}
          {phoneLabel && stats.state !== 'idle' ? ` · ${phoneLabel}` : ''}
        </span>
        <div className="spacer" />
        <span className="version">v{version}</span>
      </header>

      <main className="main">
        <div className="col">
          <Pairing pairing={pairing} settings={settings} onSettings={(p) => void setSettings(p)} />
        </div>
        <div className="col">
          <section className="panel">
            <h2>Camera</h2>
            <Preview stats={stats} mirror={settings.mirror} />
            <Controls stats={stats} settings={settings} onSettings={(p) => void setSettings(p)} onControl={(m) => void control(m)} />
          </section>
          <Settings settings={settings} vcam={vcam} vcamError={vcamError} onSettings={(p) => void setSettings(p)} />
        </div>
      </main>
    </div>
  );
}
