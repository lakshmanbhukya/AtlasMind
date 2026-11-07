import SiteHeader from './SiteHeader';
import Hero from './Hero';
import ClarifySection from './ClarifySection';
import ExecutionPathSection from './ExecutionPathSection';
import ModelsVoiceSection from './ModelsVoiceSection';
import OpenSourceSection from './OpenSourceSection';
import SiteFooter from './SiteFooter';

/**
 * Public landing page (Verdigris). Rendered by App.jsx when there is no
 * session; `onConnected` re-checks auth after a successful connect.
 */
export default function LandingPage({ onConnected }) {
  return (
    <div className="landing-root font-ui bg-vg-bg text-vg-text antialiased min-h-screen overflow-x-clip">
      <a
        href="#connect"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:px-3 focus:py-2 focus:rounded-lg focus:bg-vg-text focus:text-vg-bg"
      >
        Skip to connect
      </a>
      <SiteHeader />
      <main>
        <Hero onConnected={onConnected} />
        <ClarifySection />
        <ExecutionPathSection />
        <ModelsVoiceSection />
        <OpenSourceSection />
      </main>
      <SiteFooter />
    </div>
  );
}
