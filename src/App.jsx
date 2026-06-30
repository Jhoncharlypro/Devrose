/**
 * App.jsx — root component for the DevRose Academy frontend.
 *
 * Top-level responsibilities (in render order):
 *   1. Read user / session / progress / favorites from the Django backend
 *      on mount and re-hydrate them into local state.
 *   2. Hold the active tab + selected course + theme/font/lang settings
 *      that drive the entire SPA.
 *   3. Dispatch toasts and live-fullscreen toggles.
 *
 * WHY do we use a manual `activeTab` state machine instead of
 * `react-router-dom` (already installed)?
 *   - The app grew shell-by-shell around a single `activeTab` slice early on.
 *   - Several features rely on cross-tab state that survives navigation:
 *       • `selectedCourse` carries into CourseDetail;
 *       • `isLiveFullscreen` is toggled by LiveClassroom and read by Header;
 *       • `?room=…` deep links into a fullscreen Live Classroom without
 *         tearing down the active chat socket.
 *   - Switching to react-router-dom would force re-deriving all of the
 *     above without functional benefit. Keep manual routing unless we are
 *     also adding server-side rendering.
 *
 * Tab reference: see src/components/Tabs.jsx for the canonical tab ids;
 * renderContent() below mirrors that list in its switch statement.
 */
