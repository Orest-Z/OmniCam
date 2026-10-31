import { useEffect } from 'react';
import { X } from 'lucide-react';
import { NEUTRAL_PICTURE, type Picture } from '../../shared/ipc';
import { IconButton } from './ui';

const SLIDERS: { key: keyof Picture; label: string }[] = [
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturation', label: 'Saturation' },
  { key: 'warmth', label: 'Warmth' },
];

/** Settings saved before this panel existed have no picture values: treat them as unchanged. */
export const pictureOf = (picture: Partial<Picture> | undefined): Picture => ({ ...NEUTRAL_PICTURE, ...picture });

export const pictureChanged = (picture: Partial<Picture> | undefined) => SLIDERS.some(({ key }) => pictureOf(picture)[key] !== 0);

/**
 * Brightness, contrast, saturation and warmth, applied on this PC to what apps receive (and the preview),
 * so they work the same with every phone. Floats over the preview, so the picture stays visible.
 */
export function PicturePanel({ picture, onChange, onClose }: { picture: Partial<Picture> | undefined; onChange: (p: Picture) => void; onClose: () => void }) {
  const p = pictureOf(picture);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="picture" role="dialog" aria-label="Picture">
      <header>
        <b>Picture</b>
        <button className="link" disabled={!pictureChanged(p)} onClick={() => onChange(NEUTRAL_PICTURE)}>
          Reset
        </button>
        <IconButton title="Close" onClick={onClose}>
          <X />
        </IconButton>
      </header>
      {SLIDERS.map(({ key, label }) => (
        <label key={key} title="Double-click to reset">
          <span>
            {label}
            <output>{p[key] > 0 ? `+${p[key]}` : p[key]}</output>
          </span>
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            value={p[key]}
            onChange={(e) => onChange({ ...p, [key]: Number(e.target.value) })}
            onDoubleClick={() => onChange({ ...p, [key]: 0 })}
          />
        </label>
      ))}
    </div>
  );
}
