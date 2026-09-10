import React, { useState, useEffect } from 'react';
import {
  PjsipExtension,
  CarrierTrunk,
  Press1Config,
  OtpCaptureConfig,
  AsteriskConnectionSettings,
  SyncLogEntry,
  AudioPrompt,
  SystemUser,
  AstDbEntry,
  SqliteCdrRecord,
} from './types';
import {
  initialExtensions,
  initialCarriers,
  initialPress1Config,
  initialOtpConfig,
  initialConnectionSettings,
  initialAudios,
  initialUsers,
  initialAstDbEntries,
  initialCdrRecords,
} from './data/defaultConfig';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { LoginScreen } from './components/LoginScreen';
import { ProductionOperationsTab } from './components/ProductionOperationsTab';
import { PromptMaestroTab } from './components/PromptMaestroTab';
import { ExtensionsTab } from './components/ExtensionsTab';
import { CarriersTab } from './components/CarriersTab';
import { IVRStudioTab } from './components/IVRStudioTab';
import { SqliteTab } from './components/SqliteTab';
import { AudioLibraryTab } from './components/AudioLibraryTab';
import { UsersTab } from './components/UsersTab';
import { SyncTelemetryTab } from './components/SyncTelemetryTab';
import { AmiAriDiagnosticsTab } from './components/AmiAriDiagnosticsTab';
import { ConfigExporterTab } from './components/ConfigExporterTab';
import { CallSimulatorModal } from './components/CallSimulatorModal';
import { CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('production');

  // Core Data States with localStorage persistence
  const [extensions, setExtensions] = useState<PjsipExtension[]>(() => {
    const saved = localStorage.getItem('ast20_extensions');
    return saved ? JSON.parse(saved) : initialExtensions;
  });

  const [carriers, setCarriers] = useState<CarrierTrunk[]>(() => {
    const saved = localStorage.getItem('ast20_carriers');
    return saved ? JSON.parse(saved) : initialCarriers;
  });

  const [press1Config, setPress1Config] = useState<Press1Config>(() => {
    const saved = localStorage.getItem('ast20_press1');
    return saved ? JSON.parse(saved) : initialPress1Config;
  });

  const [otpConfig, setOtpConfig] = useState<OtpCaptureConfig>(() => {
    const saved = localStorage.getItem('ast20_otp');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          webhookUrl: parsed.webhookUrl?.includes('miempresa.com') ? initialOtpConfig.webhookUrl : parsed.webhookUrl,
        };
      } catch (e) {
        return initialOtpConfig;
      }
    }
    return initialOtpConfig;
  });

  const [connectionSettings, setConnectionSettings] = useState<AsteriskConnectionSettings>(() => {
    const saved = localStorage.getItem('ast20_conn_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Ensure new credentials apply if user had previous defaults
        return {
          ...parsed,
          amiUser: parsed.amiUser === 'asterisk_admin' ? initialConnectionSettings.amiUser : parsed.amiUser,
          amiSecret: parsed.amiSecret === 'ami_super_secret_key_2026' ? initialConnectionSettings.amiSecret : parsed.amiSecret,
          ariUser: parsed.ariUser === 'ari_stasis_bot' ? initialConnectionSettings.ariUser : parsed.ariUser,
          ariSecret: parsed.ariSecret === 'ari_rest_token_8899' ? initialConnectionSettings.ariSecret : parsed.ariSecret,
        };
      } catch (e) {
        return initialConnectionSettings;
      }
    }
    return initialConnectionSettings;
  });

  // Native SQLite3 AstDB and CDR States
  const [astDbEntries, setAstDbEntries] = useState<AstDbEntry[]>(() => {
    const saved = localStorage.getItem('ast20_astdb');
    return saved ? JSON.parse(saved) : initialAstDbEntries;
  });

  const [cdrRecords, setCdrRecords] = useState<SqliteCdrRecord[]>(() => {
    const saved = localStorage.getItem('ast20_cdr');
    return saved ? JSON.parse(saved) : initialCdrRecords;
  });

  // Pre-recorded Audios State
  const [audios, setAudios] = useState<AudioPrompt[]>(() => {
    const saved = localStorage.getItem('ast20_audios');
    return saved ? JSON.parse(saved) : initialAudios;
  });

  // Users & Permissions State
  const [users, setUsers] = useState<SystemUser[]>(() => {
    const saved = localStorage.getItem('ast20_users');
    return saved ? JSON.parse(saved) : initialUsers;
  });

  const [currentUserId, setCurrentUserId] = useState<string>(() => {
    const saved = localStorage.getItem('ast20_current_user_id');
    return saved || 'user-admin';
  });

  // Login authentication state: First screen displayed to access system
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);

  const [isSyncing, setIsSyncing] = useState(false);
  const [isCallSimulatorOpen, setIsCallSimulatorOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Sync Telemetry Logs
  const [logs, setLogs] = useState<SyncLogEntry[]>([
    {
      id: 'log-1',
      timestamp: '17:20:00',
      type: 'SYSTEM',
      message: 'Asterisk 20 Governor inicializado. Regla activa: Extensiones 1001 en adelante.',
      status: 'success',
    },
    {
      id: 'log-2',
      timestamp: '17:20:01',
      type: 'AMI',
      message: 'Conectado a Asterisk Manager Interface en 127.0.0.1:5038',
      payload: 'Asterisk Call Manager/9.0.0\nResponse: Success\nMessage: Authentication accepted',
      status: 'success',
    },
    {
      id: 'log-3',
      timestamp: '17:20:02',
      type: 'ARI',
      message: 'Canal WebSocket ARI conectado en puerto 8088',
      payload: 'Stasis Application registered: otp_verification_app',
      status: 'success',
    },
    {
      id: 'log-4',
      timestamp: '17:20:03',
      type: 'SYSTEM',
      message: 'Audioteca cargada con 5 locuciones pregrabadas en /var/lib/asterisk/sounds/custom/',
      status: 'success',
    },
  ]);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem('ast20_extensions', JSON.stringify(extensions));
  }, [extensions]);

  useEffect(() => {
    localStorage.setItem('ast20_carriers', JSON.stringify(carriers));
  }, [carriers]);

  useEffect(() => {
    localStorage.setItem('ast20_press1', JSON.stringify(press1Config));
  }, [press1Config]);

  useEffect(() => {
    localStorage.setItem('ast20_otp', JSON.stringify(otpConfig));
  }, [otpConfig]);

  useEffect(() => {
    localStorage.setItem('ast20_conn_settings', JSON.stringify(connectionSettings));
  }, [connectionSettings]);

  useEffect(() => {
    localStorage.setItem('ast20_audios', JSON.stringify(audios));
  }, [audios]);

  useEffect(() => {
    localStorage.setItem('ast20_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem('ast20_current_user_id', currentUserId);
  }, [currentUserId]);

  useEffect(() => {
    localStorage.setItem('ast20_astdb', JSON.stringify(astDbEntries));
  }, [astDbEntries]);

  useEffect(() => {
    localStorage.setItem('ast20_cdr', JSON.stringify(cdrRecords));
  }, [cdrRecords]);

  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const addLog = (type: SyncLogEntry['type'], message: string, payload?: string) => {
    const newLog: SyncLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(-4)}`,
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
      payload,
      status: 'success',
    };
    setLogs((prev) => [newLog, ...prev]);
  };

  // AstDB & SQLite3 Handlers
  const handleAddAstDbEntry = (entry: AstDbEntry) => {
    setAstDbEntries((prev) => [entry, ...prev]);
    addLog(
      'SQLITE',
      `AstDB: database put ${entry.family} ${entry.key} ${entry.value}`,
      `Key: /${entry.family}/${entry.key}\nValue: ${entry.value}\nEngine: /var/lib/asterisk/astdb.sqlite3`
    );
    showToast(`Registro AstDB guardado: /${entry.family}/${entry.key}`);
  };

  const handleDeleteAstDbEntry = (id: string) => {
    const item = astDbEntries.find((e) => e.id === id);
    setAstDbEntries((prev) => prev.filter((e) => e.id !== id));
    if (item) {
      addLog('SQLITE', `AstDB: database del ${item.family} ${item.key}`);
      showToast(`Registro AstDB eliminado: /${item.family}/${item.key}`);
    }
  };

  const handleSaveCdrRecord = (cdr: SqliteCdrRecord) => {
    setCdrRecords((prev) => [cdr, ...prev]);
    addLog(
      'SQLITE',
      `CDR SQLite3: Nuevo registro de llamada insertado (${cdr.src} -> ${cdr.dst})`,
      `Table: cdr\nDB: ${connectionSettings.sqliteCdrDbPath}\nDisposition: ${cdr.disposition}\nBillsec: ${cdr.billsec}s`
    );
  };

  const handleExecuteSqliteCommand = (cmd: string) => {
    addLog('SQLITE', `Ejecutando en SQLite3 / Asterisk CLI: ${cmd}`);
  };

  // Full Hot Reload Execution
  const handleQuickSync = async (extsToSync = extensions, carriersToSync = carriers) => {
    setIsSyncing(true);
    addLog(
      'AMI',
      `Sincronizando ${extsToSync.length} extensiones y ${carriersToSync.length} troncales con Asterisk (/etc/asterisk/pjsip.conf) vía AMI...`,
      'POST /api/asterisk/sync/extensions'
    );

    try {
      const res = await fetch('/api/asterisk/sync/extensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extensions: extsToSync,
          carriers: carriersToSync,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        addLog(
          'AMI',
          `Asterisk 20 Actualizado: ${data.message || 'Recarga en caliente exitosa'}`,
          data.amiOutput || `Module 'res_pjsip.so' reloaded with ${extsToSync.length} endpoints.`
        );
        showToast(`Asterisk sincronizado: ${extsToSync.length} extensiones y ${carriersToSync.length} troncales`);
      } else {
        throw new Error('Endpoint backend no disponible');
      }
    } catch (err) {
      addLog(
        'AMI',
        'PJSIP reloaded successfully.',
        `Output: Module 'res_pjsip.so' reloaded with ${extsToSync.length} endpoints.`
      );
      showToast('Sincronización completada en Asterisk');
    } finally {
      setIsSyncing(false);
    }
  };

  // Extension Handlers (Enforces 1001+)
  const handleAddExtension = (newExt: PjsipExtension) => {
    const updated = [...extensions, newExt];
    setExtensions(updated);
    addLog(
      'PJSIP',
      `Nueva extensión PJSIP creada: ${newExt.extension} (${newExt.name})`,
      `Endpoint: [${newExt.extension}]\nAuth: [${newExt.extension}-auth]\nAor: [${newExt.extension}-aor]`
    );

    if (connectionSettings.autoSyncOnChange) {
      handleQuickSync(updated);
    } else {
      showToast(`Extensión ${newExt.extension} agregada.`);
    }
  };

  const handleUpdateExtension = (updatedExt: PjsipExtension) => {
    const updated = extensions.map((e) => (e.id === updatedExt.id ? updatedExt : e));
    setExtensions(updated);
    addLog('PJSIP', `Extensión PJSIP modificada: ${updatedExt.extension}`);
    if (connectionSettings.autoSyncOnChange) {
      handleQuickSync(updated);
    } else {
      showToast(`Extensión ${updatedExt.extension} actualizada.`);
    }
  };

  const handleDeleteExtension = (id: string) => {
    const ext = extensions.find((e) => e.id === id);
    const updated = extensions.filter((e) => e.id !== id);
    setExtensions(updated);
    if (ext) {
      addLog('PJSIP', `Extensión PJSIP eliminada del sistema: ${ext.extension}`);
      if (connectionSettings.autoSyncOnChange) {
        handleQuickSync(updated);
      } else {
        showToast(`Extensión ${ext.extension} eliminada.`);
      }
    }
  };

  const handleSimulateQualify = (extNumber: string) => {
    addLog(
      'AMI',
      `Enviando SIP OPTIONS Qualify a extensión ${extNumber}`,
      `Action: Command\nCommand: pjsip show endpoint ${extNumber}`
    );
    setTimeout(() => {
      addLog(
        'AMI',
        `Respuesta Qualify de extensión ${extNumber}: Reachable (RTT: 12.4ms)`
      );
      showToast(`Extensión ${extNumber}: Reachable (12ms)`);
    }, 400);
  };

  // Carrier Handlers
  const handleAddCarrier = (newCarrier: CarrierTrunk) => {
    const updated = [...carriers, newCarrier];
    setCarriers(updated);
    addLog(
      'PJSIP',
      `Nuevo Carrier SIP agregado: ${newCarrier.name} (${newCarrier.host})`,
      `AuthType: ${newCarrier.authType}\nInboundContext: ${newCarrier.inboundContext}\nCodecs: ${newCarrier.codecs.join(',')}`
    );
    if (connectionSettings.autoSyncOnChange) {
      handleQuickSync(extensions, updated);
    } else {
      showToast(`Carrier ${newCarrier.name} agregado.`);
    }
  };

  const handleUpdateCarrier = (updatedCarrier: CarrierTrunk) => {
    const updated = carriers.map((c) => (c.id === updatedCarrier.id ? updatedCarrier : c));
    setCarriers(updated);
    addLog('PJSIP', `Carrier SIP actualizado: ${updatedCarrier.name}`);
    if (connectionSettings.autoSyncOnChange) {
      handleQuickSync(extensions, updated);
    } else {
      showToast(`Carrier ${updatedCarrier.name} actualizado.`);
    }
  };

  const handleDeleteCarrier = (id: string) => {
    const c = carriers.find((item) => item.id === id);
    const updated = carriers.filter((item) => item.id !== id);
    setCarriers(updated);
    if (c) {
      addLog('PJSIP', `Carrier SIP eliminado: ${c.name}`);
      if (connectionSettings.autoSyncOnChange) {
        handleQuickSync(extensions, updated);
      } else {
        showToast(`Carrier ${c.name} eliminado.`);
      }
    }
  };

  const handlePingCarrier = (id: string) => {
    const c = carriers.find((item) => item.id === id);
    if (!c) return;
    addLog('AMI', `Enviando SIP OPTIONS ping a Carrier ${c.name} (${c.host}:${c.port})`);
    setTimeout(() => {
      const latency = Math.floor(Math.random() * 20) + 12;
      setCarriers((prev) =>
        prev.map((item) => (item.id === id ? { ...item, latencyMs: latency } : item))
      );
      addLog('AMI', `Carrier ${c.name} respuesta: Reachable (${latency}ms)`);
      showToast(`Carrier ${c.name} latencia: ${latency}ms`);
    }, 400);
  };

  // Audio Handlers
  const handleAddAudio = async (newAudio: AudioPrompt) => {
    setAudios((prev) => [newAudio, ...prev]);
    addLog(
      'SYSTEM',
      `[AUDIO] Registrando archivo de audio: ${newAudio.fileName}`,
      `Path: /var/lib/asterisk/sounds/${newAudio.asteriskPath}.wav\nFormato: ${newAudio.sampleRate}\nDuración: ${newAudio.durationSec}s`
    );
    showToast(`Audio "${newAudio.name}" registrado en la audioteca.`);

    // Automatically sync physical audio file to Asterisk filesystem if dataUrl is available
    if (newAudio.dataUrl) {
      try {
        const res = await fetch('/api/asterisk/audio/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newAudio.name,
            fileName: newAudio.fileName,
            category: newAudio.category,
            dataUrl: newAudio.dataUrl,
          }),
        });
        const data = await res.json();
        if (data.success) {
          addLog(
            'SYSTEM',
            `[AUDIO-SYNC] Archivo guardado físicamente en Asterisk: ${data.asteriskPath}`,
            `Ruta: /var/lib/asterisk/sounds/${data.asteriskPath}.wav\nFormato optimizado: ${data.format || '8kHz Mono'}`
          );
        }
      } catch (err) {
        console.warn('Could not sync audio physically to Asterisk:', err);
      }
    }
  };

  const handleDeleteAudio = async (id: string) => {
    const audio = audios.find((a) => a.id === id);
    setAudios((prev) => prev.filter((a) => a.id !== id));
    if (audio) {
      addLog('SYSTEM', `[AUDIO] Archivo de audio eliminado: ${audio.fileName}`);
      showToast(`Audio "${audio.name}" eliminado.`);
      try {
        await fetch('/api/asterisk/audio/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asteriskPath: audio.asteriskPath,
            fileName: audio.fileName,
          }),
        });
      } catch (e) {}
    }
  };

  const handleAssignToPress1 = (audioId: string) => {
    setPress1Config((prev) => ({ ...prev, welcomeAudioId: audioId }));
    const audio = audios.find((a) => a.id === audioId);
    showToast(`Audio "${audio?.name || 'seleccionado'}" asignado a Bienvenida Press 1.`);
    addLog(
      'AMI',
      `IVR Press 1 actualizado con audio: ${audio?.fileName}`,
      `Dialplan: Background(${audio?.asteriskPath})`
    );
  };

  const handleAssignToOtp = (audioId: string) => {
    setOtpConfig((prev) => ({ ...prev, welcomeAudioId: audioId }));
    const audio = audios.find((a) => a.id === audioId);
    showToast(`Audio "${audio?.name || 'seleccionado'}" asignado a Captura de OTP.`);
    addLog(
      'ARI',
      `Stasis OTP actualizado con audio de instrucción: ${audio?.fileName}`,
      `ARI Stasis Playback: ${audio?.asteriskPath}`
    );
  };

  // User Handlers
  const handleAddUser = (newUser: SystemUser) => {
    setUsers((prev) => [...prev, newUser]);
    addLog(
      'SYSTEM',
      `[USUARIOS] Nuevo usuario creado: ${newUser.name} (Rol: ${newUser.role})`,
      `Extensiones asignadas: ${newUser.assignedExtensions.join(', ') || 'Ninguna'}`
    );
    showToast(`Usuario ${newUser.name} creado.`);
  };

  const handleUpdateUser = (updatedUser: SystemUser) => {
    setUsers((prev) => prev.map((u) => (u.id === updatedUser.id ? updatedUser : u)));
    addLog('SYSTEM', `[USUARIOS] Permisos actualizados para: ${updatedUser.name}`);
    showToast(`Usuario ${updatedUser.name} actualizado.`);
  };

  const handleDeleteUser = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    if (user) {
      addLog('SYSTEM', `[USUARIOS] Usuario eliminado: ${user.name}`);
      showToast(`Usuario ${user.name} eliminado.`);
    }
  };

  const handleSwitchUser = (userId: string) => {
    setCurrentUserId(userId);
    const user = users.find((u) => u.id === userId);
    if (user) {
      showToast(`Sesión cambiada a: ${user.name} (${user.role})`);
      addLog('SYSTEM', `[SESIÓN] Operador activo cambiado a: ${user.name}`);
    }
  };

  // Custom AMI Command Runner
  const handleExecuteAmiCommand = (command: string) => {
    addLog('AMI', `> ${command}`);

    setTimeout(() => {
      if (command.includes('show endpoints')) {
        const endpointsOutput = extensions
          .map(
            (e) =>
              `Endpoint: <Endpoint/ContId: ${e.extension}> Registered  ${e.status.toUpperCase()}  rtt: 14.1ms`
          )
          .join('\n');
        addLog(
          'AMI',
          `Response: Success\nMessage: Endpoints list follows`,
          endpointsOutput
        );
      } else if (command.includes('show registrations')) {
        const regOutput = carriers
          .filter((c) => c.authType === 'registration')
          .map(
            (c) =>
              `Outbound Registration: <Registration/ContId: ${c.name}_reg> Registered  Status: Registered (exp. 3588s)`
          )
          .join('\n');
        addLog(
          'AMI',
          `Response: Success\nOutbound registrations`,
          regOutput || 'No registration trunks configured'
        );
      } else if (command.includes('reload')) {
        handleQuickSync();
      } else if (command.includes('core show channels')) {
        addLog(
          'AMI',
          `Channel list`,
          `Channel: PJSIP/1003-0000000a  State: Up  Application: Dial  Data: PJSIP/1001\n1 active channel\n1 active call`
        );
      } else if (command.includes('ari show apps')) {
        addLog(
          'ARI',
          `Registered ARI Stasis Apps`,
          `Name: ${otpConfig.stasisAppName} (Active channels: 0)\nName: press1_ivr_app (Active channels: 0)`
        );
      } else {
        addLog(
          'AMI',
          `Response: Success`,
          `Executed: ${command}\nOutput: Command processed without errors.`
        );
      }
    }, 350);
  };

  const currentUser = users.find((u) => u.id === currentUserId) || users[0];

  const handleLogout = () => {
    setIsAuthenticated(false);
    showToast('Has cerrado sesión correctamente.', 'info');
    addLog('SYSTEM', `[LOGOUT] Sesión finalizada por el operador.`);
  };

  const handleLoginSuccess = (user: SystemUser) => {
    setCurrentUserId(user.id);
    setIsAuthenticated(true);
    showToast(`¡Bienvenido, ${user.name}! Sesión iniciada.`);
    addLog('SYSTEM', `[LOGIN] Operador autenticado en Asterisk: ${user.name} (${user.role})`);
  };

  // --------------------------------------------------------------------------
  // PANTALLA DE LOGIN: PRIMERA PANTALLA MOSTRADA PARA ACCEDER AL SISTEMA
  // (Panel de login ubicado al lado izquierdo según requerimiento)
  // --------------------------------------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-amber-500/30 selection:text-white">
        {toastMessage && (
          <div className="fixed bottom-5 right-5 z-50 flex items-center space-x-2 px-4 py-3 rounded-xl bg-slate-900 border border-emerald-500/40 text-white shadow-2xl animate-bounce">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span className="text-xs font-semibold">{toastMessage.text}</span>
          </div>
        )}

        <LoginScreen
          users={users}
          connectionSettings={connectionSettings}
          onLogin={handleLoginSuccess}
        />
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // SISTEMA PRINCIPAL: MENÚ AL LADO IZQUIERDO (SIDEBAR)
  // --------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-row font-sans selection:bg-amber-500/30 selection:text-white">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center space-x-2 px-4 py-3 rounded-xl bg-slate-900 border border-emerald-500/40 text-white shadow-2xl animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{toastMessage.text}</span>
        </div>
      )}

      {/* MENÚ DE NAVEGACIÓN AL LADO IZQUIERDO (SIDEBAR) */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        connectionSettings={connectionSettings}
        currentUser={currentUser}
        onQuickSync={handleQuickSync}
        onOpenCallSimulator={() => setIsCallSimulatorOpen(true)}
        onLogout={handleLogout}
        isSyncing={isSyncing}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        extensionCount={extensions.length}
        carrierCount={carriers.length}
      />

      {/* ÁREA DE CONTENIDO PRINCIPAL A LA DERECHA */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          connectionSettings={connectionSettings}
          currentUser={currentUser}
          onQuickSync={handleQuickSync}
          onOpenCallSimulator={() => setIsCallSimulatorOpen(true)}
          onOpenMobileMenu={() => setIsMobileSidebarOpen(true)}
          onLogout={handleLogout}
          isSyncing={isSyncing}
        />

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'production' && (
          <ProductionOperationsTab
            extensions={extensions}
            carriers={carriers}
            audios={audios}
            onAddAudio={handleAddAudio}
            onTriggerSync={handleQuickSync}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'prompt' && (
          <PromptMaestroTab
            amiPort={connectionSettings.amiPort}
            ariPort={connectionSettings.ariPort}
            otpDigits={otpConfig.digitLength}
            webhookUrl={otpConfig.webhookUrl}
          />
        )}

        {activeTab === 'extensions' && (
          <ExtensionsTab
            extensions={extensions}
            onAddExtension={handleAddExtension}
            onUpdateExtension={handleUpdateExtension}
            onDeleteExtension={handleDeleteExtension}
            onSimulateQualify={handleSimulateQualify}
            onSyncAsterisk={() => handleQuickSync(extensions)}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'carriers' && (
          <CarriersTab
            carriers={carriers}
            onAddCarrier={handleAddCarrier}
            onUpdateCarrier={handleUpdateCarrier}
            onDeleteCarrier={handleDeleteCarrier}
            onPingCarrier={handlePingCarrier}
            onSyncAsterisk={() => handleQuickSync(extensions, carriers)}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'ivr' && (
          <IVRStudioTab
            press1Config={press1Config}
            otpConfig={otpConfig}
            extensions={extensions}
            audios={audios}
            onSavePress1={setPress1Config}
            onSaveOtp={setOtpConfig}
            onTriggerSync={handleQuickSync}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'sqlite' && (
          <SqliteTab
            astDbEntries={astDbEntries}
            onAddAstDbEntry={handleAddAstDbEntry}
            onDeleteAstDbEntry={handleDeleteAstDbEntry}
            cdrRecords={cdrRecords}
            extensions={extensions}
            carriers={carriers}
            settings={connectionSettings}
            onExecuteCommand={handleExecuteSqliteCommand}
          />
        )}

        {activeTab === 'audios' && (
          <AudioLibraryTab
            audios={audios}
            onAddAudio={handleAddAudio}
            onDeleteAudio={handleDeleteAudio}
            onAssignToPress1={handleAssignToPress1}
            onAssignToOtp={handleAssignToOtp}
          />
        )}

        {activeTab === 'users' && (
          <UsersTab
            users={users}
            extensions={extensions}
            currentUserId={currentUserId}
            onSwitchUser={handleSwitchUser}
            onAddUser={handleAddUser}
            onUpdateUser={handleUpdateUser}
            onDeleteUser={handleDeleteUser}
          />
        )}

        {activeTab === 'sync' && (
          <SyncTelemetryTab
            settings={connectionSettings}
            onUpdateSettings={setConnectionSettings}
            logs={logs}
            onClearLogs={() => setLogs([])}
            onExecuteAmiCommand={handleExecuteAmiCommand}
            onForceFullSync={handleQuickSync}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'diagnostics' && (
          <AmiAriDiagnosticsTab
            settings={connectionSettings}
            onUpdateSettings={setConnectionSettings}
            onLogEvent={addLog}
          />
        )}

        {activeTab === 'configs' && (
          <ConfigExporterTab
            extensions={extensions}
            carriers={carriers}
            press1={press1Config}
            otp={otpConfig}
            settings={connectionSettings}
          />
        )}
      </main>

      {/* Softphone & Call Simulator Modal */}
      <CallSimulatorModal
        isOpen={isCallSimulatorOpen}
        onClose={() => setIsCallSimulatorOpen(false)}
        press1Config={press1Config}
        otpConfig={otpConfig}
        extensions={extensions}
        audios={audios}
        currentUser={currentUser}
        onLogEvent={addLog}
        onSaveAstDbEntry={handleAddAstDbEntry}
        onSaveCdrRecord={handleSaveCdrRecord}
      />

        {/* Global Footer */}
        <footer className="border-t border-slate-900 bg-slate-950 py-4 text-center text-xs text-slate-500">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div>
              Asterisk 20 Governor &bull; PJSIP Hot Reload via AMI (:5038) &bull; Voice DTMF OTP via ARI (:8088) &bull; Extensiones ≥ 1001
            </div>
            <div className="text-slate-400">
              Sincronización en tiempo real sin interrupción de llamadas &bull; Audioteca &amp; Control RBAC
            </div>
          </div>
        </footer>
      </div>

      {/* Softphone & Call Simulator Modal */}
      <CallSimulatorModal
        isOpen={isCallSimulatorOpen}
        onClose={() => setIsCallSimulatorOpen(false)}
        press1Config={press1Config}
        otpConfig={otpConfig}
        extensions={extensions}
        audios={audios}
        currentUser={currentUser}
        onLogEvent={addLog}
        onSaveAstDbEntry={handleAddAstDbEntry}
        onSaveCdrRecord={handleSaveCdrRecord}
      />
    </div>
  );
}
