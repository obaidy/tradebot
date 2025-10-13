import React from 'react';
import { Provider } from 'react-redux';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { ThemeProvider } from './src/theme';
import { store } from './src/state/store';
import { AuthGate } from './src/screens/Auth/AuthGate';
import { AppNavigator } from './src/navigation/AppNavigator';

WebBrowser.maybeCompleteAuthSession();

console.log('React Native JS version', require('react-native/package.json').version);

export default function App() {
  return (
    <Provider store={store}>
      <ThemeProvider>
        <StatusBar style="light" />
        <AuthGate>
          <AppNavigator />
        </AuthGate>
      </ThemeProvider>
    </Provider>
  );
}
