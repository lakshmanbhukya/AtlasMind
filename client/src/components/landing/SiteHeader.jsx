import { useEffect, useState } from 'react';
import { Github, Menu, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDismiss } from '../../hooks/useDismiss';
import { LINKS, NAV_SECTIONS } from './demoData';
import { LogoMark, focusRing } from '../ui/vg/primitives';
import { goToConnect } from './motion';

function useActiveSection() {
  const [active, setActive] = useState('product');
  useEffect(() => {
    const targets = document.querySelectorAll('[data-nav]');
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.dataset.nav)),
      { rootMargin: '-45% 0px -50% 0px' }
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);
  return active;
}

export default function SiteHeader() {
  const active = useActiveSection();
  const [menuOpen, setMenuOpen] = useState(false);

  useDismiss(menuOpen, () => setMenuOpen(false), { outside: false });

  const navLink = (s, mobile = false) => (
    <a
      key={s.id}
      href={`#${s.id}`}
      aria-current={active === s.id ? 'true' : undefined}
      onClick={() => setMenuOpen(false)}
      className={cn(
        'rounded-lg flex items-center transition-colors',
        mobile ? 'h-11 px-3 text-[15px]' : 'h-10 px-3.5',
        active === s.id ? 'text-vg-text bg-vg-surface' : 'hover:text-vg-text hover:bg-vg-surface',
        focusRing
      )}
    >
      {s.label}
    </a>
  );

  return (
    <header
      data-name="site header"
      className="sticky top-0 z-50 border-b border-vg-line-soft bg-vg-bg/85 backdrop-blur-md"
    >
      <div className="h-[72px] px-5 md:px-10 lg:px-20 flex items-center justify-between">
        <a href="#product" className={cn('flex items-center gap-2.5 rounded-lg', focusRing)}>
          <LogoMark />
          <span className="text-[17px] font-semibold tracking-tight">AtlasMind</span>
        </a>

        <nav aria-label="Sections" className="hidden md:flex items-center gap-1 text-[14.5px] text-vg-text-2">
          {NAV_SECTIONS.map((s) => navLink(s))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={LINKS.github}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'hidden sm:flex h-10 px-3.5 rounded-lg items-center gap-2 text-[14.5px] text-vg-text-2 hover:text-vg-text hover:bg-vg-surface',
              focusRing
            )}
          >
            <Github size={16} aria-hidden="true" />
            GitHub
          </a>
          <a
            href="#connect"
            onClick={goToConnect}
            className={cn(
              'h-10 px-4 rounded-lg bg-vg-text text-vg-bg text-[14.5px] font-semibold flex items-center hover:bg-white transition-colors',
              focusRing
            )}
          >
            Connect a cluster
          </a>
          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((o) => !o)}
            className={cn(
              'md:hidden w-10 h-10 rounded-lg flex items-center justify-center text-vg-text-2 hover:bg-vg-surface',
              focusRing
            )}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="mobile-nav"
          aria-label="Sections"
          className="md:hidden border-t border-vg-line-soft px-5 py-3 flex flex-col gap-0.5 text-vg-text-2"
        >
          {NAV_SECTIONS.map((s) => navLink(s, true))}
          <a
            href={LINKS.github}
            target="_blank"
            rel="noreferrer"
            className={cn('h-11 px-3 rounded-lg flex items-center gap-2 text-[15px] hover:bg-vg-surface', focusRing)}
          >
            <Github size={16} aria-hidden="true" />
            GitHub
          </a>
        </nav>
      )}
    </header>
  );
}
