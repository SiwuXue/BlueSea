// MV3 service worker: load required libs and existing background logic
// Note: omit development hot-reload in MV3 service worker
importScripts(
  '../lib/dayjs.js',
  '../logic.js',
  './background.js'
);

// Keep the worker alive briefly when needed by messages; no persistent background
// In MV3, returning true in onMessage listeners ensures asynchronous response support