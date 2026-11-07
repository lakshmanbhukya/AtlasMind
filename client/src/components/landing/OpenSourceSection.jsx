import { ArrowUpRight, Code, Github, Scale, User } from 'lucide-react';
import { cn } from '../../lib/utils';
import { DOCS_LEFT, DOCS_RIGHT, LINKS } from './demoData';
import { focusRing } from '../ui/vg/primitives';

function DocRow({ title, path }) {
  return (
    <li>
      <a
        href={LINKS.docsBase + path}
        target="_blank"
        rel="noreferrer"
        className={cn('h-14 flex items-center justify-between gap-4 border-b border-vg-line-soft group rounded-sm', focusRing)}
      >
        <span className="text-[16px]">{title}</span>
        <span className="flex items-center gap-4 min-w-0">
          <span className="font-code text-[12.5px] text-vg-text-3 truncate">{path}</span>
          <ArrowUpRight size={15} className="shrink-0 text-vg-text-3 group-hover:text-vg-accent transition-colors" aria-hidden="true" />
        </span>
      </a>
    </li>
  );
}

function FeatureLink({ href, title, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn('group flex items-start justify-between gap-6 rounded-md', focusRing)}
    >
      <span>
        <span className="font-read text-[24px] leading-[32px] lg:text-[26px] lg:leading-[34px] group-hover:underline decoration-vg-line underline-offset-[6px]">
          {title}
        </span>
        <span className="block mt-2 text-[14.5px] text-vg-text-2">{children}</span>
      </span>
      <ArrowUpRight size={20} className="mt-1 shrink-0 text-vg-text-3 group-hover:text-vg-accent transition-colors" aria-hidden="true" />
    </a>
  );
}

export default function OpenSourceSection() {
  return (
    <section
      id="source"
      data-nav="source"
      className="px-5 md:px-10 lg:px-20 py-24 lg:py-0 lg:min-h-[804px] lg:pt-[72px] flex flex-col justify-center bg-vg-char scroll-mt-[72px]"
    >
      <div className="w-full max-w-[1280px] mx-auto">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-10 border-b border-vg-line">
          <div className="min-w-0">
            <h2 className="font-code text-[24px] leading-[32px] md:text-[34px] md:leading-[42px] tracking-[-0.01em] break-words">
              <span className="text-vg-text-3">lakshmanbhukya/</span>AtlasMind
            </h2>
            <ul className="mt-3 text-[15px] text-vg-text-2 flex flex-wrap items-center gap-x-5 gap-y-2">
              <li className="flex items-center gap-1.5"><Scale size={15} aria-hidden="true" />MIT license</li>
              <li className="flex items-center gap-1.5"><User size={15} aria-hidden="true" />Lakshman Bhukya</li>
              <li className="flex items-center gap-1.5"><Code size={15} aria-hidden="true" />React 19 · Node · Express · MongoDB driver</li>
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={LINKS.liveDemo}
              target="_blank"
              rel="noreferrer"
              className={cn('h-11 px-4 rounded-lg border border-vg-line text-[14.5px] flex items-center gap-2 hover:bg-vg-surface-2', focusRing)}
            >
              Open live demo
              <ArrowUpRight size={15} className="text-vg-text-3" aria-hidden="true" />
            </a>
            <a
              href={LINKS.github}
              target="_blank"
              rel="noreferrer"
              className={cn('h-11 px-4 rounded-lg bg-vg-accent text-vg-ink text-[14.5px] font-semibold flex items-center gap-2 hover:brightness-110', focusRing)}
            >
              <Github size={16} aria-hidden="true" />
              View on GitHub
            </a>
          </div>
        </div>

        <nav aria-label="Documentation" className="mt-10 grid grid-cols-1 md:grid-cols-2 md:gap-x-16">
          <ul>{DOCS_LEFT.map((d) => <DocRow key={d.path} {...d} />)}</ul>
          <ul>{DOCS_RIGHT.map((d) => <DocRow key={d.path} {...d} />)}</ul>
        </nav>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-10 md:gap-16">
          <FeatureLink href={LINKS.architecture} title="Explore the interactive architecture">
            Request flow from intake routes through the query execution engine, safety validation and the user database.
          </FeatureLink>
          <FeatureLink href={LINKS.benchmark} title="AMB-MQL benchmark">
            Benchmark, evaluation runners and paper sources on the{' '}
            <span className="font-code text-[13px]">research/ambiguity-eval</span> branch.
          </FeatureLink>
        </div>
      </div>
    </section>
  );
}
