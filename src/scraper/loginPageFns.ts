/** Page-injected helpers for CX sign-in (self-contained for page.evaluate). */

export type CxLoginStep = 'mobile' | 'membership' | 'password';

export function detectLoginStep(): CxLoginStep | null {
  const isVisible = (el: Element | null | undefined): boolean => {
    if (!el) return false;
    let cur: Element | null = el;
    while (cur) {
      if (cur.hasAttribute('hidden')) return false;
      if (cur.getAttribute('aria-hidden') === 'true') return false;
      const cls = typeof (cur as HTMLElement).className === 'string' ? (cur as HTMLElement).className : '';
      if (/\b(hidden|d-none|ng-hide)\b/.test(cls)) return false;
      const style = (cur as HTMLElement).style;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      cur = cur.parentElement;
    }
    return true;
  };
  const mobile =
    document.querySelector<HTMLInputElement>('input[type="tel"][name="mobile"]') ??
    document.querySelector<HTMLInputElement>('input[type="tel"]');
  const membership = document.querySelector<HTMLInputElement>('input[name="membership"]');
  const password =
    document.querySelector<HTMLInputElement>('input#Password, input[name="password"][type="password"]') ??
    document.querySelector<HTMLInputElement>('input[type="password"]');
  if (isVisible(password) && !isVisible(mobile) && !isVisible(membership)) return 'password';
  if (isVisible(membership)) return 'membership';
  if (isVisible(mobile)) return 'mobile';
  if (isVisible(password)) return 'password';
  return null;
}

/** Switch from mobile/email entry to membership-number entry. Self-contained for page.evaluate. */
export function switchToMembershipLogin(): boolean {
  const isVisible = (el: Element | null | undefined): boolean => {
    if (!el) return false;
    let cur: Element | null = el;
    while (cur) {
      if (cur.hasAttribute('hidden')) return false;
      if (cur.getAttribute('aria-hidden') === 'true') return false;
      const cls = typeof (cur as HTMLElement).className === 'string' ? (cur as HTMLElement).className : '';
      if (/\b(hidden|d-none|ng-hide)\b/.test(cls)) return false;
      const style = (cur as HTMLElement).style;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      cur = cur.parentElement;
    }
    return true;
  };
  const membership = document.querySelector<HTMLInputElement>('input[name="membership"]');
  if (isVisible(membership)) return true;

  const press = (el: HTMLElement) => {
    el.focus();
    const opts: MouseEventInit = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
      el.dispatchEvent(new MouseEvent(type, opts));
    }
  };

  const candidates: HTMLElement[] = [];
  const byTealium = document.querySelector<HTMLElement>(
    '[data-tealium-event-action*="METHOD_CHANGE::MEMBERNUMBER"]',
  );
  if (byTealium) candidates.push(byTealium);
  for (const n of Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a'))) {
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (
      t === 'sign in with membership number' ||
      t.includes('membership number') ||
      t.includes('會員編號') ||
      t.includes('會員號碼')
    ) {
      candidates.push(n);
    }
  }
  const btn = candidates.find(n => isVisible(n) && !(n as HTMLButtonElement).disabled);
  if (!btn) return false;
  press(btn);
  return true;
}

/** Switch back to mobile-number entry if the page opened on another method. */
export function switchToMobileLogin(): boolean {
  const isVisible = (el: Element | null | undefined): boolean => {
    if (!el) return false;
    let cur: Element | null = el;
    while (cur) {
      if (cur.hasAttribute('hidden')) return false;
      if (cur.getAttribute('aria-hidden') === 'true') return false;
      const cls = typeof (cur as HTMLElement).className === 'string' ? (cur as HTMLElement).className : '';
      if (/\b(hidden|d-none|ng-hide)\b/.test(cls)) return false;
      const style = (cur as HTMLElement).style;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      cur = cur.parentElement;
    }
    return true;
  };
  const mobile =
    document.querySelector<HTMLInputElement>('input[type="tel"][name="mobile"]') ??
    document.querySelector<HTMLInputElement>('input[type="tel"]');
  if (isVisible(mobile)) return true;

  const press = (el: HTMLElement) => {
    el.focus();
    const opts: MouseEventInit = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
      el.dispatchEvent(new MouseEvent(type, opts));
    }
  };

  const candidates: HTMLElement[] = [];
  const byTealium = document.querySelector<HTMLElement>('[data-tealium-event-action*="METHOD_CHANGE::MOBILE"]');
  if (byTealium) candidates.push(byTealium);
  for (const n of Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a'))) {
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (
      t === 'sign in with mobile number' ||
      (t.includes('mobile number') && t.includes('sign in')) ||
      t.includes('手機號碼') ||
      t.includes('流動電話')
    ) {
      candidates.push(n);
    }
  }
  const btn = candidates.find(n => isVisible(n) && !(n as HTMLButtonElement).disabled);
  if (!btn) return false;
  press(btn);
  return true;
}

