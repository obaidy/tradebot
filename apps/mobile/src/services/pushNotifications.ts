import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const DEFAULT_CHANNEL = 'tradebot-alerts';

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL, {
    name: 'Alerts',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#3A7BFA',
  });
}

export async function registerForPushNotifications(): Promise<string | null> {
  const settings = await Notifications.getPermissionsAsync();
  let finalStatus = settings.granted;

  if (!finalStatus) {
    const request = await Notifications.requestPermissionsAsync();
    finalStatus = request.granted || request.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  }

  if (!finalStatus) {
    return null;
  }

  await ensureAndroidChannel();

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.expoConfig?.extra?.easProjectId ??
    Constants.easConfig?.projectId;

  const tokenResponse = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );
  return tokenResponse.data ?? null;
}