import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import Tabs from './components/Tabs';
import SearchBar from './components/SearchBar';
import CourseDetail from './components/CourseDetail';
import Roadmap from './components/Roadmap';
import Terminal from './components/Terminal';
import Rules from './components/Rules';
import Wizard from './components/Wizard';
import Settings from './components/Settings';
import Auth from './components/Auth';
import Chatbot from './components/Chatbot';
import Footer from './components/Footer';
import Features from './components/Features';
import FAQ from './components/FAQ';
import Stats from './components/Stats';
import DashboardPreview from './components/DashboardPreview';
import NotFound from './components/NotFound';
import SkeletonCard from './components/SkeletonCard';
import ClassroomView from './components/ClassroomView';
import LiveClassroom from './components/LiveClassroom';
import Kot3Chat from './components/Kot3Chat';
import Kot3ChatDesktop from './components/kot3chat/Kot3ChatDesktop';
import { translations } from './data/translations';
import { courseService, authService, sessionService, progressService, profileService, favoriteService, chatService, clearTokenPair, broadcastLogout, isSupabaseSessionActive } from './services/api';
import { getSupabase, getSupabaseSession, isSupabaseConfigured } from './services/supabase';

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function App() {
  const [lang, setLang] = useState(localStorage.getItem('devrose_lang') || 'ht');
  const [activeTab, setActiveTab] = useState('commerce');
  const [courses, setCourses] = useState([]);
  const [userProgress, setUserProgress] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [user, setUser] = useState(null);
  const [filteredCourses, setFilteredCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [darkMode, setDarkMode] = useState(localStorage.getItem('devrose_theme') === 'dark');
  const [fontSize, setFontSize] = useState(parseInt(localStorage.getItem('devrose_fontsize')) || 16);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [isLiveFullscreen, setIsLiveFullscreen] = useState(() => {
    return Boolean(new URLSearchParams(window.location.search).get('room'));
  });
  // ``suppressNextSignOutBroadcast`` is set to ``true`` for one SB
  // ``SIGNED_OUT`` cycle when WE initiated the logout (see handleLogout
  // — wraps ``await sb.auth.signOut()`` in a try/finally). It prevents
  // the SB subscription below from firing a second toast AFTER
  // handleLogout already showed the right copy.
  const suppressNextSignOutBroadcast = useRef(false);

  const toggleTheme = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem('devrose_theme', newMode ? 'dark' : 'light');
  };

  const showToast = (message, icon = 'info-circle') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, icon }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const handleLangChange = (newLang) => {
    setLang(newLang);
    localStorage.setItem('devrose_lang', newLang);
    showToast(translations[newLang].lang_changed || 'Language changed', 'language');
  };

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    setIsAuthOpen(false);
    // Fetch Session and Progress for the new user
    sessionService.get().then(sRes => {
      if (sRes.data.current_tab) setActiveTab(sRes.data.current_tab);
    });
    progressService.getAll().then(pRes => {
      setUserProgress(pRes.data);
    });
    favoriteService.getAll().then(fRes => {
      setFavorites(fRes.data.map(f => f.course));
    });
  };

  const handleLogout = async (reason = 'user') => {
    // Best-effort: tell the server to blacklist the current refresh token
    // so it can't be reused after we drop it client-side. We don't block the
    // local logout on this — if the request fails (e.g. already-expired
    // refresh) we still wipe localStorage and proceed.
    //
    // WHY skip the server call when ``reason='session_expired'``: on a
    // forced expiry the refresh token is already blacklisted server-side
    // (the /api/refresh/ call that triggered this forced-logout itself
    // returned 401). Hitting /api/logout/ again would just give us another
    // 401 and waste a request. Settings.jsx route passes 'user' so the
    // explicit Logout button still triggers the server-side blacklist.
    const refresh = localStorage.getItem('refresh_token');
    if (refresh && reason === 'user') {
      try { await authService.logout(refresh); } catch (e) { /* ignore — tokens may already be invalid */ }
    }
    // If the active session came from Supabase, sign out there too so
    // the next visit doesn't auto-rehydrate the same orphan user.
    // We catch every error — a half-broken Supabase session must NEVER
    // block local logout (the alternative is a user stuck logged-in on
    // their own machine).
    //
    // The suppression flag short-circuits the SB ``SIGNED_OUT`` listener
    // below so OUR initiative doesn't fan out a second
    // "Session expired. Please log in again." toast — the user already
    // saw the right copy ("Logged out!" / "Password changed" / "Account
    // deleted") above. Only server-driven SIGNED_OUT events (whose
    // initiator is NOT this very function) trigger the listener's
    // ``handleLogout('session_expired')`` path.
    if (isSupabaseSessionActive()) {
      suppressNextSignOutBroadcast.current = true;
      try {
        const sb = getSupabase();
        if (sb) {
          const { error: sbOutErr } = await sb.auth.signOut();
          if (sbOutErr) {
            // eslint-disable-next-line no-console
            console.warn('Supabase signOut error (non-fatal):', sbOutErr);
          }
        }
      } catch (sbErr) {
        // eslint-disable-next-line no-console
        console.warn('Supabase signOut threw (non-fatal):', sbErr);
      } finally {
        // Reset on the next microtask so a *future* SB-driven sign-out
        // (e.g. another tab signed us out, server-side expiry) still
        // broadcasts normally. Setting to false synchronously here would
        // still race the SB event because the SB SDK fires SIGNED_OUT
        // AFTER the await above resolves — so it's safe to await, then
        // clear. queueMicrotask ensures we clear on the same tick the
        // SB listener finishes.
        queueMicrotask(() => { suppressNextSignOutBroadcast.current = false; });
      }
    }
    // Wipe EVERYTHING auth-related. `clearTokenPair` clears both Django
    // and Supabase keys so a stale token from one system can't survive
    // the next session (see api.js → clearTokenPair body).
    clearTokenPair();
    setUser(null);
    setUserProgress([]);
    setActiveTab('commerce');
    // Reason-aware toast: a forced expiry ≠ a user-clicked Logout, and
    // saying "Ou dekonekte!" when the user didn't click anything just
    // confuses them into thinking the server disconnected (see Profile
    // page auto-logout bug). Per-reason copy:
    let toastMsg = lang === 'ht' ? 'Ou dekonekte!' : 'Logged out!';
    if (reason === 'session_expired') {
      toastMsg = lang === 'ht'
        ? 'Sesyon ou ekspire. Tanpri konekte ankò.'
        : 'Session expired. Please log in again.';
    } else if (reason === 'password_changed') {
      toastMsg = lang === 'ht' ? 'Modpas chanje. Ou dekonekte.' : 'Password changed. Logged out.';
    } else if (reason === 'account_deleted') {
      toastMsg = lang === 'ht' ? 'Kont ou efase.' : 'Account deleted.';
    }
    showToast(toastMsg, 'sign-out-alt');
  };

  const refreshUser = () => {
    authService.getMe().then(res => {
      setUser(res.data);
      localStorage.setItem('user', JSON.stringify(res.data));
    }).catch(err => console.error("Refresh error:", err));
  };

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    localStorage.setItem('devrose_fontsize', fontSize);
  }, [fontSize]);

  useEffect(() => {
    if (darkMode) document.body.classList.add('dark-mode');
    else document.body.classList.remove('dark-mode');
  }, [darkMode]);

  // Keep body class in sync with Live Fullscreen state so CSS hides chrome
  useEffect(() => {
    if (isLiveFullscreen) {
      document.body.classList.add('live-fullscreen-active');
    } else {
      document.body.classList.remove('live-fullscreen-active');
    }
    return () => {
      document.body.classList.remove('live-fullscreen-active');
    };
  }, [isLiveFullscreen]);

  // Load User and Session
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      setActiveTab('live_classroom');
    }

    // JWT: read from either Django (access_token / legacy token) or
    // Supabase (sb_access_token). The api.js interceptor prioritizes
    // sb_ over the Django pair, so as long as ANY token is present we
    // can attempt /api/me/ and the right one will be sent.
    const token =
      localStorage.getItem('sb_access_token')
      || localStorage.getItem('access_token')
      || localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedUser) {
      try { setUser(JSON.parse(storedUser)); } catch { /* ignore corrupt cache */ }
    }

    // Listen for forced sign-outs triggered by the axios interceptor when the
    // refresh token is rejected by the server (e.g. expired/blacklisted).
    // Delegate to ``handleLogout`` so the reason-aware toast strings
    // (Session expired / Password changed / Account deleted) match the
    // event the server threw. We pull the ``reason`` from
    // ``event.detail`` (defined in api.js → broadcastLogout).
    const onForcedLogout = (e) => {
      handleLogout(e?.detail?.reason || 'session_expired');
    };
    window.addEventListener('devrose:auth:logout', onForcedLogout);

    // Supabase-session rehydration. If Supabase is configured AND the
    // supabase-js client has a non-expired session in its own localStorage
    // slot, mirror it into our sb_ keys before calling /api/me/ so the
    // axios interceptor ships the right JWT. This lets a page reload
    // keep the user signed-in when they originally signed in via Supabase.
    //
    // ORDER MATTERS: subscribe to onAuthStateChange FIRST (sync) so a
    // TOKEN_REFRESHED fired during the await on getSupabaseSession()
    // can't race past us and leave sb-devrose-auth out of sync with our
    // mirrored sb_access_token.
    let supabaseSub = null;
    if (isSupabaseConfigured()) {
      try {
        const sbClient = getSupabase();
        if (sbClient && sbClient.auth && typeof sbClient.auth.onAuthStateChange === 'function') {
          const { data } = sbClient.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT' || !session) {
              clearTokenPair();
              setUser(null);
              // If this SignOut came from ``handleLogout``'s own
              // ``await sb.auth.signOut()`` call, the suppression flag
              // is true and we SKIP the broadcast (handleLogout already
              // showed its own toast). Otherwise — server-driven expiry,
              // sign-out from another tab, etc. — we fan out so
              // ``onForcedLogout`` can run ``handleLogout('session_expired')``
              // and surface the "Session expired." toast. (Pre-fix, this
              // path ran via the now-removed broadcast inside
              // ``clearTokenPair()`` — removing that created a regression
              // for SB users on server-side expiry, this restores it.)
              if (!suppressNextSignOutBroadcast.current) {
                broadcastLogout('session_expired');
              }
            } else if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session?.access_token) {
              try {
                localStorage.setItem('sb_access_token', session.access_token);
                if (session.refresh_token) localStorage.setItem('sb_refresh_token', session.refresh_token);
              } catch (_) {}
            }
          });
          supabaseSub = data?.subscription || null;
        }
      } catch (_) {
        // Don't block boot if wiring fails — the axios interceptor
        // still handles 401 refresh on its own via refreshSupabaseSession().
      }
      // 1. One-shot restore from localStorage (after the listener is
      // wired so any concurrent TOKEN_REFRESHED is captured).
      getSupabaseSession().then((session) => {
        if (!session || !session.access_token) return;
        try {
          localStorage.setItem('sb_access_token', session.access_token);
          if (session.refresh_token) localStorage.setItem('sb_refresh_token', session.refresh_token);
        } catch (_) { /* ignore */ }
        // 2. Refresh the canonical /api/me/ so the UI gets the Django-side
        //    user + profile shape (canonical UserSerializer).
        authService.getMe()
          .then((res) => {
            setUser(res.data);
            try { localStorage.setItem('user', JSON.stringify(res.data)); } catch (_) {}
          })
          .catch((err) => {
            // If /api/me/ STILL 401s after refreshSupabaseSession() ran
            // inside the interceptor, the sb session is unrecoverable —
            // give up and clear the sb pair so the next visit starts fresh.
            if (err?.response?.status === 401) {
              try { getSupabase()?.auth.signOut(); } catch (_) {}
            }
          });
      });
    }

    if (token) {
      authService.getMe()
        .then(res => {
          const userData = res.data;
          setUser(userData);
          try { localStorage.setItem('user', JSON.stringify(userData)); } catch (_) {}

          // Restore Session from Backend
          sessionService.get().then(sRes => {
            if (sRes.data.current_tab) {
              setActiveTab(sRes.data.current_tab);
            }
          }).catch(e => console.log('Session sync error', e));

          // Load Progress & Favorites
          progressService.getAll().then(pRes => setUserProgress(pRes.data)).catch(e => console.log(e));
          favoriteService.getAll().then(fRes => setFavorites(fRes.data.map(f => f.course))).catch(e => console.log(e));
        })
        .catch((err) => {
          console.error("Auth error:", err);
          if (err.response?.status === 401) {
            // 401 on boot's /api/me/ means the stored refresh token is
            // dead — pass 'session_expired' so the user sees
            // "Session expired. Please log in again." instead of the
            // misleading "Ou dekonekte!" (which implies they clicked).
            handleLogout('session_expired');
          }
        });
    }

    return () => {
      window.removeEventListener('devrose:auth:logout', onForcedLogout);
      if (supabaseSub && typeof supabaseSub.unsubscribe === 'function') {
        try { supabaseSub.unsubscribe(); } catch (_) {}
      }
    };
  }, []);

  const toggleFavorite = (courseId) => {
    if (!user) {
      showToast(lang === 'ht' ? 'Ou dwe konekte pou w mete yon kou nan favori.' : 'Login to favorite a course.', 'user-lock');
      setIsAuthOpen(true);
      return;
    }

    const isFav = favorites.includes(courseId);
    
    // Optimistic Update
    if (isFav) {
      setFavorites(prev => prev.filter(id => id !== courseId));
      favoriteService.remove(courseId).catch(() => {
        setFavorites(prev => [...prev, courseId]); 
        showToast('Erè nan koneksyon.', 'exclamation-triangle');
      });
    } else {
      setFavorites(prev => [...prev, courseId]);
      favoriteService.create(courseId).catch(() => {
        setFavorites(prev => prev.filter(id => id !== courseId));
        showToast('Erè nan koneksyon.', 'exclamation-triangle');
      });
    }
  };

  // Sync Session Tab to Backend
  useEffect(() => {
    if (user) {
      sessionService.update({ current_tab: activeTab });
    }
  }, [activeTab, user]);

  useEffect(() => {
    setIsLoadingCourses(true);
    courseService.getAll()
      .then(res => {
        try {
          if (res.data && Array.isArray(res.data)) {
            // Shuffle the order of courses to randomize them on every refresh.
            // We intentionally do NOT filter titles (an earlier version hid
            // any course whose title contained "Pro" via /\bpro\b/i — that
            // dropped real sellable courses like "Python Pro (Automation)"
            // from commerce + favori even after the user enrolled via the
            // Wizard, which reads `selectedCourse` directly and bypassed
            // this filter). Every course the API returns is rendered.
            const shuffled = shuffleArray(res.data);
            setCourses(shuffled);
            setFilteredCourses(shuffled);
          }
        } catch (innerErr) {
          console.error('Inner react logic error:', innerErr);
          showToast('Erè entèn: ' + innerErr.message, 'exclamation-triangle');
        }
      })
      .catch(err => {
        console.error('Error fetching courses:', err);
        showToast('Erè nan koneksyon ak sèvè a: ' + (err.response?.statusText || err.message), 'exclamation-triangle');
      })
      .finally(() => setIsLoadingCourses(false));
  }, []);

  const handleSearch = (query) => {
    const filtered = courses.filter(course => 
      course.title.toLowerCase().includes(query.toLowerCase()) ||
      course.description.toLowerCase().includes(query.toLowerCase())
    );
    setFilteredCourses(filtered);
  };

  const t = translations[lang] || translations['ht'];

  // Routing / View Logic
  const renderContent = () => {
    switch (activeTab) {
      case 'commerce':
        return (
          <div className="fade-in-up">
            <div style={{ textAlign: 'center', marginBottom: '30px' }}>
              <h2 style={{ color: 'var(--pink-primary)' }}>{t.hero_title}</h2>
              <p dangerouslySetInnerHTML={{ __html: t.hero_desc }}></p>
            </div>

            <SearchBar lang={lang} translations={translations} onSearch={handleSearch} />
            
            <div className="product-grid">
              {isLoadingCourses ? (
                [1, 2, 3, 4].map(i => <SkeletonCard key={i} />)
              ) : filteredCourses.length > 0 ? filteredCourses.map(course => (
                <div key={course.id} className="product-card" onClick={() => { setSelectedCourse(course); setActiveTab('description'); }}>
                  {course.is_featured && <div className="badge-featured"><i className="fas fa-star"></i> {t.featured_badge}</div>}
                  <div className="badge-live">{t.live_badge}</div>
                  <div className="favorite-btn" onClick={(e) => { e.stopPropagation(); toggleFavorite(course.id); }} style={{
                    position: 'absolute', top: '10px', right: '10px', zIndex: 20, background: 'rgba(255,255,255,0.9)', 
                    width: '35px', height: '35px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: favorites.includes(course.id) ? 'var(--pink-primary)' : '#ccc', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
                  }}>
                    <i className={favorites.includes(course.id) ? 'fas fa-heart' : 'far fa-heart'}></i>
                  </div>
                  <div className="product-image-container" style={{ width: '100%', aspectRatio: '16/9', overflow: 'hidden', borderRadius: '12px', marginBottom: '15px' }}>
                    <img 
                      src={course.image_url} 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                      alt={course.title}
                      onError={(e) => { e.target.src = `https://via.placeholder.com/600x340/d81b60/ffffff?text=${encodeURIComponent(course.title)}` }}
                    />
                    <div className="product-overlay">{t.full_details_title}</div>
                  </div>
                  <span className="product-name">{course.title}</span>
                  <span className="product-price"><span className="price-label">{t.price_label}</span> ${course.price}</span>
                  <button className="btn-action">{t.enroll_btn}</button>
                </div>
              )) : (
                <div style={{ textAlign: 'center', gridColumn: '1 / -1', padding: '50px' }}>
                   <p>Pa gen okenn kou ki jwenn.</p>
                </div>
              )}
            </div>

            <Features lang={lang} translations={translations} />
            
            {user && (
              <DashboardPreview 
                lang={lang} 
                translations={translations} 
                userProgress={userProgress} 
                courses={courses}
                onJoin={() => setActiveTab('terminal')}
              />
            )}

            <Stats lang={lang} translations={translations} />
            <FAQ lang={lang} translations={translations} />
          </div>
        );
      case 'description':
        return selectedCourse ? (
          <CourseDetail 
            course={selectedCourse} 
            lang={lang} 
            translations={translations} 
            onBack={() => setActiveTab('commerce')}
            onEnroll={() => setIsWizardOpen(true)}
          />
        ) : (
          <NotFound onBack={() => setActiveTab('commerce')} />
        );
      case 'roadmap':
        return <Roadmap lang={lang} translations={translations} />;
      case 'favori':
        return (
          <div className="fade-in-up">
            <div style={{ textAlign: 'center', marginBottom: '30px' }}>
              <h2 style={{ color: 'var(--pink-primary)' }}>Favori m yo</h2>
              <p>Tout kou ou renmen yo kote yo ye a.</p>
            </div>
            {favorites.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '50px' }}>
                <i className="far fa-heart" style={{ fontSize: '3rem', color: '#ccc', marginBottom: '20px' }}></i>
                <p>Ou poko gen okenn kou nan favori.</p>
                <button className="btn-action" onClick={() => setActiveTab('commerce')} style={{ width: 'auto' }}>Wè tout kou yo</button>
              </div>
            ) : (
                <div className="product-grid">
                    {courses.filter(c => favorites.includes(c.id)).map(course => (
                        <div key={course.id} className="product-card" onClick={() => { setSelectedCourse(course); setActiveTab('description'); }}>
                            <span className="product-name">{course.title}</span>
                            <button className="btn-action">Detay</button>
                        </div>
                    ))}
                </div>
            )}
          </div>
        );
      case 'terminal':
        if (!user) {
          return (
            <div style={{ textAlign: 'center', padding: '50px' }} className="fade-in-up">
              <i className="fas fa-lock" style={{ fontSize: '3rem', color: '#ccc', marginBottom: '20px' }}></i>
              <h3>Seksyon sa a pwoteje</h3>
              <p>Ou dwe konekte pou w ka itilize similatè a.</p>
              <button className="btn-action" onClick={() => setIsAuthOpen(true)} style={{ width: 'auto' }}>Konekte kounye a</button>
            </div>
          );
        }
        return (
          <div className="fade-in-up">
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <h2 style={{ color: 'var(--pink-primary)' }}>{t.simulator_title}</h2>
              <p>{t.simulator_desc}</p>
            </div>
            <Terminal lang={lang} translations={translations} />
          </div>
        );
      case 'classroom':
        if (!user || !selectedCourse) {
           setActiveTab('commerce');
           return null;
        }
        return (
          <ClassroomView 
            isOpen={true} 
            onClose={() => setActiveTab('commerce')} 
            course={selectedCourse} 
            user={user} 
          />
        );
      case 'live_classroom':
        return (
          <LiveClassroom
            lang={lang}
            translations={translations}
            user={user}
            showToast={showToast}
            onActiveRoomChange={setIsLiveFullscreen}
          />
        );
      case 'kot3chat':
        return (
          <Kot3ChatDesktop
            lang={lang}
            user={user}
            showToast={showToast}
            translations={translations}
            onLogout={handleLogout}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        );
      case 'rules':
        return <Rules lang={lang} translations={translations} />;
      default:
        return <NotFound onBack={() => setActiveTab('commerce')} />;
    }
  };

  // Tabs that have their own dedicated shell (no app chrome, no
  // header / tabs / footer / container). Both branches below follow
  // the same "early return with a minimal shell" pattern. Mirroring
  // kot3chat for the live_classroom tab means the Header / Tabs /
  // Footer / container are completely absent from the DOM rather
  // than conditionally hidden inside a shared shell — so they can't
  // bleed through, scale the entry card, or race the fullscreen
  // stage's z-index. The fullscreen stage additionally has its own
  // top-right toolbar (chat toggle + leave button) for live controls.
  const isChatTab = activeTab === 'kot3chat';
  const isClassroomTab = activeTab === 'live_classroom';

  if (isClassroomTab) {
    return (
      <div className="App" style={{ height: '100vh', overflow: 'hidden', padding: 0, margin: 0 }}>
        <div style={{
          // Promote the wrapper itself to a flex container so the
          // classroom content (LiveClassroom.jsx shell) is centered
          // here, not inside the shell with a fragile `height: 100%`
          // coupling. The bottom-nav (rendered as a sibling) is
          // unaffected because flex only positions direct children;
          // the fullscreen stage is `position: fixed` so it also
          // escapes this layout and covers the full viewport.
          height: 'calc(100vh - 70px)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          boxSizing: 'border-box',
        }}>
          {renderContent()}
        </div>

        <Settings
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onAuthOpen={() => { setIsSettingsOpen(false); setIsAuthOpen(true); }}
          lang={lang}
          onLangChange={handleLangChange}
          darkMode={darkMode}
          toggleTheme={toggleTheme}
          fontSize={fontSize}
          setFontSize={setFontSize}
          translations={translations}
          user={user}
          onLogout={handleLogout}
          showToast={showToast}
          onProfileUpdate={refreshUser}
        />

        <Auth
          isOpen={isAuthOpen}
          onClose={() => setIsAuthOpen(false)}
          onLoginSuccess={handleLoginSuccess}
          lang={lang}
          showToast={showToast}
        />

        {/* Premium Bottom Navigation Bar — gives the user a way to
            leave the classroom entry card. The fullscreen stage
            (when activeRoom is set) hides this bar via
            `body.live-fullscreen-active .bottom-nav-bar { display: none }`
            in src/styles/index.css so the stage takes the full viewport. */}
        <div className="bottom-nav-bar">
          <button
            className={`bottom-nav-item ${activeTab === 'commerce' ? 'active' : ''}`}
            onClick={() => setActiveTab('commerce')}
          >
            <i className="fas fa-graduation-cap"></i>
            <span>{lang === 'ht' ? 'Kou' : 'Courses'}</span>
          </button>

          <button
            className={`bottom-nav-item ${activeTab === 'roadmap' ? 'active' : ''}`}
            onClick={() => setActiveTab('roadmap')}
          >
            <i className="fas fa-route"></i>
            <span>{lang === 'ht' ? 'Rout' : 'Roadmap'}</span>
          </button>

          <button
            className={`bottom-nav-item ${activeTab === 'kot3chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('kot3chat')}
          >
            <i className="fab fa-facebook-messenger"></i>
            <span>Kot3</span>
          </button>

          <button
            className={`bottom-nav-item ${activeTab === 'live_classroom' ? 'active' : ''}`}
            onClick={() => setActiveTab('live_classroom')}
          >
            <i className="fas fa-chalkboard-teacher"></i>
            <span>{lang === 'ht' ? 'Klas Live' : 'Live Class'}</span>
          </button>
        </div>

        <div id="toast-container">
          {toasts.map(toast => (
            <div key={toast.id} className="toast">
              <i className={`fas fa-${toast.icon}`}></i>
              <span>{toast.message}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isChatTab) {
    return (
      <div className="App" style={{ height: '100vh', overflow: 'hidden', padding: 0, margin: 0 }}>
        <div style={{ height: 'calc(100vh - 70px)', overflow: 'hidden' }}>
          {renderContent()}
        </div>

        <Settings 
          isOpen={isSettingsOpen} 
          onClose={() => setIsSettingsOpen(false)}
          onAuthOpen={() => { setIsSettingsOpen(false); setIsAuthOpen(true); }}
          lang={lang}
          onLangChange={handleLangChange}
          darkMode={darkMode}
          toggleTheme={toggleTheme}
          fontSize={fontSize}
          setFontSize={setFontSize}
          translations={translations}
          user={user}
          onLogout={handleLogout}
          showToast={showToast}
          onProfileUpdate={refreshUser}
        />

        <Auth 
          isOpen={isAuthOpen}
          onClose={() => setIsAuthOpen(false)}
          onLoginSuccess={handleLoginSuccess}
          lang={lang}
          showToast={showToast}
        />

        {/* Premium Bottom Navigation Bar */}
        <div className="bottom-nav-bar">
          <button 
            className={`bottom-nav-item ${activeTab === 'commerce' ? 'active' : ''}`}
            onClick={() => setActiveTab('commerce')}
          >
            <i className="fas fa-graduation-cap"></i>
            <span>{lang === 'ht' ? 'Kou' : 'Courses'}</span>
          </button>

          <button 
            className={`bottom-nav-item ${activeTab === 'roadmap' ? 'active' : ''}`}
            onClick={() => setActiveTab('roadmap')}
          >
            <i className="fas fa-route"></i>
            <span>{lang === 'ht' ? 'Rout' : 'Roadmap'}</span>
          </button>

          <button 
            className={`bottom-nav-item ${activeTab === 'kot3chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('kot3chat')}
          >
            <i className="fab fa-facebook-messenger"></i>
            <span>Kot3</span>
          </button>

          <button 
            className={`bottom-nav-item ${activeTab === 'live_classroom' ? 'active' : ''}`}
            onClick={() => setActiveTab('live_classroom')}
          >
            <i className="fas fa-chalkboard-teacher"></i>
            <span>{lang === 'ht' ? 'Klas Live' : 'Live Class'}</span>
          </button>
        </div>

        <div id="toast-container">
          {toasts.map(toast => (
            <div key={toast.id} className="toast">
              <i className={`fas fa-${toast.icon}`}></i>
              <span>{toast.message}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }  return (
    <div className="App">      <Header
        lang={lang}
        translations={translations}
        toggleTheme={toggleTheme}
        toggleSettings={() => setIsSettingsOpen(true)}
        darkMode={darkMode}
        onOpenChat={() => setActiveTab('kot3chat')}
        unreadChatCount={0}
      />

      <div className="container">
        <Tabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          lang={lang}
          translations={translations}
        />

        <main id="main-content">
          {renderContent()}
        </main>

        <Footer lang={lang} translations={translations} />
      </div>

      <Settings 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        onAuthOpen={() => { setIsSettingsOpen(false); setIsAuthOpen(true); }}
        lang={lang}
        onLangChange={handleLangChange}
        darkMode={darkMode}
        toggleTheme={toggleTheme}
        fontSize={fontSize}
        setFontSize={setFontSize}
        translations={translations}
        user={user}
        onLogout={handleLogout}
        showToast={showToast}
        onProfileUpdate={refreshUser}
      />

      <Wizard 
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        selectedCourse={selectedCourse}
        lang={lang}
        translations={translations}
        showToast={showToast}
        onEnrollSuccess={(id) => {
          progressService.getAll().then(pRes => setUserProgress(pRes.data));
        }}
      />

      <Auth 
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onLoginSuccess={handleLoginSuccess}
        lang={lang}
        showToast={showToast}
      />

      <Chatbot lang={lang} translations={translations} />

      {/* Premium Bottom Navigation Bar */}
      <div className="bottom-nav-bar">
        <button 
          className={`bottom-nav-item ${activeTab === 'commerce' ? 'active' : ''}`}
          onClick={() => setActiveTab('commerce')}
        >
          <i className="fas fa-graduation-cap"></i>
          <span>{lang === 'ht' ? 'Kou' : 'Courses'}</span>
        </button>

        <button 
          className={`bottom-nav-item ${activeTab === 'roadmap' ? 'active' : ''}`}
          onClick={() => setActiveTab('roadmap')}
        >
          <i className="fas fa-route"></i>
          <span>{lang === 'ht' ? 'Rout' : 'Roadmap'}</span>
        </button>

        <button 
          className={`bottom-nav-item ${activeTab === 'kot3chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('kot3chat')}
        >
          <i className="fab fa-facebook-messenger"></i>
          <span>Kot3</span>
        </button>

        <button 
          className={`bottom-nav-item ${activeTab === 'live_classroom' ? 'active' : ''}`}
          onClick={() => setActiveTab('live_classroom')}
        >
          <i className="fas fa-chalkboard-teacher"></i>
          <span>{lang === 'ht' ? 'Klas Live' : 'Live Class'}</span>
        </button>
      </div>

      <div id="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className="toast">
            <i className={`fas fa-${toast.icon}`}></i>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
