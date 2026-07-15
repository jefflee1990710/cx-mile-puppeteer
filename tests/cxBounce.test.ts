import { describe, expect, it } from 'vitest';
import { classifyCxBounce } from '../src/scraper/cxBounce.js';

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
