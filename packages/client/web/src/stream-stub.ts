// Browser stub for the `stream` node builtin: the xlsx library probes
// `typeof require !== 'undefined'` and, in a bundled CJS factory, finds a real
// require — so its node-only `require('stream')` branch would otherwise reach
// the frozen module table and throw. The browser build never uses the stream
// read/write types, so an empty module is the correct answer.

export {}
