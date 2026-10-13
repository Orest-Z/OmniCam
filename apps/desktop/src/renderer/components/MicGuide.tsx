import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AppWindow, ArrowUpRight, AudioLines, Cable, Check, ChevronDown, Mic, Smartphone, Video } from 'lucide-react';
import type { DesktopToPhone } from '@omnicam/protocol';
import type { AppSettings, StreamStats } from '../../shared/ipc';
import { micNameFor, pickSink } from '../../shared/audio-sink';
import { useLoopbacks } from '../useLoopbacks';
import { SPEAKING_LEVEL } from './LiveView';
import { Dialog } from './ui';
import downloadShot from '../assets/vb-cable/download.webp';
import unzipShot from '../assets/vb-cable/unzip.webp';
import runAsAdminShot from '../assets/vb-cable/run-as-admin.webp';
import installDriverShot from '../assets/vb-cable/install-driver.webp';
import installedShot from '../assets/vb-cable/installed.webp';

/** The free virtual cable the phone's microphone plays into. Linked, never bundled: that needs VB-Audio's permission. */
const VB_CABLE_URL = 'https://vb-audio.com/Cable/';
/** Windows Settings → Sound (main only opens this exact non-web address). */
const SOUND_SETTINGS = 'ms-settings:sound';
/** What apps call the cable's microphone side until a cable is found. */
const VB_CABLE_MIC = 'CABLE Output (VB-Audio Virtual Cable)';

/** Installing VB-CABLE, one screen at a time. The screenshots circle what to click. */
const INSTALL: { tab: string; text: string; shot?: string; alt?: string }[] = [
  {
    tab: 'Download',
    text: 'Open VB-Audio\'s page and click the orange Download button for Windows.',
    shot: downloadShot,
    alt: "VB-Audio's VB-CABLE page with the Windows Download button circled",
  },
  {
    tab: 'Unzip',
    text: 'In your Downloads folder, right-click the VBCABLE_Driver_Pack zip and extract it: 7-Zip → Extract to "VBCABLE_Driver_Pack…" as shown, or Extract All… without 7-Zip. Then open the folder it makes.',
    shot: unzipShot,
    alt: 'The downloaded zip right-clicked, with 7-Zip and Extract to "VBCABLE_Driver_Pack45\\" circled; Extract All sits just above',
  },
  {
    tab: 'Run as admin',
    text: 'Right-click VBCABLE_Setup_x64 and choose Run as administrator. Click Yes when Windows asks.',
    shot: runAsAdminShot,
    alt: 'The extracted folder: VBCABLE_Setup_x64 right-clicked, with Run as administrator circled',
  },
  {
    tab: 'Install',
    text: 'Click Install Driver.',
    shot: installDriverShot,
    alt: 'The VB-Audio Virtual Cable installer with the Install Driver button circled',
  },
  {
    tab: 'Restart',
    text: 'Click OK, then restart your computer. Afterwards this step ticks itself.',
    shot: installedShot,
    alt: '"Installation Complete and Successful" message with the OK button circled',
  },
];

interface Props {
  stats: StreamStats;
  settings: AppSettings;
  onControl: (msg: DesktopToPhone) => void;
  onClose: () => void;
}

type State = 'done' | 'todo' | 'bad';

/**
 * Setting up the phone as a microphone, as a live checklist: the path the sound takes (phone →
 * OmniCam → VB-CABLE → app) lights up part by part, and each step ticks itself once OmniCam can see
 * it done. Only the last step, picking the microphone in the app, can't be seen from here.
 */
