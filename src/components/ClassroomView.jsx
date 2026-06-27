import React, { useState } from 'react';

const ClassroomView = ({ isOpen, onClose, course, user }) => {
  const [activeLesson, setActiveLesson] = useState(null);

  if (!isOpen || !course) return null;

  // Transform syllabus to lesson objects if it's just strings
  const lessons = Array.isArray(course.syllabus) 
    ? course.syllabus.map((title, index) => ({
        id: index + 1,
        title: title,
        video: "https://www.youtube.com/embed/dQw4w9WgXcQ", // Default placeholder
        content: `Byenveni nan leson "${title}". Nan pati sa a nou pral kouvri tout pwen enpòtan yo.`
      }))
    : [
        { id: 1, title: "Lesson 1: Introduction", video: "https://www.youtube.com/embed/dQw4w9WgXcQ", content: "Pa gen silabi disponib pou kou sa a ankò." }
      ];

  const currentLesson = activeLesson || lessons[0];

  return (
    <div className="classroom-view" style={{ display: 'flex' }}>
      <div className="classroom-header" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
          <button className="icon-btn" onClick={onClose} style={{ background: 'rgba(255,255,255,0.2)', color: 'white', flexShrink: 0 }}>
            <i className="fas fa-arrow-left"></i>
          </button>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Classroom: {course.title}</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{ fontSize: '0.9rem' }}>{user?.username || 'Student'}</span>
          <i className="fas fa-user-circle" style={{ fontSize: '1.5rem' }}></i>
        </div>
      </div>
      <div className="classroom-main">
        <div className="classroom-sidebar">
          <h4 style={{ padding: '0 15px' }}>Mapan Leson yo</h4>
          <div id="lesson-list">
            {lessons.map((lesson) => (
              <div 
                key={lesson.id} 
                className={`lesson-item ${currentLesson.id === lesson.id ? 'active' : ''}`}
                onClick={() => setActiveLesson(lesson)}
              >
                <i className="fas fa-play-circle"></i> {lesson.title}
              </div>
            ))}
          </div>
        </div>
        <div className="classroom-content">
          <div className="video-player">
            <iframe 
              width="100%" 
              height="100%" 
              src={currentLesson.video} 
              title={currentLesson.title}
              frameBorder="0" 
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
              allowFullScreen
            ></iframe>
          </div>
          <h2>{currentLesson.title}</h2>
          <div style={{ lineHeight: '1.6', color: 'var(--text-main)' }}>
            {currentLesson.content}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClassroomView;
