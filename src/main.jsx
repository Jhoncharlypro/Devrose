import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles/index.css'
import './styles/atelier.css'
import './styles/kot3-profile.css'
import './styles/kot3-privacy-space.css'

// Class-based error boundary — React 18 still requires a class for
// ``getDerivedStateFromError`` (no hook equivalent yet). Catches any
// render-phase crash in the tree below it and swaps to a friendly
// fallback UI instead of unmounting to an empty #root (which would
// leave the user staring at the body's --pink-bg, a confusing
// "uniform pink" page that gives zero signal about what broke).
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    // Always log to console so the dev/QA engineer can dig into the full
    // stack. We also stash ``errorInfo`` on state so the dev-only
    // component-stack <pre> block below can render it without an extra
    // round-trip through a global handler.
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, errorInfo);
    if (import.meta.env && import.meta.env.DEV) {
      // Mutating state inside componentDidCatch triggers a re-render with
      // the new errorInfo. Safe in React 18 (the lifecycle docs explicitly
      // permit it for this case).
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ errorInfo });
    }
  }
  handleReload = () => {
    try { window.location.reload(); } catch (_) { /* ignore */ }
  };
  render() {
    if (this.state.hasError) {
      // Bilingual fallback so a Haitian-Creole user sees a Creole error
      // (matching the rest of the app's lang pattern) instead of an
      // English-only page that, on top of the body bg, would feel
      // like the app is fully foreign / broken. Read from localStorage
      // directly because the ErrorBoundary sits ABOVE <App /> and has
      // no access to the App-level lang state. Defaults to 'ht' (the
      // app's primary audience) so a fresh visitor with no
      // devrose_lang set still gets the right copy.
      const lang = (typeof window !== 'undefined' && (window.localStorage && localStorage.getItem('devrose_lang'))) || 'ht';
      const isHt = lang === 'ht';
      const t = {
        heading: isHt ? 'Gen yon pwoblèm' : 'Something went wrong',
        body: isHt
          ? 'Aplikasyon an kraze. Erè a anrejistre nan konsòl navigatè a.'
          : 'The app crashed during render. The error has been logged to the browser console.',
        button: isHt ? 'Rechaje paj la' : 'Reload page',
        devStack: isHt ? 'Stack konpozan (dev sèlman):' : 'Component stack (dev only):',
        unknownError: isHt ? 'Erè enkoni' : 'Unknown error',
      };
      // Defensive: React 18 always passes a non-null error, but optional
      // chaining keeps us safe against a future React change OR a
      // non-Error throwable. The ?? chain makes ``null.message`` a no-op.
      // For plain-object throwables (case d) we JSON.stringify so the
      // user sees the actual fields instead of ``"[object Object]"``.
      const msg =
        (this.state.error
          && (this.state.error.message
            ?? (typeof this.state.error === 'object'
              ? (() => { try { return JSON.stringify(this.state.error, null, 2); } catch (_) { return String(this.state.error); } })()
              : String(this.state.error))))
        ?? t.unknownError;
      const stack =
        import.meta.env && import.meta.env.DEV
          ? (this.state.errorInfo && this.state.errorInfo.componentStack) || null
          : null;
      return (
        <div
          role="alert"
          style={{
            padding: '40px 24px',
            fontFamily: "'Poppins', system-ui, sans-serif",
            maxWidth: '560px',
            margin: '60px auto',
            background: '#ffffff',
            border: '1px solid rgba(216, 27, 96, 0.18)',
            borderLeft: '6px solid #d81b60',
            borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08)',
            color: '#333',
          }}
        >
          <h1 style={{ margin: '0 0 12px 0', color: '#d81b60', fontSize: '1.4rem' }}>
            {t.heading}
          </h1>
          <p style={{ margin: '0 0 16px 0', fontSize: '0.95rem', lineHeight: 1.5 }}>
            {t.body}
          </p>
          <pre
            style={{
              background: 'rgba(216, 27, 96, 0.06)',
              border: '1px solid rgba(216, 27, 96, 0.12)',
              borderRadius: '8px',
              padding: '10px 12px',
              fontSize: '0.78rem',
              overflow: 'auto',
              maxHeight: '160px',
              margin: '0 0 16px 0',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {msg}
          </pre>
          {stack && (
            <pre
              data-testid="dev-component-stack"
              style={{
                background: 'rgba(0, 0, 0, 0.04)',
                border: '1px solid rgba(0, 0, 0, 0.08)',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '0.72rem',
                overflow: 'auto',
                maxHeight: '180px',
                margin: '0 0 16px 0',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#555',
              }}
            >
              <strong style={{ color: '#888', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t.devStack}</strong>
              {'\n'}
              {stack}
            </pre>
          )}
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              background: '#d81b60',
              color: '#ffffff',
              border: 'none',
              padding: '10px 18px',
              borderRadius: '10px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.9rem',
            }}
          >
            {t.button}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

console.log('Main.jsx starting...');
const rootElem = document.getElementById('root');
console.log('Root element found:', !!rootElem);

if (rootElem) {
  try {
    ReactDOM.createRoot(rootElem).render(
      <React.StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
      </React.StrictMode>,
    )
    console.log('React Render called');
  } catch (e) {
    console.error('React Render Error:', e);
    rootElem.innerHTML = '<h1 style="color:red; padding:20px;">React Crash: ' + e.message + '</h1>';
  }
} else {
    document.body.innerHTML += '<h1 style="color:red; padding:20px;">Error: #root not found</h1>';
}

