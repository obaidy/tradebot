import { ConfigContext, ExpoConfig } from '@expo/config';

const REMOTE_BASE_URL = (process.env.MOBILE_REMOTE_BASE_URL || 'https://tradebot-api.onrender.com').trim();
const LOCAL_DEFAULTS = {
  api: 'http://localhost:9400/mobile',
  ws: 'ws://localhost:9400/mobile/ws',
};
const REMOTE_DEFAULTS = deriveUrls(REMOTE_BASE_URL);

function deriveUrls(baseUrl: string) {
  const sanitized = baseUrl.replace(/\/$/, '');
  try {
    const parsed = new URL(sanitized);
    const wsUrl = new URL(parsed.toString());
    wsUrl.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl.pathname = `${parsed.pathname.replace(/\/$/, '')}/mobile/ws`;

    return {
      api: `${sanitized}/mobile`,
      ws: wsUrl.toString(),
    };
  } catch {
    return LOCAL_DEFAULTS;
  }
}

function resolveDefaults() {
  const explicitApi = (process.env.MOBILE_API_BASE_URL || '').trim();
  const explicitWs = (process.env.MOBILE_WS_URL || '').trim();
  if (explicitApi) {
    return {
      api: explicitApi,
      ws: explicitWs || deriveWsFromApi(explicitApi),
    };
  }

  const mode = (process.env.MOBILE_API_MODE || process.env.APP_ENV || '').toLowerCase();
  if (mode === 'local' || mode === 'dev' || mode === 'development') {
    return LOCAL_DEFAULTS;
  }

  const adminUrl = (process.env.ADMIN_API_URL || '').trim();
  if (adminUrl && !adminUrl.includes('localhost')) {
    return deriveUrls(adminUrl);
  }

  return REMOTE_DEFAULTS;
}

function deriveWsFromApi(apiUrl: string) {
  try {
    const parsed = new URL(apiUrl);
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    // preserve existing pathname (already contains /mobile)
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/ws`;
    return parsed.toString();
  } catch {
    return LOCAL_DEFAULTS.ws;
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const defaults = resolveDefaults();

  return {
    ...config,
    name: 'TradeBot Mobile',
    slug: 'tradebot-mobile',
    owner: 'aka.obaidy89',
    scheme: 'tradebot',
    version: '0.1.0',
    orientation: 'portrait',
    entryPoint: './index.js',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#050710'
    },
    updates: {
      fallbackToCacheTimeout: 0
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      bundleIdentifier: 'com.obaidy.tradebot',
      supportsTablet: false,
      buildNumber: '1.0.0',
      entitlements: {
        'aps-environment': 'production',
      },
      config: {
        usesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'com.obaidy.tradebot',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#050710'
      }
    },
    plugins: [
      'expo-notifications',
      'expo-font',
    ],
    extra: {
      eas: {
        projectId: '73186a03-e83b-49b9-968a-1eff3135dd17',
      },
      apiBaseUrl: process.env.MOBILE_API_BASE_URL || defaults.api,
      websocketUrl: process.env.MOBILE_WS_URL || defaults.ws,
    }
  };
};
