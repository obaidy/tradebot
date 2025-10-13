import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { AuthState } from '@/state/slices/authSlice';
import { API_BASE_URL } from '@/constants/env';
import type {
  ActivityFeedResponse,
  DashboardSummaryResponse,
  KillSwitchRequest,
  KillSwitchResponse,
  NotificationPreferences,
  PauseAllRequest,
  ResumeAllRequest,
  StrategyControlRequest,
  DeviceRegistrationPayload,
  StrategyStatus,
} from './types';

export const tradebotApi = createApi({
  reducerPath: 'tradebotApi',
  baseQuery: fetchBaseQuery({
    baseUrl: API_BASE_URL,
    prepareHeaders: (headers, { getState }) => {
      const state = getState() as { auth: AuthState };
      if (state.auth?.accessToken) {
        headers.set('Authorization', `Bearer ${state.auth.accessToken}`);
      }
      headers.set('Accept', 'application/json');
      return headers;
    },
  }),
  tagTypes: ['Dashboard', 'Activity', 'Strategies', 'Notifications'],
  endpoints: (builder) => ({
    getDashboardSummary: builder.query<DashboardSummaryResponse, void>({
      query: () => 'v1/dashboard/summary',
      providesTags: ['Dashboard'],
    }),
    getActivityFeed: builder.query<ActivityFeedResponse, { cursor?: string }>({
      query: ({ cursor }) => ({
        url: 'v1/activity',
        params: cursor ? { cursor } : undefined,
      }),
      providesTags: (result) =>
        result?.entries
          ? [...result.entries.map((entry) => ({ type: 'Activity' as const, id: entry.id })), 'Activity']
          : ['Activity'],
    }),
    getNotificationPreferences: builder.query<NotificationPreferences, void>({
      query: () => 'v1/notifications/preferences',
      providesTags: ['Notifications'],
    }),
    getStrategies: builder.query<StrategyStatus[], void>({
      query: () => 'v1/strategies',
      providesTags: (result) =>
        result
          ? [
              ...result.map((item) => ({ type: 'Strategies' as const, id: item.strategyId })),
              'Strategies',
            ]
          : ['Strategies'],
    }),
    updateNotificationPreferences: builder.mutation<NotificationPreferences, NotificationPreferences>({
      query: (body) => ({
        url: 'v1/notifications/preferences',
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['Notifications'],
    }),
    triggerKillSwitch: builder.mutation<KillSwitchResponse, KillSwitchRequest>({
      query: (body) => ({
        url: 'v1/controls/kill-switch',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Dashboard', 'Activity'],
    }),
    pauseAllControls: builder.mutation<void, PauseAllRequest>({
      query: (body) => ({
        url: 'v1/controls/pause-all',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Dashboard', 'Strategies', 'Activity'],
    }),
    resumeAllControls: builder.mutation<void, ResumeAllRequest>({
      query: (body) => ({
        url: 'v1/controls/resume-all',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Dashboard', 'Strategies', 'Activity'],
    }),
    controlStrategy: builder.mutation<void, StrategyControlRequest>({
      query: ({ strategyId, action, ...body }) => ({
        url: `v1/controls/strategies/${strategyId}/${action}`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Strategies', 'Dashboard', 'Activity'],
    }),
    registerDevice: builder.mutation<void, DeviceRegistrationPayload>({
      query: (body) => ({
        url: 'v1/devices/register',
        method: 'POST',
        body,
      }),
    }),
  }),
});

export const {
  useGetDashboardSummaryQuery,
  useGetActivityFeedQuery,
  useGetNotificationPreferencesQuery,
  useGetStrategiesQuery,
  useUpdateNotificationPreferencesMutation,
  useTriggerKillSwitchMutation,
  usePauseAllControlsMutation,
  useResumeAllControlsMutation,
  useControlStrategyMutation,
  useRegisterDeviceMutation,
} = tradebotApi;
