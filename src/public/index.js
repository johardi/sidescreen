// Turn list: reload when the store changes so a new turn shows up on its own.
const events = new EventSource('/api/events');
events.addEventListener('store-changed', () => window.location.reload());
