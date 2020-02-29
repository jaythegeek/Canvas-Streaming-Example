/**
 *  Copyright (c) 2017-present, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the license found in the
 *  LICENSE file in the root directory of this source tree.
 */

const child_process = require('child_process');
const express = require('express');
const WebSocketServer = require('ws').Server;
const http = require('http');

const app = express();
const server = http.createServer(app).listen(3000, () => {
  console.log('Listening...');
});

const wss = new WebSocketServer({
  server: server
});

app.use((req, res, next) => {
  console.log('HTTP Request: ' + req.method + ' ' + req.originalUrl);
  return next();
});

app.use(express.static(__dirname + '/www'));

wss.on('connection', (ws) => {

  // Ensure that the URL starts with '/rtmp/', and extract the target RTMP URL.
  let match;
  if (!(match = ws.upgradeReq.url.match(/^\/rtmp\/(.*)$/))) {
    ws.terminate(); // No match, reject the connection.
    return;
  }

  const rtmpUrl = decodeURIComponent(match[1]);
  console.log('Target RTMP URL:', rtmpUrl);

  // Launch FFmpeg to handle all appropriate transcoding, muxing, and RTMP
  const ffmpeg = child_process.spawn('ffmpeg', [
    // '-y', '-r', '4.2',
    '-i', '-',
    '-re',
    // '-vsync', '0',
    '-f', 'lavfi', '-i', 'anullsrc',
    '-shortest',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '10',
    
    // '-c:a', 'aac',
    
    '-f', 'flv',

    rtmpUrl
  ]);

  // If FFmpeg stops for any reason, close the WebSocket connection.
  ffmpeg.on('close', (code, signal) => {
    console.log('FFmpeg child process closed, code ' + code + ', signal ' + signal);
    ws.terminate();
  });

  // Handle STDIN pipe errors by logging to the console.
  // These errors most commonly occur when FFmpeg closes and there is still
  // data to write.  If left unhandled, the server will crash.
  ffmpeg.stdin.on('error', (e) => {
    console.log('FFmpeg STDIN Error', e);
  });

  // FFmpeg outputs all of its messages to STDERR.  Let's log them to the console.
  ffmpeg.stderr.on('data', (data) => {
    console.log('FFmpeg STDERR:', data.toString());
  });

  // When data comes in from the WebSocket, write it to FFmpeg's STDIN.
  ws.on('message', (msg) => {
    console.log('DATA', msg);
    ffmpeg.stdin.write(msg);
  });

  // If the client disconnects, stop FFmpeg.
  ws.on('close', (e) => {
    ffmpeg.kill('SIGINT');
  });

});
