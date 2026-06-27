import fs from 'fs';
import parser from '@babel/parser';
try {
  parser.parse(fs.readFileSync('src/components/LiveClassroom.jsx','utf-8'), {sourceType:'module', plugins:['jsx']});
  console.log('OK');
} catch (e) {
  console.log('Error at line ' + e.loc?.line + ' col ' + e.loc?.column);
  const lines = fs.readFileSync('src/components/LiveClassroom.jsx','utf-8').split('\n');
  const ln = e.loc?.line;
  if (ln) {
    console.log('--- context ---');
    for (let i = Math.max(0, ln-6); i < Math.min(lines.length, ln+3); i++) {
      console.log((i+1) + ': ' + lines[i]);
    }
  }
}