export function MicGuide({ stats, settings, onControl, onClose }: Props) {
  const loopbacks = useLoopbacks();
  const sink = loopbacks && pickSink(loopbacks.outputs, settings.micOutput);
  const live = stats.state === 'connected' || stats.state === 'stalled';
  const camera = stats.sources?.camera !== false;
  const mic = live && stats.sources?.mic === true;
  const level = stats.micLevel ?? 0;
  // Sound only gets measured while it plays into the cable, so this also proves phone → OmniCam → cable.
  const flowing = mic && level > SPEAKING_LEVEL;
  const cable: State = !sink ? 'todo' : loopbacks?.isDefault ? 'bad' : 'done';
  const micName = sink ? micNameFor(sink.label) : VB_CABLE_MIC;
  const open = (url: string) => void window.omnicam.openExternal(url);
  // The phone keeps one source on, and handles commands in order: microphone first, then the camera.
  const choose = (cameraToo: boolean) => {
    if (!mic) onControl({ type: 'setMic', on: true });
    if (camera !== cameraToo) onControl({ type: 'setCamera', on: cameraToo });
  };

  return (
    <Dialog title="Use your phone as a microphone" className="guide" onClose={onClose}>
      <p className="lead">
        With or without its camera. It needs <b>VB-CABLE</b>, a free helper from VB-Audio that carries the phone's sound to your apps.
        Each step ticks itself when it's done.
      </p>

      <div className="flow" aria-hidden="true">
        <Node state={mic ? 'done' : 'todo'} icon={<Smartphone />} label="Phone mic" sub={mic ? 'on' : 'off'} />
        <Link on={mic && Boolean(sink)} flowing={flowing} />
        <Node state={mic && sink ? 'done' : 'todo'} icon={<AudioLines />} label="OmniCam" sub={mic && sink ? 'sending' : 'waiting'} />
        <Link on={mic && Boolean(sink)} flowing={flowing} />
        <Node state={cable} icon={<Cable />} label="VB-CABLE" sub={cable === 'bad' ? 'is the default output' : sink ? 'installed' : 'not installed'} />
        <Link on={cable === 'done'} flowing={flowing} />
        <Node state="todo" icon={<AppWindow />} label="Your app" sub="picks the cable" />
      </div>

      <ol className="gsteps">
        <Step n={1} state={sink ? 'done' : 'todo'} title="Install VB-CABLE (free, about 2 minutes)">
          {sink ? (
            <p>
              Found <b>{sink.label}</b>.
            </p>
          ) : (
            <InstallSlides onDownload={() => open(VB_CABLE_URL)} />
          )}
        </Step>

        <Step n={2} state={cable === 'done' ? 'done' : cable} title="Keep your speakers as the sound output">
          {cable === 'bad' ? (
            <>
              <p>
                Windows now plays everything into VB-CABLE, so apps would hear your whole computer through the phone. Choose your speakers or
                headphones as the output again.
              </p>
              <button className="btn sm" onClick={() => open(SOUND_SETTINGS)}>
                Open Sound settings
                <ArrowUpRight />
              </button>
            </>
          ) : (
            <p>{sink ? 'Windows still plays through your speakers.' : 'Checked after step 1: the installer can make VB-CABLE the default.'}</p>
          )}
        </Step>

        <Step n={3} state={mic ? 'done' : 'todo'} title="Turn on the phone's microphone">
          <div className="modes">
            <button className={'mode' + (mic && camera ? ' on' : '')} disabled={!live} onClick={() => choose(true)}>
              <span>
                <Video />
                <Mic />
              </span>
              Camera + microphone
            </button>
            <button className={'mode' + (mic && !camera ? ' on' : '')} disabled={!live} onClick={() => choose(false)}>
              <span>
                <Mic />
              </span>
              Microphone only
            </button>
          </div>
          <p>{live ? 'Click one to switch the phone now.' : 'Pick one on the phone before tapping Start, or here once the phone is connected.'}</p>
          {mic && (
            <div className={'meter' + (flowing ? ' on' : '')}>
              <span>
                <i style={{ transform: `scaleX(${Math.min(1, level / 0.25)})` }} />
              </span>
              <small>{!sink ? 'The level shows once VB-CABLE is installed.' : flowing ? 'Hearing the phone' : 'Say something to the phone'}</small>
            </div>
          )}
        </Step>

        <Step n={4} state="todo" title="Choose it as the microphone in your app">
          <div className="mockselect">
            <span>Microphone</span>
            <b>
              <Mic />
              {micName}
              <ChevronDown />
            </b>
          </div>
          <ul className="where">
            <li>
              <b>Discord</b> User Settings → Voice & Video → Input Device
            </li>
            <li>
              <b>Zoom</b> Settings → Audio → Microphone
            </li>
            <li>
              <b>Teams</b> Settings → Devices → Microphone
            </li>
            <li>
              <b>Google Meet</b> Settings → Audio → Microphone
            </li>
          </ul>
        </Step>
      </ol>

      <div className="actions">
        <button className="btn" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

/** VB-CABLE's install, one screen at a time: a sentence, the screenshot (click to enlarge), Back / Next. */
function InstallSlides({ onDownload }: { onDownload: () => void }) {
  const [at, setAt] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const slide = INSTALL[at];
  return (
    <div className="slides">
      <div className="slidetabs" role="tablist">
        {INSTALL.map((s, i) => (
          <button key={s.tab} role="tab" aria-selected={i === at} className={i === at ? 'on' : i < at ? 'past' : ''} onClick={() => setAt(i)}>
            {i + 1}. {s.tab}
          </button>
        ))}
      </div>
      <p>{slide.text}</p>
      {at === 0 && (
        <button className="btn primary sm" onClick={onDownload}>
          Open the download page
          <ArrowUpRight />
        </button>
      )}
      {slide.shot && (
        <button className="shot" title="Click to enlarge" onClick={() => setZoomed(true)}>
          <img src={slide.shot} alt={slide.alt} />
        </button>
      )}
      <div className="slidenav">
        <button className="btn sm" disabled={at === 0} onClick={() => setAt(at - 1)}>
          Back
        </button>
        <span>
          {at + 1} of {INSTALL.length}
        </span>
        <button className="btn sm" disabled={at === INSTALL.length - 1} onClick={() => setAt(at + 1)}>
          Next
        </button>
      </div>
      {/* Outside the dialog, so it covers the whole window at the screenshot's real size. */}
      {zoomed &&
        slide.shot &&
        createPortal(
          <div className="zoom" onClick={() => setZoomed(false)}>
            <img src={slide.shot} alt={slide.alt} />
          </div>,
          document.body,
        )}
    </div>
  );
}

function Node({ state, icon, label, sub }: { state: State; icon: ReactNode; label: string; sub: string }) {
  return (
    <div className={`node ${state}`}>
      <span>{icon}</span>
      <b>{label}</b>
      <small>{sub}</small>
    </div>
  );
}

/** The wire between two parts: lit once both ends work, with dots running while sound goes through. */
function Link({ on, flowing }: { on: boolean; flowing: boolean }) {
  return <i className={'link' + (on ? ' on' : '') + (flowing ? ' flowing' : '')} />;
}

function Step({ n, state, title, children }: { n: number; state: State; title: string; children: ReactNode }) {
  return (
    <li className={`gstep ${state}`}>
      <span className="mark">{state === 'done' ? <Check /> : n}</span>
      <div>
        <h3>{title}</h3>
        {children}
      </div>
    </li>
  );
}
