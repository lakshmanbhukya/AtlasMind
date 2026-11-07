import { cn } from '../../lib/utils';
import { LINKS } from './demoData';
import { LogoMark, focusRing } from '../ui/vg/primitives';
import { goToConnect } from './motion';

export default function SiteFooter() {
  const link = cn('hover:text-vg-text rounded', focusRing);
  return (
    <footer className="border-t border-vg-line bg-vg-bg text-[14px] text-vg-text-2">
      <div className="min-h-24 py-6 px-5 md:px-10 lg:px-20 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="flex items-center gap-2 text-vg-text">
            <LogoMark size="sm" />
            AtlasMind
          </span>
          <span>Built by Lakshman Bhukya</span>
          <span>MIT license</span>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <a href={LINKS.github} target="_blank" rel="noreferrer" className={link}>GitHub</a>
          <a href={LINKS.liveDemo} target="_blank" rel="noreferrer" className={link}>Live demo</a>
          <a
            href="#connect"
            onClick={goToConnect}
            className={cn('text-vg-text underline decoration-vg-accent-deep underline-offset-4 rounded', focusRing)}
          >
            Connect a cluster
          </a>
        </div>
      </div>
    </footer>
  );
}
