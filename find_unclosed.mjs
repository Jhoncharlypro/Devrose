import fs from 'fs';
const code = fs.readFileSync('src/components/LiveClassroom.jsx', 'utf-8');

// Strip strings and comments properly
let cleaned = '';
let i = 0;
while (i < code.length) {
  const ch = code[i];
  // Single/double/template strings
  if (ch === "'" || ch === '"' || ch === '`') {
    const q = ch; i++;
    while (i < code.length && code[i] !== q) {
      if (code[i] === '\\') i++;
      i++;
    }
    i++;
    continue;
  }
  // Comment
  if (ch === '/' && code[i+1] === '/') {
    while (i < code.length && code[i] !== '\n') i++;
    continue;
  }
  if (ch === '/' && code[i+1] === '*') {
    i += 2;
    while (i < code.length && !(code[i] === '*' && code[i+1] === '/')) i++;
    i += 2;
    continue;
  }
  cleaned += ch;
  i++;
}

// Now count braces in cleaned text per character position
let bal = 0;
const positions = [];
for (let k = 0; k < cleaned.length; k++) {
  if (cleaned[k] === '{') { bal++; positions.push({ k, type: 'open' }); }
  else if (cleaned[k] === '}') { bal--; positions.push({ k, type: 'close' }); }
}
console.log('Final brace balance:', bal);

// Now find the position in cleaned text and map to original line
const origLines = code.split('\n');
const cleanedLines = cleaned.split('\n');

// Check each cleaned line ends with a running balance
let runBalance = 0;
for (let lineNum = 0; lineNum < cleanedLines.length; lineNum++) {
  for (const ch of cleanedLines[lineNum]) {
    if (ch === '{') runBalance++;
    else if (ch === '}') runBalance--;
  }
}
// Find lines where balance is unusual vs neighbors (sudden jumps or persistent mismatch)
const lineBalances = [];
let b = 0;
for (let lineNum = 0; lineNum < cleanedLines.length; lineNum++) {
  let lineBal = 0;
  for (const ch of cleanedLines[lineNum]) {
    if (ch === '{') lineBal++;
    else if (ch === '}') lineBal--;
  }
  b += lineBal;
  lineBalances.push(b);
}

// Print the last 50 line balances
console.log('--- Last 50 lines cumulative balance ---');
for (let i = Math.max(0, origLines.length - 50); i < origLines.length; i++) {
  if (Math.abs(lineBalances[i]) > 0 || (i > origLines.length - 20)) {
    console.log(`L${i+1} cumBal=${lineBalances[i]}: ${origLines[i].slice(0, 100)}`);
  }
}