export function fillMembershipNumber(membership: string): boolean {
  const isVisible = (el: Element | null | undefined): boolean => {
    if (!el) return false;
    let cur: Element | null = el;
    while (cur) {
      if (cur.hasAttribute('hidden')) return false;
      if (cur.getAttribute('aria-hidden') === 'true') return false;
      const cls = typeof (cur as HTMLElement).className === 'string' ? (cur as HTMLElement).className : '';
      if (/\b(hidden|d-none|ng-hide)\b/.test(cls)) return false;
      const style = (cur as HTMLElement).style;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      cur = cur.parentElement;
    }
    return true;
  };
  const setReactValue = (el: HTMLInputElement, value: string) => {
    el.focus();
    const tracker = (el as HTMLInputElement & { _valueTracker?: { setValue: (v: string) => void } })._valueTracker;
    tracker?.setValue('');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      el.dispatchEvent(
        new InputEvent('input', { bubbles: true, cancelable: true, data: value, inputType: 'insertText' }),
      );
    } catch {
      // ignore
    }
  };

  const input = document.querySelector<HTMLInputElement>('input[name="membership"]');
  if (!input || !isVisible(input)) return false;
  setReactValue(input, membership);
  return input.value === membership || input.value.replace(/\s+/g, '') === membership.replace(/\s+/g, '');
}

export function fillMobileNumber(countryCode: string, mobile: string): boolean {
  const isVisible = (el: Element | null | undefined): boolean => {
    if (!el) return false;
    let cur: Element | null = el;
    while (cur) {
      if (cur.hasAttribute('hidden')) return false;
      if (cur.getAttribute('aria-hidden') === 'true') return false;
      const cls = typeof (cur as HTMLElement).className === 'string' ? (cur as HTMLElement).className : '';
      if (/\b(hidden|d-none|ng-hide)\b/.test(cls)) return false;
      const style = (cur as HTMLElement).style;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      cur = cur.parentElement;
    }
    return true;
  };
  const setReactValue = (el: HTMLInputElement, value: string) => {
    el.focus();
    const tracker = (el as HTMLInputElement & { _valueTracker?: { setValue: (v: string) => void } })._valueTracker;
    tracker?.setValue('');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      el.dispatchEvent(
        new InputEvent('input', { bubbles: true, cancelable: true, data: value, inputType: 'insertText' }),
      );
    } catch {
      // ignore
    }
  };

  const country = document.querySelector<HTMLElement>(
    '#mobileCountryCode, input[aria-controls="mobileCountryCodeOverlay"]',
  );
  if (country?.getAttribute('aria-expanded') === 'true') {
    country.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    country.blur();
  }

  const mobileInput =
    document.querySelector<HTMLInputElement>('input[type="tel"][name="mobile"]') ??
    document.querySelector<HTMLInputElement>('input[type="tel"]');
  if (!mobileInput || !isVisible(mobileInput)) return false;

  if (countryCode && countryCode !== '852') {
    const cc = document.querySelector<HTMLInputElement>('input[name*="country" i]');
    if (cc && cc !== mobileInput && isVisible(cc)) setReactValue(cc, `+${countryCode}`);
  }
  setReactValue(mobileInput, mobile);
  return mobileInput.value === mobile || mobileInput.value.replace(/\D/g, '') === mobile.replace(/\D/g, '');
}

