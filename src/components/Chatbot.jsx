import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";

const Chatbot = ({ lang, translations }) => {
  const [isOpen, setIsOpen] = useState(false);
  const t = translations[lang] || translations['ht'];
  
  const [messages, setMessages] = useState([
    { role: 'bot', text: t.bot_welcome || 'Bonjou! Mwen se DevRose AI.' }
  ]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const msgsEndRef = useRef(null);

  // Note: For production, use environment variables for keys.
  const API_KEY = "AIzaSyBzgDV8VbvpdRtFaJkWgBJ6nqsU0HlN_gQ"; 
  const genAI = new GoogleGenerativeAI(API_KEY);

  useEffect(() => {
    setMessages([{ role: 'bot', text: t.bot_welcome || 'Bonjou! Mwen se DevRose AI.' }]);
  }, [lang, t.bot_welcome]);

  useEffect(() => {
    if (msgsEndRef.current) {
      msgsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isThinking]);

  const toggleChat = () => setIsOpen(!isOpen);

  const handleSend = async () => {
    if (!input.trim() || isThinking) return;

    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setIsThinking(true);

    const context = `You are DevRose AI, a Senior Software Architect, Expert Analyst, and Professional Translator for DevRose Academy.
    YOUR CORE CAPABILITIES:
    1. ANALYZE: You can analyze code, project structures, and business ideas.
    2. TRANSLATE: You can translate text accurately between Haitian Creole, English, French, and Spanish.
    3. KNOWLEDGE: You know everything about DevRose Academy (Linux, Python, React, Django courses).
    Respond primarily in ${lang === 'ht' ? 'Haitian Creole' : (lang === 'fr' ? 'French' : (lang === 'es' ? 'Spanish' : 'English'))}. Use Markdown formatting.`;

    try {
      const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: context 
      });

      const result = await model.generateContent(userMsg);
      const response = await result.response;
      const text = response.text();

      setMessages(prev => [...prev, { role: 'bot', text: text }]);
    } catch (error) {
      console.error("Gemini Error:", error);
      setMessages(prev => [...prev, { role: 'bot', text: lang === 'ht' ? "Mwen regrèt, gen yon erè ki fèt." : "Sorry, an error occurred." }]);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <>
      <div 
        className="chat-btn" 
        onClick={toggleChat}
      >
        <i className={isOpen ? "fas fa-times" : "fas fa-robot"}></i>
      </div>

      {isOpen && (
        <div className="chat-window">
          <div className="chat-header">
            <span><i className="fas fa-robot"></i> DevRose AI v5.0</span>
            <button onClick={toggleChat} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                <i className="fas fa-chevron-down"></i>
            </button>
          </div>

          <div className="chat-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`msg ${msg.role}`}>
                {msg.text}
              </div>
            ))}
            {isThinking && (
              <div className="msg bot">
                <i className="fas fa-spinner fa-spin"></i> {lang === 'ht' ? 'M ap reflechi...' : 'Thinking...'}
              </div>
            )}
            <div ref={msgsEndRef} />
          </div>

          <div className="chat-input-area">
            <input 
              type="text" 
              className="chat-input" 
              placeholder={lang === 'ht' ? "Mande m anyen..." : "Ask me anything..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            />
            <button 
              className="icon-btn" 
              onClick={handleSend}
              style={{ width: '40px', height: '40px', borderRadius: '50%' }}
            >
              <i className="fas fa-paper-plane"></i>
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default Chatbot;
