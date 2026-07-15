/** Desktop fingerprint aligned with the host OS + headed Chrome. */

export type WebGlFingerprint = {
  vendor: string;
  renderer: string;
};

export type FingerprintProfile = {
  /** Overridden at launch if browser.version() is available. */
  userAgent: string;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
    isMobile: boolean;
    hasTouch: boolean;
    isLandscape: boolean;
  };
  locale: string;
  languages: readonly string[];
  timezoneId: string;
  platform: string;
  /**
   * When null, leave the real WebGL vendor/renderer alone.
   * Spoofing Apple Metal on Windows is a classic Akamai tripwire.
   */
  webgl: WebGlFingerprint | null;
};

function buildFingerprint(platform: NodeJS.Platform = process.platform): FingerprintProfile {
  const shared = {
    locale: 'en-HK',
    languages: ['en-HK', 'en', 'zh-HK', 'zh'] as const,
    timezoneId: 'Asia/Hong_Kong',
  };

  if (platform === 'win32') {
    return {
      ...shared,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        isLandscape: true,
      },
      platform: 'Win32',
      // Real Windows Chrome GPU varies — do not pretend to be Apple Silicon.
      webgl: null,
    };
  }

  if (platform === 'linux') {
    return {
      ...shared,
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        isLandscape: true,
      },
      platform: 'Linux x86_64',
      webgl: null,
    };
  }

  // darwin (and anything else) — match previous Mac desktop profile
  return {
    ...shared,
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
    platform: 'MacIntel',
    webgl: {
      vendor: 'Google Inc. (Apple)',
      renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)',
    },
  };
}

export const FINGERPRINT: FingerprintProfile = buildFingerprint();

/** Exported for tests — build a profile for a given Node platform. */
export function fingerprintForPlatform(platform: NodeJS.Platform): FingerprintProfile {
  return buildFingerprint(platform);
}

export function userAgentForChromeVersion(
  versionLabel: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const m = /(?:Chrome|Chromium)\/(\d[\d.]*)/i.exec(versionLabel);
  const ver = m?.[1] ?? '131.0.0.0';
  if (platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
  }
  if (platform === 'linux') {
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
  }
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
}

/** Injected before any page script — patches common automation leaks (+ WebGL when set). */
export function buildFingerprintInitScript(fp: FingerprintProfile = FINGERPRINT): string {
  const webglPatch =
    fp.webgl == null
      ? ''
      : `
  const vendor = ${JSON.stringify(fp.webgl.vendor)};
  const renderer = ${JSON.stringify(fp.webgl.renderer)};
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
`;

  return `(() => {
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  } catch {}

  const languages = ${JSON.stringify([...fp.languages])};
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
      get: () => ${JSON.stringify(fp.platform)},
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
${webglPatch}})()`;
}

/** @deprecated Prefer buildFingerprintInitScript() — kept for call sites that expect a string const. */
export const FINGERPRINT_INIT_SCRIPT = buildFingerprintInitScript();
