import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import appReducer from './slices/appSlice';
import { tradebotApi } from '@/services/api';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    app: appReducer,
    [tradebotApi.reducerPath]: tradebotApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }).concat(tradebotApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
