import { describe, expect, it } from 'vitest';
import { isNavigationNetError, looksLikeChromeNetError } from '../src/scraper/chromeNetError.js';

describe('looksLikeChromeNetError', () => {
  it('matches ERR_HTTP2_PROTOCOL_ERROR interstitial', () => {
    expect(
      looksLikeChromeNetError({
        url: 'https://api.cathaypacific.com/redibe/IBEFacade?ACTION=RED_AWARD_SEARCH',
        title: "This site can’t be reached",
        text: 'The webpage at https://api.cathaypacific.com/redibe/IBEFacade might be temporarily down.\nERR_HTTP2_PROTOCOL_ERROR',
        code: 'ERR_HTTP2_PROTOCOL_ERROR',
      }),
    ).toBe(true);
  });

  it('matches chrome-error:// pages', () => {
    expect(
      looksLikeChromeNetError({
        url: 'chrome-error://chromewebdata/',
        title: "This site can’t be reached",
        text: 'ERR_CONNECTION_RESET',
      }),
    ).toBe(true);
  });

  it('ignores normal CX pages', () => {
    expect(
      looksLikeChromeNetError({
        url: 'https://www.cathaypacific.com/cx/en_HK/book-a-trip/redeem-flights/redeem-flight-awards.html',
        title: 'Redeem flights',
        text: 'Search for award flights',
      }),
    ).toBe(false);
  });
});

describe('isNavigationNetError', () => {
  it('matches Puppeteer net:: errors', () => {
    expect(isNavigationNetError(new Error('net::ERR_HTTP2_PROTOCOL_ERROR'))).toBe(true);
    expect(isNavigationNetError(new Error('Navigation timeout of 90000 ms exceeded'))).toBe(false);
  });
});
