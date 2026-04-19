const https = require('https');
const url = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.10/dist/ffmpeg.min.js';
https.get(url, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('STATUS', res.statusCode);
    ['FFmpeg','createFFmpeg','fetchFile','exports','module.exports'].forEach(k => console.log(k, (data.match(new RegExp(k,'g'))||[]).length));
    console.log('---HEAD---');
    console.log(data.slice(0,1200));
  });
}).on('error', e => console.error('ERR', e.message));
