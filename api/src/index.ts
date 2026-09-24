/**
 * Entry point. The v4 programming model registers functions as a side effect of
 * importing the module that calls app.http(), so these imports are load-bearing
 * even though nothing is used from them.
 */
import './functions/auth.js';
import './functions/events.js';
import './functions/backup.js';
