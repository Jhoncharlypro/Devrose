import React, { useState, useEffect, useRef } from 'react';

const Terminal = ({ lang, translations }) => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState([]);
  const [currentPath, setCurrentPath] = useState('/home/student');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isNano, setIsNano] = useState(false);
  const [nanoFile, setNanoFile] = useState('');
  const [nanoContent, setNanoContent] = useState('');
  
  const outputRef = useRef(null);
  const inputRef = useRef(null);

  const t = translations[lang] || translations['ht'];

  // Initial Welcome Message
  useEffect(() => {
    const savedHistory = localStorage.getItem('devrose_history');
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }
    
    setOutput([
      { type: 'raw', content: t.terminal_welcome }
    ]);
  }, [lang, t.terminal_welcome]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, isNano]);

  // Virtual File System
  const [fileSystem, setFileSystem] = useState(() => {
    const savedFS = localStorage.getItem('devrose_fs');
    return savedFS ? JSON.parse(savedFS) : {
      '/': { type: 'dir', perm: 'drwxr-xr-x', owner: 'root', children: {
        'home': { type: 'dir', perm: 'drwxr-xr-x', owner: 'root', children: {
          'student': { type: 'dir', perm: 'drwx------', owner: 'student', children: {
            'projects': { type: 'dir', perm: 'drwxr-xr-x', owner: 'student', children: {} },
            'scripts': { type: 'dir', perm: 'drwxr-xr-x', owner: 'student', children: {
              'hello.py': { type: 'file', perm: '-rwxr-xr-x', owner: 'student', content: "print('Bonjou DevRose Academy!')\n# Teste Python isit la" },
              'index.html': { type: 'file', perm: '-rw-r--r--', owner: 'student', content: "<div style='color: #d81b60; font-family: sans-serif; text-align: center;'>\n  <h1>Byenveni nan DevRose!</h1>\n  <p>Sa se yon preview HTML an dirèk.</p>\n</div>" }
            }},
            'readme.txt': { type: 'file', perm: '-rw-r--r--', owner: 'student', content: "Byenveni nan pi gwo shell simulator la. Sèvi ak 'help' pou w aprann." }
          }}
        }},
        'bin': { type: 'dir', perm: 'drwxr-xr-x', owner: 'root', children: {
          'bash': { type: 'file', perm: '-rwxr-xr-x', owner: 'root' },
          'apt': { type: 'file', perm: '-rwxr-xr-x', owner: 'root' },
          'python': { type: 'file', perm: '-rwxr-xr-x', owner: 'root' },
          'nano': { type: 'file', perm: '-rwxr-xr-x', owner: 'root' }
        }},
        'tmp': { type: 'dir', perm: 'drwxrwxrwt', owner: 'root', children: {} }
      }}
    };
  });

  const saveState = (newFS, newPath, newHistory) => {
    localStorage.setItem('devrose_fs', JSON.stringify(newFS));
    localStorage.setItem('devrose_path', newPath);
    localStorage.setItem('devrose_history', JSON.stringify(newHistory));
  };

  const getPathObj = (path, customFS = fileSystem) => {
    if (!path || path === '.') return getPathObj(currentPath, customFS);
    if (path === '..') {
      const parts = currentPath.split('/').filter(p => p !== '');
      if (parts.length === 0) return customFS['/'];
      parts.pop();
      return getPathObj('/' + parts.join('/'), customFS);
    }
    if (path.startsWith('~')) path = path.replace('~', '/home/student');
    let absolutePath = path.startsWith('/') ? path : (currentPath === '/' ? '' : currentPath) + '/' + path;
    absolutePath = absolutePath.replace(/\/+/g, '/').replace(/\/$/, '');
    if (absolutePath === '') absolutePath = '/';
    if (absolutePath === '/') return customFS['/'];

    const parts = absolutePath.split('/').filter(p => p !== '');
    let current = customFS['/'];
    for (const part of parts) {
      if (!current.children || !current.children[part]) return null;
      current = current.children[part];
    }
    return current;
  };

  const commands = {
    'help': () => "--- Komand Pro Linux --- \n" +
        "Fichye: ls, cd, pwd, mkdir, rmdir, touch, rm, cp, mv, ln, find, du\n" +
        "Kontni: cat, head, tail, wc, grep, sort, uniq, diff, echo\n" +
        "Sistèm: uname, uptime, df, free, ps, top, whoami, id, hostname, env, date\n" +
        "Rezo: ping, curl, wget, ifconfig, ssh\n" +
        "Zouti: git, python, nano, clear, history, man, alias, which, chmod, sudo, apt\n" +
        "Defi: challenge (Ganyen rabè!)\n" +
        "Tape 'man [command]' pou plis detay.",
    
    'ls': (args) => {
      const isLong = args.includes('-l');
      const isAll = args.includes('-a');
      const pathArgs = args.split(' ').filter(a => !a.startsWith('-'));
      const path = pathArgs[0] || '.';
      const target = getPathObj(path);
      if (!target || target.type !== 'dir') return `ls: cannot access '${path}': No such directory`;
      
      let items = Object.keys(target.children).sort();
      if (isAll) items = ['.', '..', ...items];

      if (isLong) {
        return items.map(name => {
          let item = target.children[name] || (name === '.' ? target : null);
          if (!item) return ''; 
          const color = item.type === 'dir' ? '#3498db' : (item.perm?.includes('x') ? '#2ecc71' : '#fff');
          return `${item.perm || '-rw-r--r--'} student student 4096 May 6 <span style="color: ${color}">${name}${item.type === 'dir' ? '/' : ''}</span>`;
        }).join('\n');
      }
      return items.map(name => {
        const item = target.children[name] || (name === '.' ? target : null);
        if (!item) return '';
        const color = item.type === 'dir' ? '#3498db' : (item.perm?.includes('x') ? '#2ecc71' : '#fff');
        return `<span style="color: ${color}">${name}</span>`;
      }).join('  ');
    },

    'cd': (args) => {
      if (!args || args === '~') { setCurrentPath('/home/student'); return ''; }
      const target = getPathObj(args);
      if (target && target.type === 'dir') {
        let absolute = args.startsWith('/') ? args : (currentPath === '/' ? '' : currentPath) + '/' + args;
        if (args === '..') {
          const parts = currentPath.split('/').filter(p => p !== '');
          parts.pop();
          absolute = '/' + parts.join('/');
        }
        const newPath = absolute.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
        setCurrentPath(newPath);
        return '';
      }
      return `bash: cd: ${args}: No such directory`;
    },

    'pwd': () => currentPath,

    'clear': () => { setOutput([]); return null; },

    'whoami': () => "student",

    'date': () => new Date().toString(),

    'nano': (args) => {
      if (!args) return "Usage: nano [file]";
      setIsNano(true);
      setNanoFile(args);
      const target = getPathObj(args);
      setNanoContent(target ? target.content : "");
      return null;
    },

    'python': (args) => {
      const target = getPathObj(args);
      if (target && target.type === 'file') {
        if (target.content.includes('print(')) {
          const match = target.content.match(/print\(['"](.+)['"]\)/);
          return match ? match[1] : "Python script executed.";
        }
      }
      return "python: can't open file or no print statement found.";
    },

    'cat': (args) => {
        const target = getPathObj(args);
        if (target && target.type === 'file') return target.content;
        return `cat: ${args}: No such file`;
    }
  };

  const handleCommand = (e) => {
    if (e.key === 'Enter') {
      const fullInput = input.trim();
      const parts = fullInput.split(' ');
      const cmd = parts[0];
      const args = parts.slice(1).join(' ');

      const newHistory = [...history, fullInput];
      setHistory(newHistory);
      setHistoryIndex(newHistory.length);

      const prompt = `student@devrose:${currentPath.replace('/home/student', '~')}$`;
      const newOutputLines = [...output, { type: 'command', prompt, text: fullInput }];

      if (commands[cmd]) {
        const result = commands[cmd](args);
        if (result !== null) {
          newOutputLines.push({ type: 'text', content: result });
        }
      } else if (fullInput) {
        newOutputLines.push({ type: 'error', content: `bash: ${cmd}: command not found` });
      }

      setOutput(newOutputLines);
      setInput('');
      saveState(fileSystem, currentPath, newHistory);
    } else if (e.key === 'ArrowUp') {
      if (historyIndex > 0) {
        const newIdx = historyIndex - 1;
        setHistoryIndex(newIdx);
        setInput(history[newIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      if (historyIndex < history.length - 1) {
        const newIdx = historyIndex + 1;
        setHistoryIndex(newIdx);
        setInput(history[newIdx]);
      } else {
        setHistoryIndex(history.length);
        setInput('');
      }
    }
  };

  const exitNano = (save) => {
    if (save) {
        const newFS = { ...fileSystem };
        // Deep clone for simplicity in this mockup, in real app use better path traversal
        const pathParts = currentPath.split('/').filter(p => p !== '');
        let current = newFS['/'];
        pathParts.forEach(part => {
            current = current.children[part];
        });
        current.children[nanoFile] = { type: 'file', perm: '-rw-r--r--', owner: 'student', content: nanoContent };
        setFileSystem(newFS);
        saveState(newFS, currentPath, history);
    }
    setIsNano(false);
    setOutput([...output, { type: 'text', content: save ? `File ${nanoFile} saved.` : "Edit cancelled." }]);
  };

  return (
    <div className="terminal-window" style={{ background: '#1e1e1e', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
      <div className="terminal-header" style={{ background: '#333', padding: '10px', display: 'flex', gap: '8px' }}>
        <div className="dot dot-red" style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ff5f56' }}></div>
        <div className="dot dot-yellow" style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ffbd2e' }}></div>
        <div className="dot dot-green" style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#27c93f' }}></div>
        <div className="terminal-title" style={{ marginLeft: 'auto', marginRight: 'auto', color: '#999', fontSize: '0.8rem', fontFamily: 'monospace' }}>student@devrose: {currentPath}</div>
      </div>

      <div 
        className="terminal-screen" 
        ref={outputRef}
        onClick={() => inputRef.current?.focus()}
        style={{ height: '450px', overflowY: 'auto', padding: '20px', fontFamily: 'Courier New, monospace', fontSize: '0.9rem', color: '#fff' }}
      >
        {isNano ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
             <div style={{ background: '#ccc', color: '#000', padding: '2px 10px', fontWeight: 'bold', display: 'flex', justifyByContent: 'space-between' }}>
                <span>GNU nano 7.2</span>
                <span>Editing: {nanoFile}</span>
            </div>
            <textarea 
              value={nanoContent}
              onChange={(e) => setNanoContent(e.target.value)}
              autoFocus
              style={{ flex: 1, background: 'transparent', color: '#fff', border: 'none', outline: 'none', resize: 'none', padding: '10px' }}
            />
            <div style={{ display: 'flex', gap: '10px', padding: '10px' }}>
                <button onClick={() => exitNano(true)} style={{ background: '#27ae60', color: '#fff', border: 'none', padding: '5px 15px', borderRadius: '5px' }}>Save & Exit</button>
                <button onClick={() => exitNano(false)} style={{ background: '#e74c3c', color: '#fff', border: 'none', padding: '5px 15px', borderRadius: '5px' }}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="terminal-output">
              {output.map((line, i) => (
                <div key={i} style={{ marginBottom: '5px', whiteSpace: 'pre-wrap' }}>
                  {line.type === 'command' && (
                    <><span style={{ color: '#f1c40f', fontWeight: 'bold' }}>{line.prompt}</span> {line.text}</>
                  )}
                  {line.type === 'text' && line.content}
                  {line.type === 'raw' && <div dangerouslySetInnerHTML={{ __html: line.content }} />}
                  {line.type === 'error' && <span style={{ color: '#e74c3c' }}>{line.content}</span>}
                </div>
              ))}
            </div>
            <div className="terminal-input-line" style={{ display: 'flex', alignItems: 'center' }}>
              <span className="terminal-prompt" style={{ color: '#f1c40f', marginRight: '10px', fontWeight: 'bold' }}>
                student@devrose:{currentPath.replace('/home/student', '~')}$
              </span>
              <input 
                ref={inputRef}
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleCommand}
                autoFocus
                style={{ background: 'none', border: 'none', color: '#fff', outline: 'none', flex: 1, fontSize: '0.9rem' }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Terminal;
