import { TIMEZONE } from './config.js';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** "2026-10-07" en hora de Madrid. */
export const dayKey = (date = new Date()) => dayFormatter.format(date);

export const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60_000);
export const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);
