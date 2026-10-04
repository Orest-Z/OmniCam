import geistSans from '../../../assets/brand/fonts/Geist-Variable.woff2?url';
import geistMono from '../../../assets/brand/fonts/GeistMono-Variable.woff2?url';

/** Self-hosted Geist: the phone is on a LAN page and must not depend on the internet. */
export function installFonts(): void {
  const style = document.createElement('style');
  style.textContent = [
    "@font-face { font-family: 'Geist'; src: url(" + JSON.stringify(geistSans) + ") format('woff2'); font-weight: 100 900; font-display: swap; }",
    "@font-face { font-family: 'Geist Mono'; src: url(" + JSON.stringify(geistMono) + ") format('woff2'); font-weight: 100 900; font-display: swap; }",
  ].join('\n');
  document.head.appendChild(style);
}
