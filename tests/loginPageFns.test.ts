import { describe, expect, it } from 'vitest';
import { isSuspiciousActivityText } from '../src/scraper/loginPageFns.js';

describe('isSuspiciousActivityText', () => {
  it('matches the CX English block', () => {
    expect(
      isSuspiciousActivityText(
        'Suspicious activity detected You’re unable to proceed as we detected suspicious activity regarding your account.',
      ),
    ).toBe(true);
  });

  it('matches Chinese copy', () => {
    expect(isSuspiciousActivityText('偵測到可疑活動 請稍後再試')).toBe(true);
  });

  it('ignores normal sign-in copy', () => {
    expect(isSuspiciousActivityText('Sign in Mobile number Continue')).toBe(false);
  });
});
