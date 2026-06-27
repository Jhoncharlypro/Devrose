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
import React, { useState, useEffect } from 'react';
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
import { translations } from './data/translations';
import { courseService, authService, sessionService, progressService, profileService, favoriteService, chatService } from './services/api';

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

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setUserProgress([]);
    setActiveTab('commerce');
    showToast(lang === 'ht' ? 'Ou dekonekte!' : 'Logged out!', 'sign-out-alt');
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

    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }

    if (token) {
      authService.getMe()
        .then(res => {
          const userData = res.data;
          setUser(userData);
          localStorage.setItem('user', JSON.stringify(userData));
          
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
            handleLogout();
          }
        });
    }
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
            // Filter out courses that contain the word "Pro" (case-insensitive whole word) in their title
            const nonPro = res.data.filter(course => course.title && !/\bpro\b/i.test(course.title));
            // Shuffle the order of courses to randomize them on every refresh
            const shuffled = shuffleArray(nonPro);
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
          <Kot3Chat 
            lang={lang} 
            user={user} 
            showToast={showToast}
          />
        );
      case 'rules':
        return <Rules lang={lang} translations={translations} />;
      default:
        return <NotFound onBack={() => setActiveTab('commerce')} />;
    }
  };

  const isChatTab = activeTab === 'kot3chat';

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
  }

  return (
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
