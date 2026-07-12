import { DOMAINS } from '../data/questions.js';

/** Honor a development-path domain; otherwise choose a normal random practice domain. */
export function selectPracticeDomain(preferredDomain, random = Math.random) {
  if (DOMAINS.some((domain) => domain.id === preferredDomain)) return preferredDomain;
  return DOMAINS[Math.floor(random() * DOMAINS.length)]?.id ?? DOMAINS[0]?.id ?? '';
}
