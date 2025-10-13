import { ConfigContext, ExpoConfig } from '@expo/config';

const buildDefaultUrls = () => {
  const adminUrl = (process.env.ADMIN_API_URL || '').trim().replace(/\/$/, '');
  if (!adminUrl) {
    return {
      api: 'http://localhost:9400/mobile',
      ws: 'ws://localhost:9400/mobile/ws',
    };
  }

  const api = `${adminUrl}/mobile`;
  try {
    const parsed = new URL(adminUrl);
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/mobile/ws`;
    return {
      api,
      ws: parsed.toString(),
    };
  } catch {
    return {
      api,
      ws: 'ws://localhost:9400/mobile/ws',
    };
  }
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const defaults = buildDefaultUrls();

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