export function clickMobileContinue(): boolean {
  const isVisible = (el: Element | null | undefined): boolean => {
    if (!el) return false;
    let cur: Element | null = el;
    while (cur) {
      if (cur.hasAttribute('hidden')) return false;
      if (cur.getAttribute('aria-hidden') === 'true') return false;
      const cls = typeof (cur as HTMLElement).className === 'string' ? (cur as HTMLElement).className : '';
      if (/\b(hidden|d-none|ng-hide)\b/.test(cls)) return false;
      const style = (cur as HTMLElement).style;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      cur = cur.parentElement;
    }
    return true;
  };
  const press = (el: HTMLElement) => {
    el.focus();
    const opts: MouseEventInit = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
      el.dispatchEvent(new MouseEvent(type, opts));
    }
  };

  const candidates: HTMLElement[] = [];
  // Prefer the active method's Continue (MOBILE / MEMBERNUMBER / EMAIL).
  for (const sel of [
    '[data-tealium-event-action*="CONTINUE_BTN::MEMBERNUMBER"]',
    '[data-tealium-event-action*="CONTINUE_BTN::MOBILE"]',
    '[data-tealium-event-action*="CONTINUE_BTN"]',
  ]) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) candidates.push(el);
  }
  const byClass = document.querySelector<HTMLElement>('button.masterSignIn__submitBtn');
  if (byClass) candidates.push(byClass);
  for (const n of Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))) {
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (t === 'continue' || t === 'next' || t === '繼續' || t === '下一步') candidates.push(n);
  }

  const btn = candidates.find(n => {
    if (!isVisible(n)) return false;
    if ((n as HTMLButtonElement).disabled) return false;
    if (n.getAttribute('aria-disabled') === 'true') return false;
    return true;
  });
  if (!btn) return false;
  press(btn);
  return true;
}

export function hasVisiblePasswordField(): boolean {
  const isVisible = (el: Element | null | undefined): boolean => {
    if (!el) return false;
    let cur: Element | null = el;
    while (cur) {
      if (cur.hasAttribute('hidden')) return false;
      if (cur.getAttribute('aria-hidden') === 'true') return false;
      const cls = typeof (cur as HTMLElement).className === 'string' ? (cur as HTMLElement).className : '';
      if (/\b(hidden|d-none|ng-hide)\b/.test(cls)) return false;
      const style = (cur as HTMLElement).style;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      cur = cur.parentElement;
    }
    return true;
  };
  const pw =
    document.querySelector<HTMLInputElement>('input#Password, input[name="password"][type="password"]') ??
    document.querySelector<HTMLInputElement>('input[type="password"]');
  return isVisible(pw);
}

export function fillPasswordValue(password: string): boolean {
  const isVisible = (el: Element | null | undefined): boolean => {
    if (!el) return false;
    let cur: Element | null = el;
    while (cur) {
      if (cur.hasAttribute('hidden')) return false;
      if (cur.getAttribute('aria-hidden') === 'true') return false;
      const cls = typeof (cur as HTMLElement).className === 'string' ? (cur as HTMLElement).className : '';
      if (/\b(hidden|d-none|ng-hide)\b/.test(cls)) return false;
      const style = (cur as HTMLElement).style;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      cur = cur.parentElement;
    }
    return true;
  };
  const pw =
    document.querySelector<HTMLInputElement>('input#Password') ??
    document.querySelector<HTMLInputElement>('input[name="password"][type="password"]') ??
    document.querySelector<HTMLInputElement>('input[type="password"]');
  if (!pw || !isVisible(pw)) return false;

  pw.focus();
  pw.click();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  const tracker = (pw as HTMLInputElement & { _valueTracker?: { setValue: (v: string) => void } })._valueTracker;
  tracker?.setValue(password);
  setter?.call(pw, '');
  tracker?.setValue('');
  try {
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
  } catch {
    // ignore
  }

  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, password);
  } catch {
    inserted = false;
  }
  if (!inserted || pw.value !== password) {
    tracker?.setValue('');
    setter?.call(pw, password);
    pw.dispatchEvent(new Event('input', { bubbles: true }));
    pw.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      pw.dispatchEvent(
        new InputEvent('input', { bubbles: true, cancelable: true, data: password, inputType: 'insertText' }),
      );
    } catch {
      // ignore
    }
  }

  if (pw.value !== password) {
    tracker?.setValue('');
    setter?.call(pw, '');
    pw.dispatchEvent(new Event('input', { bubbles: true }));
    let built = '';
    for (const ch of password) {
      built += ch;
      pw.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      tracker?.setValue(built.slice(0, -1));
      setter?.call(pw, built);
      try {
        pw.dispatchEvent(
          new InputEvent('input', { bubbles: true, cancelable: true, data: ch, inputType: 'insertText' }),
        );
      } catch {
        pw.dispatchEvent(new Event('input', { bubbles: true }));
      }
      pw.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
    }
    pw.dispatchEvent(new Event('change', { bubbles: true }));
  }

  return pw.value === password;
}

