// hyper-kit: Hyper plugin entry.
// Built output lives in dist/ (`npm run build`); this shim keeps the plugin
// entry point at the package root, where Hyper expects it.
'use strict';

/* eslint-disable @typescript-eslint/no-require-imports */
module.exports = require('./dist/index.js');
