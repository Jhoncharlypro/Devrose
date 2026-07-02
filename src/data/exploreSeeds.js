/**
 * src/data/exploreSeeds.js
 *
 * Hardcoded seed data for the Explore page's non-course content. The
 * courses themselves still come from the real Django backend
 * (`/api/courses/`); music + talents are placeholders today so the UI
 * can be designed and tested without standing up a new backend service.
 *
 * When a real `/api/explore/music/` or `/api/explore/talents/` endpoint
 * is added, swap the imports in `src/components/Explore.jsx` to use
 * the API services — no component changes required.
 */

// ─── Music ────────────────────────────────────────────────────────────────
// Realistic-looking but entirely fictional. Covers + artist names +
// genres + track durations are all invented for the demo. When wired
// to a backend, the SAME object shape will be returned so the cards
// render unchanged.
export const MUSIC_SEEDS = [
  {
    id: 'music-1',
    title: 'Lanmou Sou Do Kay',
    artist: 'Rachelle & Ti-Jo',
    genre: 'Compas',
    duration: '3:42',
    cover: 'https://picsum.photos/seed/music-1/400/400',
    plays: 12480,
    is_featured: true,
  },
  {
    id: 'music-2',
    title: 'Kreyòl Sunrise',
    artist: 'BélO',
    genre: 'R&B / Kreyòl',
    duration: '4:18',
    cover: 'https://picsum.photos/seed/music-2/400/400',
    plays: 8921,
    is_featured: false,
  },
  {
    id: 'music-3',
    title: 'Code & Konpa',
    artist: 'DevCrew',
    genre: 'Konpa Elektrik',
    duration: '5:02',
    cover: 'https://picsum.photos/seed/music-3/400/400',
    plays: 21044,
    is_featured: true,
  },
  {
    id: 'music-4',
    title: 'Souf Vivan',
    artist: 'Marily',
    genre: 'Folk',
    duration: '3:11',
    cover: 'https://picsum.photos/seed/music-4/400/400',
    plays: 4310,
    is_featured: false,
  },
  {
    id: 'music-5',
    title: 'Pwogramè a Dance',
    artist: 'BinauralBeats HT',
    genre: 'Lo-fi',
    duration: '6:30',
    cover: 'https://picsum.photos/seed/music-5/400/400',
    plays: 17822,
    is_featured: false,
  },
  {
    id: 'music-6',
    title: 'Pòtoprens Midnight',
    artist: 'DJ Lakay',
    genre: 'Afro-house',
    duration: '7:14',
    cover: 'https://picsum.photos/seed/music-6/400/400',
    plays: 9320,
    is_featured: true,
  },
  {
    id: 'music-7',
    title: 'Yon Sezon',
    artist: 'Esther P.',
    genre: 'Gospel',
    duration: '4:55',
    cover: 'https://picsum.photos/seed/music-7/400/400',
    plays: 6128,
    is_featured: false,
  },
  {
    id: 'music-8',
    title: 'Bibliyotèk Rap',
    artist: 'MC Volim',
    genre: 'Rap Kreyòl',
    duration: '3:28',
    cover: 'https://picsum.photos/seed/music-8/400/400',
    plays: 14902,
    is_featured: false,
  },
];

// ─── Talents ─────────────────────────────────────────────────────────────
// "New talents" — placeholder directory entries. Each one mimics the
// shape that a future `/api/explore/talents/` endpoint would return.
export const TALENT_SEEDS = [
  {
    id: 'talent-1',
    name: 'Naïka Joseph',
    role: 'Full-stack Developer',
    skills: ['React', 'Django', 'PostgreSQL'],
    location: 'Pòtoprens, Ayiti',
    avatar: 'https://i.pravatar.cc/200?img=47',
    is_new: true,
  },
  {
    id: 'talent-2',
    name: 'Marc-Antoine Pierre',
    role: 'Mobile Engineer',
    skills: ['Flutter', 'Kotlin', 'iOS'],
    location: 'Jakmèl',
    avatar: 'https://i.pravatar.cc/200?img=12',
    is_new: true,
  },
  {
    id: 'talent-3',
    name: 'Stéphanie Cius',
    role: 'UX Designer',
    skills: ['Figma', 'Design Systems', 'Research'],
    location: 'Kap Ayisyen',
    avatar: 'https://i.pravatar.cc/200?img=32',
    is_new: true,
  },
  {
    id: 'talent-4',
    name: 'Woodly Saint-Louis',
    role: 'DevOps / SRE',
    skills: ['Kubernetes', 'AWS', 'Terraform'],
    location: 'Okay',
    avatar: 'https://i.pravatar.cc/200?img=15',
    is_new: false,
  },
  {
    id: 'talent-5',
    name: 'Bélinda Cangé',
    role: 'Data Scientist',
    skills: ['Python', 'PyTorch', 'MLOps'],
    location: 'Pòtoprens',
    avatar: 'https://i.pravatar.cc/200?img=44',
    is_new: true,
  },
  {
    id: 'talent-6',
    name: 'Jimmy Alcius',
    role: 'Cybersecurity Analyst',
    skills: ['Pentest', 'SIEM', 'GRC'],
    location: 'Okap',
    avatar: 'https://i.pravatar.cc/200?img=8',
    is_new: false,
  },
  {
    id: 'talent-7',
    name: 'Rose-Métellus B.',
    role: 'AI Prompt Engineer',
    skills: ['LLM', 'LangChain', 'RAG'],
    location: 'Sen Marc',
    avatar: 'https://i.pravatar.cc/200?img=49',
    is_new: true,
  },
  {
    id: 'talent-8',
    name: 'Pierre-Louis J.',
    role: 'Cloud Architect',
    skills: ['GCP', 'Supabase', 'Postgres'],
    location: 'Pòtoprens',
    avatar: 'https://i.pravatar.cc/200?img=11',
    is_new: false,
  },
];
