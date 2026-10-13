import geistSans from '../../../../assets/brand/fonts/Geist-Variable.woff2?url';
import geistMono from '../../../../assets/brand/fonts/GeistMono-Variable.woff2?url';

/** Injects self-hosted Geist so the app never depends on system fonts or the network. */
export function installFonts(): void {
  const style = document.createElement('style');
  style.textContent = `
    @font-face { font-family: 'Geist'; src: url(${JSON.stringify(geistSans)}) format('woff2'); font-weight: 100 900; font-display: swap; }
    @font-face { font-family: 'Geist Mono'; src: url(${JSON.stringify(geistMono)}) format('woff2'); font-weight: 100 900; font-display: swap; }
  `;
  document.head.appendChild(style);
}
