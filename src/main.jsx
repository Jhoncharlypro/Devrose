import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/index.css'

console.log('Main.jsx starting...');
const rootElem = document.getElementById('root');
console.log('Root element found:', !!rootElem);

if (rootElem) {
  try {
    ReactDOM.createRoot(rootElem).render(
      <React.StrictMode>
        <App />
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

