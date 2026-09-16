// Project list: reload when the store changes so a new project shows up on its own.
import { events } from './events.js';

events.addEventListener('store-changed', () => window.location.reload());