export function clickPasswordSignIn(): boolean {
  const isVisible = (el: Element | null | undefined): boolean => {
    if (!el) return false;
    let cur: Element | null = el;
    while (cur) {
      if (cur.hasAttribute('hidden')) return false;
      if (cur.getAttribute('aria-hidden') === 'true') return false;
      const cls = typeof (cur as HTMLElement).className === 'string' ? (cur as HTMLElement).className : '';
      if (/\b(hidden|d-none|ng-hide)\b/.test(cls)) return false;
      const style = (cur as HTMLElement).style;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      cur = cur.parentElement;
    }
    return true;
  };
  const press = (el: HTMLElement) => {
    el.focus();
    const opts: MouseEventInit = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
      el.dispatchEvent(new MouseEvent(type, opts));
    }
  };

  const candidates: HTMLElement[] = [];
  const byTealium = document.querySelector<HTMLElement>('[data-tealium-event-action*="SIGN_IN_WITH_PASSWORD_BTN"]');
  if (byTealium) candidates.push(byTealium);
  for (const n of Array.from(
    document.querySelectorAll<HTMLElement>('button.masterSignIn__btn, button, [role="button"]'),
  )) {
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (t === 'sign in' || t === 'log in' || t === 'login' || t === '登入') candidates.push(n);
  }
  const btn = candidates.find(n => {
    if (!isVisible(n)) return false;
    if ((n as HTMLButtonElement).disabled) return false;
    if (n.getAttribute('aria-disabled') === 'true') return false;
    return true;
  });
  if (!btn) return false;
  press(btn);
  return true;
}

/** Pure helper (unit-tested) — CX account lock / bot wall on sign-in. */
export function isSuspiciousActivityText(text: string): boolean {
  const t = text.replace(/\s+/g, ' ');
  return (
    /Suspicious activity detected/i.test(t) ||
    /unable to proceed as we detected suspicious activity/i.test(t) ||
    /偵測到可疑活動|檢測到可疑活動|可疑活動/.test(t)
  );
}

/** True when CX shows the "Suspicious activity detected" block instead of the login form. */
export function detectSuspiciousActivity(): boolean {
  if (!document.body) return false;
  const root = document.querySelector('.masterSignIn') ?? document.body;
  const text = (root.textContent || '').replace(/\s+/g, ' ');
  if (/Suspicious activity detected/i.test(text)) return true;
  if (/unable to proceed as we detected suspicious activity/i.test(text)) return true;
  if (/偵測到可疑活動|檢測到可疑活動|可疑活動/.test(text)) return true;
  return false;
}

export function detectLoginProblem(): boolean {
  if (!document.body) return false;

  // Prefer the dedicated suspicious check in callers; still treat as a problem here.
  const rootText = ((document.querySelector('.masterSignIn') ?? document.body).textContent || '').replace(
    /\s+/g,
    ' ',
  );
  if (
    /Suspicious activity detected/i.test(rootText) ||
    /unable to proceed as we detected suspicious activity/i.test(rootText) ||
    /偵測到可疑活動|檢測到可疑活動|可疑活動/.test(rootText)
  ) {
    return true;
  }

  const challenge = Array.from(
    document.querySelectorAll<HTMLIFrameElement>(
      'iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[title*="recaptcha" i]',
    ),
  ).find(frame => {
    const r = frame.getBoundingClientRect();
    return r.width >= 200 && r.height >= 140 && r.bottom > 0 && r.right > 0;
  });
  if (challenge) return true;

  const root = document.querySelector('.masterSignIn') ?? document.body;
  if (!root) return false;
  const alerts = Array.from(
    root.querySelectorAll<HTMLElement>('[role="alert"], .textfield__error, [class*="errorMessage" i]'),
  );
  return alerts.some(a => {
    const cls = typeof a.className === 'string' ? a.className : '';
    if (/\b(d-none|hidden|toastNotification|loading)\b/.test(cls)) return false;
    let cur: Element | null = a;
    while (cur) {
      const c = typeof (cur as HTMLElement).className === 'string' ? (cur as HTMLElement).className : '';
      if (/\b(d-none|hidden|toastNotification|loading)\b/.test(c)) return false;
      cur = cur.parentElement;
    }
    const t = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t || /^loading$/i.test(t)) return false;
    return a.offsetParent !== null || a.getClientRects().length > 0;
  });
}

export function isCxLoginFieldVisible(el: Element | null | undefined): boolean {
  if (!el) return false;
  let cur: Element | null = el;
  while (cur) {
    if (cur.hasAttribute('hidden')) return false;
    if (cur.getAttribute('aria-hidden') === 'true') return false;
    const cls = typeof (cur as HTMLElement).className === 'string' ? (cur as HTMLElement).className : '';
    if (/\b(hidden|d-none|ng-hide)\b/.test(cls)) return false;
    const style = (cur as HTMLElement).style;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    cur = cur.parentElement;
  }
  return true;
}
