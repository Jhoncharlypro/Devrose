import axios from 'axios';

const API_URL = '/api/';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add interceptor for Token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers['X-Authorization'] = `Token ${token}`;
  }
  return config;
});

export const courseService = {
  getAll: () => api.get('courses/'),
  getById: (id) => api.get(`courses/${id}/`),
};

export const authService = {
  login: (credentials) => api.post('login/', credentials),
  signup: (userData) => api.post('signup/', userData),
  getMe: () => api.get('me/'),
};

export const progressService = {
  getAll: () => api.get('progress/'),
  update: (id, data) => api.patch(`progress/${id}/`, data),
  create: (data) => api.post('progress/', data),
};

export const enrollmentService = {
  getAll: () => api.get('enrollments/'),
  create: (courseId) => api.post('enrollments/', { course: courseId }),
};

export const favoriteService = {
  getAll: () => api.get('favorites/'),
  create: (courseId) => api.post('favorites/', { course: courseId }),
  remove: (courseId) => api.delete(`favorites/0/?course_id=${courseId}`),
};

export const profileService = {
  getMe: () => api.get('profile/me/'),
  updateMe: (data) => api.patch('profile/me/', data),
};

export const sessionService = {
  get: () => api.get('session/me/'),
  update: (data) => api.patch('session/me/', data),
};

export const chatService = {
  getThreads: () => api.get('chat/threads/'),
  createThread: (userId) => api.post('chat/threads/', { user_id: userId }),
  getMessages: (threadId) => api.get(`chat/threads/${threadId}/messages/`),
  sendMessage: (threadId, data) => api.post(`chat/threads/${threadId}/send_message/`, data),
  markRead: (threadId, messageIds) => api.post(`chat/threads/${threadId}/mark_read/`, { message_ids: messageIds }),
  getUsers: () => api.get('chat/users/'),
  searchGlobal: (q) => api.get(`chat/search/global_search/?q=${encodeURIComponent(q)}`),
  publishStory: (data) => api.post('chat/stories/', data),
  getStories: () => api.get('chat/stories/'),
};

export const liveRoomService = {
  getRecent: () => api.get('live/rooms/'),
  getMine: () => api.get('live/rooms/mine/'),
  getActive: () => api.get('live/rooms/active/'),
  restore: (data) => api.post('live/rooms/restore/', data),
  resolve: (data) => api.post('live/rooms/resolve/', data),
  sync: (data) => api.post('live/rooms/sync/', data),
  updateState: (roomId, data) => api.patch(`live/rooms/${encodeURIComponent(roomId)}/state/`, data),
};

export default api;
