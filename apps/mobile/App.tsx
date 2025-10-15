import React from 'react';
import { Provider } from 'react-redux';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { ThemeProvider } from './src/theme';
import { store } from './src/state/store';
import { AuthGate } from './src/screens/Auth/AuthGate';
import { AppNavigator } from './src/navigation/AppNavigator';
import { useNetworkMonitor } from './src/hooks/useNetworkMonitor';

WebBrowser.maybeCompleteAuthSession();

console.log('React Native JS version', require('react-native/package.json').version);

const Bootstrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useNetworkMonitor();
  return <>{children}</>;
};

export default function App() {
  return (
    <Provider store={store}>
      <ThemeProvider>
        <Bootstrapper>
          <StatusBar style="light" />
          <AuthGate>
            <AppNavigator />
          </AuthGate>
        </Bootstrapper>
      </ThemeProvider>
    </Provider>
  );
}
