import { AlertTriangle, ArrowUpRight, Download, RotateCcw } from 'lucide-react';
import type { StreamStats, VirtualCamStats } from '@omnicam/protocol';
import type { UpdateState } from '../../shared/ipc';
import { Dialog } from './ui';

const RELEASES_URL = 'https://github.com/Orest-Z/OmniCam/releases';

interface Props {
  update: UpdateState;
  version: string;
  stats: StreamStats;
  vcam: VirtualCamStats;
  onClose: () => void;
}

/** The update prompt: offer → download progress → restart. Opened from the title-bar badge or Settings. */
export function UpdateDialog({ update, version, stats, vcam, onClose }: Props) {
  const next = update.version;
  const downloadFailed = update.status === 'error' && update.failed === 'download';
  const cameraBusy = vcam.consumers > 0 || stats.state === 'connected' || stats.state === 'stalled';
  const download = () => void window.omnicam.downloadUpdate();

  const offering = update.status === 'available' || update.status === 'downloading' || update.status === 'downloaded';
  if (!next || (!offering && !downloadFailed)) {
    return (
      <Dialog title="Updates" className="update" onClose={onClose}>
        <p className="muted">You're on the latest version (OmniCam {version}).</p>
        <div className="actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </Dialog>
    );
  }

  const busyNote = cameraBusy && (
    <div className="notice warn">
      <AlertTriangle />
      <span>
        The OmniCam camera stops for about a minute while it updates
        {vcam.consumers > 0 ? `, and ${vcam.consumers} app${vcam.consumers > 1 ? 's are' : ' is'} using it now` : ''}. Close apps
        that use the camera first if you can.
      </span>
    </div>
  );

  return (
    <Dialog title={update.status === 'downloaded' ? 'Ready to update' : 'Update available'} className="update" onClose={onClose}>
      <p className="lead">
        <strong>OmniCam {next}</strong> is {update.status === 'downloaded' ? 'downloaded and ready to install' : 'available'}. You have{' '}
        {version}.
      </p>
      <button className="link" onClick={() => void window.omnicam.openExternal(`${RELEASES_URL}/tag/v${next}`)}>
        What's new in {next}
        <ArrowUpRight />
      </button>

      {update.status === 'downloading' && (
        <div className="download">
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={update.percent ?? 0}>
            <i style={{ width: `${update.percent ?? 0}%` }} />
          </div>
          <span className="muted">Downloading… {update.percent ?? 0}%</span>
        </div>
      )}

      {downloadFailed && (
        <div className="notice bad">
          <AlertTriangle />
          <span>The download didn't finish. {update.error}</span>
        </div>
      )}

      {update.status === 'downloaded' && (
        <p className="muted small">OmniCam will close, install the update and start again. Windows asks for permission because the installer registers the camera.</p>
      )}

      {update.status !== 'downloading' && busyNote}

      <div className="actions">
        <button className="btn ghost" onClick={onClose}>
          {update.status === 'downloading' ? 'Hide' : 'Later'}
        </button>
        {update.status === 'available' && (
          <button className="btn primary" onClick={download}>
            <Download />
            Download and install
          </button>
        )}
        {downloadFailed && (
          <button className="btn primary" onClick={download}>
            <RotateCcw />
            Try again
          </button>
        )}
        {update.status === 'downloading' && (
          <button className="btn primary" disabled>
            Downloading…
          </button>
        )}
        {update.status === 'downloaded' && (
          <button className="btn primary" onClick={() => void window.omnicam.installUpdate()}>
            Restart and update
          </button>
        )}
      </div>
    </Dialog>
  );
}

/** One line for Settings describing where the updater is. */
export function updateSummary(update: UpdateState): string {
  switch (update.status) {
    case 'unsupported':
      return 'Updates work in the installed app.';
    case 'idle':
      return 'OmniCam checks for updates when it starts.';
    case 'checking':
      return 'Checking for updates…';
    case 'not-available':
      return `You're up to date${update.checkedAt ? ` · checked ${checkedLabel(update.checkedAt)}` : ''}.`;
    case 'available':
      return `Version ${update.version} is available.`;
    case 'downloading':
      return `Downloading version ${update.version}… ${update.percent ?? 0}%`;
    case 'downloaded':
      return `Version ${update.version} is ready to install.`;
    case 'error':
      return update.failed === 'download' ? `The download didn't finish. ${update.error}` : `Couldn't check for updates. ${update.error}`;
  }
}

function checkedLabel(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `at ${time}` : `${d.toLocaleDateString()} ${time}`;
}
