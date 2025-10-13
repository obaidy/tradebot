export interface PortfolioSummary {
  clientId: string;
  totalPnlUsd: number;
  dayChangePct: number;
  bankRollUsd: number;
  activeStrategies: number;
  updatedAt: string;
}

export type StrategyStatusState = 'running' | 'paused' | 'error';
export type StrategyRunMode = 'live' | 'paper';

export interface StrategyStatus {
  strategyId: string;
  name: string;
  runMode: StrategyRunMode;
  status: StrategyStatusState;
  pnlPct: number;
  lastRunAt: string;
}

export interface DashboardSummaryResponse {
  portfolio: PortfolioSummary;
  strategies: StrategyStatus[];
  risk: {
    globalDrawdownUsd: number;
    exposurePct: number;
    guardState: 'nominal' | 'warning' | 'critical';
  };
  quickActions: {
    killSwitchAvailable: boolean;
    pauseAllAvailable: boolean;
  };
}

export type ActivityType = 'trade' | 'alert' | 'system';
export type ActivitySeverity = 'info' | 'warn' | 'critical';

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  severity?: ActivitySeverity;
  title: string;
  description: string;
  asset?: string;
  pnlUsd?: number;
  createdAt: string;
}

export interface ActivityFeedResponse {
  entries: ActivityEntry[];
  nextCursor?: string;
}

export interface ControlConfirmationPayload {
  confirmToken?: string;
  mfaToken?: string;
  biometricSignature?: string;
}

export interface KillSwitchRequest extends ControlConfirmationPayload {
  reason: string;
}

export interface KillSwitchResponse {
  acknowledged: boolean;
  executedAt?: string;
}

export interface PauseAllRequest extends ControlConfirmationPayload {}

export interface ResumeAllRequest extends ControlConfirmationPayload {}

export interface StrategyControlRequest extends ControlConfirmationPayload {
  strategyId: string;
  action: 'pause' | 'resume';
}

export interface NotificationChannelConfig {
  channel: 'push' | 'email' | 'slack';
  enabled: boolean;
  quietHours?: { start: string; end: string; timezone: string };
  severityThreshold: ActivitySeverity;
}

export interface NotificationPreferences {
  userId: string;
  channels: NotificationChannelConfig[];
  updatedAt: string;
}

export interface DeviceRegistrationPayload {
  deviceId: string;
  pushToken?: string;
  platform: 'ios' | 'android';
  appVersion: string;
}
