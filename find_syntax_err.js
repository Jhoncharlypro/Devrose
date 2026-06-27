const fs = require('fs');
const code = fs.readFileSync('src/components/LiveClassroom.jsx', 'utf-8');
const lines = code.split('\n');

function strip(line) {
  let result = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < line.length && line[i] !== quote) {
        if (line[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '/' && line[i+1] === '/') break;
    if (ch === '/' && line[i+1] === '*') {
      i += 2;
      while (i < line.length && !(line[i] === '*' && line[i+1] === '/')) i++;
      i += 2;
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}

let total = 0;
for (let i = 0; i < lines.length; i++) {
  const s = strip(lines[i]);
  for (const ch of s) {
    if (ch === '{') total++;
    else if (ch === '}') total--;
  }
}
console.log('Final balance:', total);

const start = Math.max(0, lines.length - 80);
for (let i = start; i < lines.length; i++) {
  let runningTotal = 0;
  const s = strip(lines[i]);
  for (const ch of s) {
    if (ch === '{') runningTotal++;
    else if (ch === '}') runningTotal--;
  }
  console.log(`${i+1}: bal=${runningTotal} | ${lines[i].slice(0, 110)}`);
}
