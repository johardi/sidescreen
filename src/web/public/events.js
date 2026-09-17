/**
 * The one event stream a page holds open. Every module that wants to know
 * the store changed imports this rather than opening its own connection.
 */

export const events = new EventSource('/api/events');
