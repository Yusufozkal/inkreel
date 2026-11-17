'use strict';

/** Official built-in update feeds. Every feed is verified with the same signing key. */
const DEFAULT_FEEDS = Object.freeze([
  'https://gitlab.com/Turkish_Vito/inkreel/-/releases/permalink/latest/downloads/latest.json',
  'https://github.com/Yusufozkal/inkreel/releases/latest/download/latest.json'
]);

const TAG = '(v?[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.]+)?)';
const FILE = '([A-Za-z0-9][A-Za-z0-9._-]{0,127})';
const GITLAB = [
  new RegExp('^https://gitlab\\.com/Turkish_Vito/inkreel/-/releases/' + TAG + '/downloads/' + FILE + '$'),
  new RegExp('^https://gitlab\\.com/Turkish_Vito/karevo/-/releases/' + TAG + '/downloads/' + FILE + '$')
];
const GITHUB = new RegExp('^https://github\\.com/Yusufozkal/inkreel/releases/download/' + TAG + '/' + FILE + '$');

/** Exact GitLab <-> GitHub release-asset mirrors of an installer URL; anything else has none. */
function mirrorUrls(url, fileName) {
  if (typeof url !== 'string' || typeof fileName !== 'string') return [];
  for (const pattern of GITLAB) {
    const match = pattern.exec(url);
    if (match && match[2] === fileName) return ['https://github.com/Yusufozkal/inkreel/releases/download/' + match[1] + '/' + match[2]];
  }
  const match = GITHUB.exec(url);
  if (match && match[2] === fileName) return ['https://gitlab.com/Turkish_Vito/inkreel/-/releases/' + match[1] + '/downloads/' + match[2]];
  return [];
}

module.exports = { DEFAULT_FEEDS, mirrorUrls };
