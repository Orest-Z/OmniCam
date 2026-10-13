import type { ReactNode } from 'react';
import { AppWindow, ArrowUpRight, AudioLines, Cable, Check, ChevronDown, Mic, Smartphone, Video } from 'lucide-react';
import type { DesktopToPhone } from '@omnicam/protocol';
import type { AppSettings, StreamStats } from '../../shared/ipc';
import { micNameFor, pickSink } from '../../shared/audio-sink';
import { useLoopbacks } from '../useLoopbacks';
import { SPEAKING_LEVEL } from './LiveView';
import { Dialog } from './ui';

/** The free virtual cable the phone's microphone plays into. Linked, never bundled: that needs VB-Audio's permission. */
const VB_CABLE_URL = 'https://vb-audio.com/Cable/';
/** Windows Settings → Sound (main only opens this exact non-web address). */
const SOUND_SETTINGS = 'ms-settings:sound';
/** What apps call the cable's microphone side until a cable is found. */
const VB_CABLE_MIC = 'CABLE Output (VB-Audio Virtual Cable)';

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
        With or without its camera. Windows only lets a driver add a microphone, so OmniCam sends the phone's sound through{' '}
        <b>VB-CABLE</b>, a free virtual audio cable. Each step ticks itself once it's done.
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
        <Step n={1} state={sink ? 'done' : 'todo'} title="Install VB-CABLE">
          {sink ? (
            <p>
              Found <b>{sink.label}</b>.
            </p>
          ) : (
            <>
              <p>Free, from VB-Audio. Then restart the computer so Windows picks it up.</p>
              <div className="mockdialog">
                <b>In the downloaded zip</b>
                Right-click the setup file, run it as administrator, and install:
                <br />
                <span className="tap">VBCABLE_Setup_x64</span>
                <span className="tap">Run as administrator</span>
                <span className="tap">Install Driver</span>
              </div>
              <button className="btn primary sm" onClick={() => open(VB_CABLE_URL)}>
                Download VB-CABLE
                <ArrowUpRight />
              </button>
            </>
          )}
        </Step>

        <Step n={2} state={cable === 'done' ? 'done' : cable} title="Keep your speakers as the sound output">
          {cable === 'bad' ? (
            <>
              <p>
                Windows now plays everything into the cable, so apps would hear your whole computer through the phone. Choose your speakers or
                headphones as the output again.
              </p>
              <button className="btn sm" onClick={() => open(SOUND_SETTINGS)}>
                Open Sound settings
                <ArrowUpRight />
              </button>
            </>
          ) : (
            <p>{sink ? 'Windows still plays through your speakers.' : "VB-CABLE's installer can make itself the default; this is checked after step 1."}</p>
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
          <p>
            {live
              ? 'Click one to switch the phone now.'
              : "Pick one on the phone's start screen before tapping Start. Once a phone is connected, you can switch here too."}
          </p>
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
