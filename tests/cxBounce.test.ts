import { describe, expect, it } from 'vitest';
import { classifyCxBounce, isMidOAuthNavigation } from '../src/scraper/cxBounce.js';

describe('classifyCxBounce', () => {
  it('treats IBE_USR005 on the redeem RETURNURL as a login wall', () => {
    expect(
      classifyCxBounce(
        '/cx/en_HK/book-a-trip/redeem-flights/redeem-flight-awards.html',
        '?error_list=IBE_USR005_S003&ORIGIN[1]=HKG',
      ),
    ).toBe('login');
  });

  it('treats business errors as rejected', () => {
    expect(
      classifyCxBounce(
        '/cx/en_HK/book-a-trip/redeem-flights/redeem-flight-awards.handler.html',
        '?error_list=IBE_BUS0005_S004',
      ),
    ).toBe('rejected');
  });

  it('returns null when there is no error_list', () => {
    expect(classifyCxBounce('/redibe/availability', '')).toBeNull();
  });
});

describe('isMidOAuthNavigation', () => {
  it('does not treat sign-in?goto=oauth as mid-OAuth (auto-login must run)', () => {
    const signIn =
      'https://www.cathaypacific.com/cx/en_HK/sign-in.html?goto=https%3A%2F%2Fopeniam.cathaypacific.com%2Fam%2Foauth2%2Falpha%2Fauthorize%3Fresponse_type%3Dcode%26scope%3Dopenid%26state%3Dhttps%253A%252F%252Fapi.cathaypacific.com%252Fredibe%252FIBEFacade%253FACTION%253DRED_AWARD_SEARCH';
    expect(isMidOAuthNavigation(signIn)).toBe(false);
  });

  it('detects live openiam / createSession documents', () => {
    expect(
      isMidOAuthNavigation(
        'https://openiam.cathaypacific.com/am/oauth2/alpha/authorize?client_id=x',
      ),
    ).toBe(true);
    expect(
      isMidOAuthNavigation('https://api.cathaypacific.com/redibe/openId/createSession?code=abc'),
    ).toBe(true);
  });
});
