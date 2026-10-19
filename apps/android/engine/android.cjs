// Starts Memora's server on Android: the same server.mjs as in Docker and the desktop app.
// What Electron's utility process gives the desktop app is made here, before it loads:
//  - process.parentPort, over the app's stdin (one JSON message per line) and stdout (lines
//    starting with MARK; everything else is the log);
//  - better-sqlite3's native part, which Android only lets an app load from its own library
//    folder: the app ships it as libbetter_sqlite3.so there.
'use strict';
const Module = require('node:module');
const path = require('node:path');
const readline = require('node:readline');
const { pathToFileURL } = require('node:url');

const MARK = '\u001eMEMORA ';

const loadAddon = Module._extensions['.node'];
Module._extensions['.node'] = (module, filename) =>
  loadAddon(
    module,
    path.basename(filename) === 'better_sqlite3.node'
      ? path.join(process.env.MEMORA_NATIVE_LIB_DIR, 'libbetter_sqlite3.so')
      : filename,
  );

const listeners = [];
process.parentPort = {
  on(event, listener) {
    if (event === 'message') listeners.push(listener);
  },
  postMessage(message) {
    process.stdout.write(`${MARK}${JSON.stringify(message)}\n`);
  },
};
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let data;
  try {
    data = JSON.parse(line);
  } catch {
    return;
  }
  for (const listener of listeners) listener({ data });
});

import(pathToFileURL(path.join(__dirname, 'server', 'dist', 'server.mjs')).href);
