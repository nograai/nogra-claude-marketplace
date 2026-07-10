#!/usr/bin/env node

// Compatibility shim for Claude sessions that loaded an older hook map before
// Stop became observe-only. New plugin configs do not reference this file.
process.exit(0);
