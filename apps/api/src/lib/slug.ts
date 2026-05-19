import { randomInt } from 'node:crypto';
import { customAlphabet } from 'nanoid';

// readable, no ambiguous chars
const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
const nano = customAlphabet(alphabet, 10);

const adjectives = [
  'amber',
  'bold',
  'brave',
  'calm',
  'clever',
  'cosmic',
  'crisp',
  'dapper',
  'eager',
  'fancy',
  'fierce',
  'gentle',
  'glowing',
  'jolly',
  'lucky',
  'merry',
  'misty',
  'nimble',
  'quiet',
  'rapid',
  'rosy',
  'sunny',
  'swift',
  'tidy',
  'witty',
  'zesty',
];

const nouns = [
  'badger',
  'beacon',
  'comet',
  'cricket',
  'falcon',
  'fern',
  'forge',
  'glade',
  'harbor',
  'heron',
  'lantern',
  'meadow',
  'opal',
  'otter',
  'panda',
  'pebble',
  'planet',
  'prairie',
  'quartz',
  'raven',
  'sparrow',
  'tempo',
  'thicket',
  'tiger',
  'wave',
  'willow',
];

// Use a CSPRNG even for the human-readable portion. Slugs aren't security
// boundaries on their own, but predictable slugs let an attacker enumerate
// "fresh-pad" URLs and try unlock passwords against them.
const pick = <T>(xs: readonly T[]): T => xs[randomInt(0, xs.length)];

export function generateSlug(): string {
  return `${pick(adjectives)}-${pick(nouns)}-${nano().slice(0, 5)}`;
}

export function randomToken(len = 32): string {
  return customAlphabet(alphabet + 'ABCDEFGHJKMNPQRSTUVWXYZ', len)();
}
