/** Stable desktop fingerprint aligned with headed Chromium. */

export const FINGERPRINT = {
  /** Overridden at launch if browser.version() is available. */
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    isLandscape: true,
  },
  locale: 'en-HK',
  languages: ['en-HK', 'en', 'zh-HK', 'zh'],
  timezoneId: 'Asia/Hong_Kong',
  platform: 'MacIntel',
  webgl: {
    vendor: 'Google Inc. (Apple)',
    renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)',
  },
} as const;

export function userAgentForChromeVersion(versionLabel: string): string {
  const m = /(?:Chrome|Chromium)\/(\d[\d.]*)/i.exec(versionLabel);
  const ver = m?.[1] ?? '131.0.0.0';
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
}

/** Injected before any page script — patches common automation leaks + WebGL. */
export const FINGERPRINT_INIT_SCRIPT = `(() => {
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  } catch {}

  const languages = ${JSON.stringify([...FINGERPRINT.languages])};
  try {
    Object.defineProperty(Navigator.prototype, 'languages', {
      get: () => languages,
      configurable: true,
    });
  } catch {}
  try {
    Object.defineProperty(Navigator.prototype, 'language', {
      get: () => languages[0],
      configurable: true,
    });
  } catch {}
  try {
    Object.defineProperty(Navigator.prototype, 'platform', {
      get: () => ${JSON.stringify(FINGERPRINT.platform)},
      configurable: true,
    });
  } catch {}

  // Dummy chrome.runtime / csi like a normal extension-capable desktop Chrome.
  const w = window;
  w.chrome = w.chrome || {};
  if (!w.chrome.runtime) {
    w.chrome.runtime = {
      connect: () => ({}),
      sendMessage: () => {},
      id: undefined,
    };
  }
  if (!w.chrome.csi) {
    w.chrome.csi = () => ({
      startE: Date.now(),
      onloadT: Date.now(),
      pageT: Math.random() * 1000 + 500,
      tran: 15,
    });
  }
  if (!w.chrome.loadTimes) {
    w.chrome.loadTimes = () => ({});
  }

  const vendor = ${JSON.stringify(FINGERPRINT.webgl.vendor)};
  const renderer = ${JSON.stringify(FINGERPRINT.webgl.renderer)};
  const patch = (proto) => {
    if (!proto || proto.__cxPatchedWebgl) return;
    const getParameter = proto.getParameter;
    proto.getParameter = function (param) {
      if (param === 37445) return vendor;
      if (param === 37446) return renderer;
      return getParameter.call(this, param);
    };
    proto.__cxPatchedWebgl = true;
  };
  try { patch(WebGLRenderingContext && WebGLRenderingContext.prototype); } catch {}
  try { patch(WebGL2RenderingContext && WebGL2RenderingContext.prototype); } catch {}
})()`;
