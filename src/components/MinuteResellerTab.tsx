import React, { useState, useEffect } from 'react';
import {
  ResellerClient,
  MinutePackage,
  RechargeRecord,
  ResellerRate,
  ResellerCdr,
  PjsipExtension,
  CarrierTrunk,
} from '../types';
import {
  DollarSign,
  Users,
  Clock,
  TrendingUp,
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Download,
  Copy,
  Check,
  CreditCard,
  Zap,
  Globe,
  Settings,
  HelpCircle,
  PhoneCall,
  Shield,
  Trash2,
  Edit2,
  RefreshCw,
  ExternalLink,
  Receipt,
  Ticket,
  ChevronRight,
  Sliders,
  Percent,
} from 'lucide-react';

interface MinuteResellerTabProps {
  extensions: PjsipExtension[];
  carriers: CarrierTrunk[];
  onAddExtension?: (ext: PjsipExtension) => void;
  onUpdateExtension?: (ext: PjsipExtension) => void;
  onTriggerSync?: () => void;
}

// Initial mock clients for reseller billing
const defaultClients: ResellerClient[] = [
  {
    id: 'res-cli-1',
    name: 'Call Center Santiago VIP',
    company: 'Santiago Inversiones SRL',
    sipUsername: 'santiago_vip',
    sipPassword: 'VipSantiago#2026@Pass',
    currency: 'USD',
    balance: 85.50,
    allocatedMinutes: 4750,
    usedMinutes: 1250,
    costPerMinute: 0.018,
    planType: 'prepago',
    status: 'active',
    creditLimit: 0,
    cutoffOnZero: true,
    contactPhone: '+18295551234',
    contactEmail: 'gerencia@santiagovip.com',
    notes: 'Cliente mayorista 5 puestos MicroSIP activos',
    createdAt: '2026-09-15',
    lastRechargeDate: '2026-10-05',
    totalRecharges: 4,
  },
  {
    id: 'res-cli-2',
    name: 'Juan Perez Agente Independiente',
    company: 'Ventas Seguros Juan',
    sipUsername: 'juan_perez',
    sipPassword: 'JuanPerez#Secr3t2026',
    currency: 'USD',
    balance: 14.20,
    allocatedMinutes: 710,
    usedMinutes: 290,
    costPerMinute: 0.020,
    planType: 'prepago',
    status: 'active',
    creditLimit: 0,
    cutoffOnZero: true,
    contactPhone: '+18494386040',
    contactEmail: 'juan.perez@gmail.com',
    notes: 'Registrado por nombre en MicroSIP Windows',
    createdAt: '2026-09-28',
    lastRechargeDate: '2026-10-06',
    totalRecharges: 2,
  },
  {
    id: 'res-cli-3',
    name: 'Caribe Cobranzas Group',
    company: 'Caribe Recovery LLC',
    sipUsername: 'caribe_cobranzas',
    sipPassword: 'Caribe#Recovery2026!',
    currency: 'USD',
    balance: 2.10,
    allocatedMinutes: 105,
    usedMinutes: 1895,
    costPerMinute: 0.020,
    planType: 'prepago',
    status: 'low_balance',
    creditLimit: 5.0,
    cutoffOnZero: true,
    contactPhone: '+18095557788',
    contactEmail: 'ops@cariberecovery.com',
    notes: 'Alerta de saldo bajo enviada hoy',
    createdAt: '2026-10-01',
    lastRechargeDate: '2026-10-01',
    totalRecharges: 1,
  },
  {
    id: 'res-cli-4',
    name: 'Agente Carlos Morales',
    company: 'Finanzas Personales',
    sipUsername: 'carlos_morales',
    sipPassword: 'CarlosM#Pass9921',
    currency: 'USD',
    balance: 0.00,
    allocatedMinutes: 0,
    usedMinutes: 500,
    costPerMinute: 0.022,
    planType: 'prepago',
    status: 'suspended',
    creditLimit: 0,
    cutoffOnZero: true,
    contactPhone: '+18092223344',
    createdAt: '2026-09-10',
    lastRechargeDate: '2026-09-20',
    totalRecharges: 1,
  },
];

const defaultPackages: MinutePackage[] = [
  {
    id: 'pkg-500',
    name: 'Pack Básico 500 Minutos',
    minutes: 500,
    price: 10.0,
    currency: 'USD',
    description: 'Ideal para agentes individuales o pruebas directas en MicroSIP ($0.020/min).',
    destination: 'USA / Canadá / RD Móvil',
  },
  {
    id: 'pkg-1000',
    name: 'Pack Profesional 1,000 Minutos',
    minutes: 1000,
    price: 18.0,
    currency: 'USD',
    description: 'Tarifa preferencial de $0.018/min con calidad de voz premium HD.',
    destination: 'USA / Canadá / RD (+1809, +1829, +1849)',
    popular: true,
  },
  {
    id: 'pkg-3000',
    name: 'Pack Call Center 3,000 Minutos',
    minutes: 3000,
    price: 48.0,
    currency: 'USD',
    description: 'Diseñado para operaciones intensivas con múltiples softphones MicroSIP ($0.016/min).',
    destination: 'USA / Canadá / RD / Colombia / México',
  },
  {
    id: 'pkg-5000',
    name: 'Pack Mayorista 5,000 Minutos',
    minutes: 5000,
    price: 75.0,
    currency: 'USD',
    description: 'La tarifa más competitiva para revendedores a solo $0.015/min.',
    destination: 'Mundial / USA & Canadá / Caribe',
  },
];

const defaultRates: ResellerRate[] = [
  {
    id: 'rate-usa',
    prefix: '1',
    destination: 'Estados Unidos & Canadá (+1)',
    wholesaleCost: 0.006, // Costo que cobra el Carrier
    retailPrice: 0.016,   // Precio al que revendes
    marginPercent: 166.7, // % de ganancia
    billingIncrement: 60,
    status: 'active',
  },
  {
    id: 'rate-rd-movil',
    prefix: '1809 / 1829 / 1849',
    destination: 'República Dominicana (Móvil Altice/Claro)',
    wholesaleCost: 0.018,
    retailPrice: 0.038,
    marginPercent: 111.1,
    billingIncrement: 60,
    status: 'active',
  },
  {
    id: 'rate-rd-fijo',
    prefix: '1809 / 1829 / 1849',
    destination: 'República Dominicana (Fijo Residencial)',
    wholesaleCost: 0.010,
    retailPrice: 0.024,
    marginPercent: 140.0,
    billingIncrement: 60,
    status: 'active',
  },
  {
    id: 'rate-colombia',
    prefix: '57',
    destination: 'Colombia (Fijo y Celular)',
    wholesaleCost: 0.012,
    retailPrice: 0.028,
    marginPercent: 133.3,
    billingIncrement: 60,
    status: 'active',
  },
  {
    id: 'rate-mexico',
    prefix: '52',
    destination: 'México (Móvil / Fijo)',
    wholesaleCost: 0.009,
    retailPrice: 0.022,
    marginPercent: 144.4,
    billingIncrement: 60,
    status: 'active',
  },
  {
    id: 'rate-espana',
    prefix: '34',
    destination: 'España (Móvil / Fijo)',
    wholesaleCost: 0.011,
    retailPrice: 0.025,
    marginPercent: 127.3,
    billingIncrement: 60,
    status: 'active',
  },
];

const defaultRecharges: RechargeRecord[] = [
  {
    id: 'rec-101',
    clientId: 'res-cli-1',
    clientName: 'Call Center Santiago VIP',
    sipUsername: 'santiago_vip',
    amount: 50.0,
    currency: 'USD',
    minutesAdded: 2777,
    paymentMethod: 'zelle',
    reference: 'ZEL-8941203',
    timestamp: '2026-10-05 14:32:10',
    notes: 'Recarga Zelle acreditada inmediatamente',
    invoiceNumber: 'INV-2026-0042',
  },
  {
    id: 'rec-102',
    clientId: 'res-cli-2',
    clientName: 'Juan Perez Agente Independiente',
    sipUsername: 'juan_perez',
    amount: 18.0,
    currency: 'USD',
    minutesAdded: 1000,
    paymentMethod: 'usdt_crypto',
    reference: 'TRC20-0x92f...a1e4',
    timestamp: '2026-10-06 18:20:00',
    notes: 'Pack 1,000 minutos USDT',
    invoiceNumber: 'INV-2026-0043',
  },
  {
    id: 'rec-103',
    clientId: 'res-cli-3',
    clientName: 'Caribe Cobranzas Group',
    sipUsername: 'caribe_cobranzas',
    amount: 40.0,
    currency: 'USD',
    minutesAdded: 2000,
    paymentMethod: 'bank_transfer',
    reference: 'TRF-BANRESER-4910',
    timestamp: '2026-10-01 10:15:33',
    notes: 'Transferencia bancaria local',
    invoiceNumber: 'INV-2026-0041',
  },
];

const defaultCdrs: ResellerCdr[] = [
  {
    id: 'cdr-1',
    clientId: 'res-cli-2',
    clientName: 'Juan Perez',
    sipUsername: 'juan_perez',
    destinationNumber: '+18494386040',
    durationSec: 215,
    billableMinutes: 4,
    costDeducted: 0.08,
    rateApplied: 0.02,
    timestamp: '2026-10-08 11:42:15',
    carrierUsed: 'televox',
    disposition: 'ANSWERED',
  },
  {
    id: 'cdr-2',
    clientId: 'res-cli-1',
    clientName: 'Call Center Santiago VIP',
    sipUsername: 'santiago_vip',
    destinationNumber: '+13055550188',
    durationSec: 480,
    billableMinutes: 8,
    costDeducted: 0.144,
    rateApplied: 0.018,
    timestamp: '2026-10-08 11:30:02',
    carrierUsed: 'televox',
    disposition: 'ANSWERED',
  },
  {
    id: 'cdr-3',
    clientId: 'res-cli-1',
    clientName: 'Call Center Santiago VIP',
    sipUsername: 'santiago_vip',
    destinationNumber: '+12125550199',
    durationSec: 130,
    billableMinutes: 3,
    costDeducted: 0.054,
    rateApplied: 0.018,
    timestamp: '2026-10-08 11:15:40',
    carrierUsed: 'televox',
    disposition: 'ANSWERED',
  },
  {
    id: 'cdr-4',
    clientId: 'res-cli-3',
    clientName: 'Caribe Cobranzas Group',
    sipUsername: 'caribe_cobranzas',
    destinationNumber: '+18293334455',
    durationSec: 55,
    billableMinutes: 1,
    costDeducted: 0.02,
    rateApplied: 0.02,
    timestamp: '2026-10-08 10:50:11',
    carrierUsed: 'televox',
    disposition: 'ANSWERED',
  },
];

export const MinuteResellerTab: React.FC<MinuteResellerTabProps> = ({
  extensions,
  carriers,
  onAddExtension,
  onUpdateExtension,
  onTriggerSync,
}) => {
  // Navigation tabs
  const [activeSubTab, setActiveSubTab] = useState<'clients' | 'rates' | 'packages' | 'recharges' | 'cdrs' | 'microsip-guide'>('clients');

  // State loaded from localStorage or defaults
  const [clients, setClients] = useState<ResellerClient[]>(() => {
    try {
      const saved = localStorage.getItem('ast20_reseller_clients');
      return saved ? JSON.parse(saved) : defaultClients;
    } catch (_) {
      return defaultClients;
    }
  });

  const [packages, setPackages] = useState<MinutePackage[]>(() => {
    try {
      const saved = localStorage.getItem('ast20_reseller_packages');
      return saved ? JSON.parse(saved) : defaultPackages;
    } catch (_) {
      return defaultPackages;
    }
  });

  const [rates, setRates] = useState<ResellerRate[]>(() => {
    try {
      const saved = localStorage.getItem('ast20_reseller_rates');
      return saved ? JSON.parse(saved) : defaultRates;
    } catch (_) {
      return defaultRates;
    }
  });

  const [recharges, setRecharges] = useState<RechargeRecord[]>(() => {
    try {
      const saved = localStorage.getItem('ast20_reseller_recharges');
      return saved ? JSON.parse(saved) : defaultRecharges;
    } catch (_) {
      return defaultRecharges;
    }
  });

  const [cdrs] = useState<ResellerCdr[]>(defaultCdrs);

  // Search & Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'low_balance' | 'suspended'>('all');

  // Modals
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ResellerClient | null>(null);
  const [isRechargeModalOpen, setIsRechargeModalOpen] = useState(false);
  const [selectedClientForRecharge, setSelectedClientForRecharge] = useState<ResellerClient | null>(null);
  const [microSipModalClient, setMicroSipModalClient] = useState<ResellerClient | null>(null);
  const [receiptModalRecord, setReceiptModalRecord] = useState<RechargeRecord | null>(null);

  // Client form states
  const [formName, setFormName] = useState('');
  const [formCompany, setFormCompany] = useState('');
  const [formSipUsername, setFormSipUsername] = useState('');
  const [formSipPassword, setFormSipPassword] = useState('');
  const [formCostPerMin, setFormCostPerMin] = useState(0.018);
  const [formInitialBalance, setFormInitialBalance] = useState(15.0);
  const [formCutoffOnZero, setFormCutoffOnZero] = useState(true);
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [clientFormError, setClientFormError] = useState<string | null>(null);

  // Recharge form states
  const [rechargeAmount, setRechargeAmount] = useState(20.0);
  const [rechargeMethod, setRechargeMethod] = useState<RechargeRecord['paymentMethod']>('zelle');
  const [rechargeReference, setRechargeReference] = useState('');
  const [rechargeNotes, setRechargeNotes] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);

  // Synchronize with server / localStorage
  const saveClients = (newClients: ResellerClient[]) => {
    setClients(newClients);
    try {
      localStorage.setItem('ast20_reseller_clients', JSON.stringify(newClients));
    } catch (_) {}
  };

  const saveRecharges = (newRecs: RechargeRecord[]) => {
    setRecharges(newRecs);
    try {
      localStorage.setItem('ast20_reseller_recharges', JSON.stringify(newRecs));
    } catch (_) {}
  };

  const showToast = (msg: string) => {
    setFeedbackToast(msg);
    setTimeout(() => setFeedbackToast(null), 3500);
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  // Generate .ini file for MicroSIP 1-click import
  const handleDownloadMicroSipIni = (client: ResellerClient) => {
    const host = window.location.hostname || 'TU_IP_VPS';
    const port = 47923; // Active PJSIP port
    const iniContent = `[Settings]
autoAnswer=0
denyIncoming=0
directory=
disableLocalRing=0
enableLocalDTMF=1
enableLog=0
enableSTUN=0
forceCodec=
hideCallerId=0
localPort=0
ringtone=
server=${host}:${port}
singleMode=0
volumeIn=100
volumeOut=100

[Account1]
accountName=${client.name}
server=${host}:${port}
proxy=
user=${client.sipUsername}
domain=${host}:${port}
login=${client.sipUsername}
password=${client.sipPassword}
displayName=${client.name}
authID=${client.sipUsername}
transport=UDP
mediaEncryption=
publish=0
regInterval=300
`;
    const blob = new Blob([iniContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `microsip_${client.sipUsername}.ini`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Archivo microsip_${client.sipUsername}.ini descargado con éxito.`);
  };

  // Open Create Client modal
  const handleOpenCreateClient = () => {
    setEditingClient(null);
    setFormName('');
    setFormCompany('');
    setFormSipUsername('');
    // Generate secure password
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
    let pass = 'P@ss';
    for (let i = 0; i < 8; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
    setFormSipPassword(pass);
    setFormCostPerMin(0.018);
    setFormInitialBalance(18.0);
    setFormCutoffOnZero(true);
    setFormPhone('');
    setFormEmail('');
    setFormNotes('');
    setClientFormError(null);
    setIsClientModalOpen(true);
  };

  // Open Edit Client modal
  const handleOpenEditClient = (cli: ResellerClient) => {
    setEditingClient(cli);
    setFormName(cli.name);
    setFormCompany(cli.company || '');
    setFormSipUsername(cli.sipUsername);
    setFormSipPassword(cli.sipPassword);
    setFormCostPerMin(cli.costPerMinute);
    setFormInitialBalance(cli.balance);
    setFormCutoffOnZero(cli.cutoffOnZero);
    setFormPhone(cli.contactPhone || '');
    setFormEmail(cli.contactEmail || '');
    setFormNotes(cli.notes || '');
    setClientFormError(null);
    setIsClientModalOpen(true);
  };

  // Save client and automatically register as PJSIP extension in Asterisk
  const handleSaveClient = (e: React.FormEvent) => {
    e.preventDefault();
    setClientFormError(null);

    const cleanUsername = formSipUsername.trim().toLowerCase();
    if (!cleanUsername) {
      setClientFormError('El nombre de usuario SIP para MicroSIP es obligatorio.');
      return;
    }

    // Validate alphanumeric format for MicroSIP name
    if (!/^[a-zA-Z][a-zA-Z0-9_\-]{1,31}$/.test(cleanUsername)) {
      setClientFormError('El nombre de usuario SIP debe comenzar con una letra y contener solo letras, números, guiones y guión bajo (ejemplo: "juan_perez", "agente_carlos").');
      return;
    }

    // Check duplicate username
    const exists = clients.find(
      (c) => c.sipUsername.toLowerCase() === cleanUsername && (!editingClient || c.id !== editingClient.id)
    );
    if (exists) {
      setClientFormError(`El nombre de usuario "${cleanUsername}" ya está en uso por "${exists.name}".`);
      return;
    }

    const calculatedMinutes = Math.floor(formInitialBalance / (formCostPerMin || 0.018));

    if (editingClient) {
      const updatedClients = clients.map((c) => {
        if (c.id === editingClient.id) {
          return {
            ...c,
            name: formName || cleanUsername,
            company: formCompany,
            sipUsername: cleanUsername,
            sipPassword: formSipPassword,
            costPerMinute: formCostPerMin,
            cutoffOnZero: formCutoffOnZero,
            contactPhone: formPhone,
            contactEmail: formEmail,
            notes: formNotes,
          };
        }
        return c;
      });
      saveClients(updatedClients);

      // Update PJSIP extension in memory if present
      if (onUpdateExtension) {
        const existingExt = extensions.find((ex) => ex.extension.toLowerCase() === editingClient.sipUsername.toLowerCase());
        if (existingExt) {
          onUpdateExtension({
            ...existingExt,
            extension: cleanUsername,
            name: formName || cleanUsername,
            secret: formSipPassword,
          });
        }
      }
      showToast(`Cliente "${formName}" actualizado.`);
    } else {
      const newClient: ResellerClient = {
        id: `cli-${cleanUsername}-${Date.now()}`,
        name: formName || cleanUsername,
        company: formCompany,
        sipUsername: cleanUsername,
        sipPassword: formSipPassword,
        currency: 'USD',
        balance: formInitialBalance,
        allocatedMinutes: calculatedMinutes,
        usedMinutes: 0,
        costPerMinute: formCostPerMin,
        planType: 'prepago',
        status: formInitialBalance > 2 ? 'active' : 'low_balance',
        creditLimit: 0,
        cutoffOnZero: formCutoffOnZero,
        contactPhone: formPhone,
        contactEmail: formEmail,
        notes: formNotes,
        createdAt: new Date().toISOString().split('T')[0],
        totalRecharges: 1,
      };

      const updated = [newClient, ...clients];
      saveClients(updated);

      // Record initial recharge if > 0
      if (formInitialBalance > 0) {
        const initialRec: RechargeRecord = {
          id: `rec-init-${Date.now()}`,
          clientId: newClient.id,
          clientName: newClient.name,
          sipUsername: cleanUsername,
          amount: formInitialBalance,
          currency: 'USD',
          minutesAdded: calculatedMinutes,
          paymentMethod: 'cash',
          reference: 'SALDO-INICIAL',
          timestamp: new Date().toLocaleString(),
          notes: 'Carga inicial de apertura de cuenta',
          invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
        };
        saveRecharges([initialRec, ...recharges]);
      }

      // Automatically register new named PJSIP extension in Asterisk
      if (onAddExtension) {
        const existingExt = extensions.find((ex) => ex.extension.toLowerCase() === cleanUsername);
        if (!existingExt) {
          onAddExtension({
            id: `ext-${cleanUsername}-${Date.now()}`,
            extension: cleanUsername,
            name: formName || cleanUsername,
            secret: formSipPassword,
            context: 'from-internal',
            transport: 'transport-udp',
            port: 47923,
            maxContacts: 5,
            codecs: ['ulaw', 'alaw', 'g729', 'opus'],
            callerId: `"${formName || cleanUsername}" <+18005550199>`,
            callerIdNum: '+18005550199',
            callerIdName: formName || cleanUsername,
            status: 'registered',
            lastSeen: 'Creada para MicroSIP (Reventa de Minutos)',
          });
        }
      }

      showToast(`¡Cliente "${cleanUsername}" creado y extensión PJSIP registrada en Asterisk!`);
    }

    setIsClientModalOpen(false);
    if (onTriggerSync) onTriggerSync();
  };

  // Delete client
  const handleDeleteClient = (id: string) => {
    const cli = clients.find((c) => c.id === id);
    if (!cli) return;
    if (confirm(`¿Estás seguro de eliminar el cliente "${cli.name}" (${cli.sipUsername})?`)) {
      const updated = clients.filter((c) => c.id !== id);
      saveClients(updated);
      showToast(`Cliente "${cli.name}" eliminado.`);
    }
  };

  // Execute recharge for a client
  const handleExecuteRecharge = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientForRecharge) return;

    const amount = parseFloat(String(rechargeAmount)) || 0;
    if (amount <= 0) return;

    const minutesToAdd = Math.floor(amount / (selectedClientForRecharge.costPerMinute || 0.018));
    const invNumber = `INV-${Date.now().toString().slice(-6)}`;

    // Update client balance & minutes
    const updatedClients = clients.map((c) => {
      if (c.id === selectedClientForRecharge.id) {
        const newBalance = c.balance + amount;
        return {
          ...c,
          balance: Number(newBalance.toFixed(2)),
          allocatedMinutes: c.allocatedMinutes + minutesToAdd,
          status: (newBalance > 2 ? 'active' : 'low_balance') as ResellerClient['status'],
          lastRechargeDate: new Date().toISOString().split('T')[0],
          totalRecharges: c.totalRecharges + 1,
        };
      }
      return c;
    });
    saveClients(updatedClients);

    // Create record
    const newRecord: RechargeRecord = {
      id: `rec-${Date.now()}`,
      clientId: selectedClientForRecharge.id,
      clientName: selectedClientForRecharge.name,
      sipUsername: selectedClientForRecharge.sipUsername,
      amount,
      currency: 'USD',
      minutesAdded: minutesToAdd,
      paymentMethod: rechargeMethod,
      reference: rechargeReference || `REC-${Date.now().toString().slice(-6)}`,
      timestamp: new Date().toLocaleString(),
      notes: rechargeNotes,
      invoiceNumber: invNumber,
    };
    saveRecharges([newRecord, ...recharges]);

    setIsRechargeModalOpen(false);
    setReceiptModalRecord(newRecord);
    showToast(`¡Recarga de $${amount} USD (${minutesToAdd} min) acreditada a ${selectedClientForRecharge.name}!`);
  };

  // Quick apply package to recharge modal
  const handleSelectPackageForRecharge = (pkg: MinutePackage) => {
    setRechargeAmount(pkg.price);
    setRechargeNotes(`Paquete seleccionado: ${pkg.name} (${pkg.minutes} min)`);
  };

  // Filter clients
  const filteredClients = clients.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.sipUsername.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.company && c.company.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Calculate totals
  const totalBalance = clients.reduce((acc, c) => acc + c.balance, 0);
  const totalAvailableMinutes = clients.reduce((acc, c) => acc + c.allocatedMinutes, 0);
  const totalUsedMinutes = clients.reduce((acc, c) => acc + c.usedMinutes, 0);
  const totalRechargeIncome = recharges.reduce((acc, r) => acc + r.amount, 0);

  // Profit estimation (Wholesale avg $0.007 vs Retail avg $0.018 = ~$0.011 net margin per minute)
  const estimatedProfit = totalUsedMinutes * 0.011;

  return (
    <div className="space-y-6 text-slate-100">
      {/* Toast Feedback */}
      {feedbackToast && (
        <div className="fixed top-5 right-5 z-50 bg-emerald-500 text-slate-950 font-bold px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs animate-bounce">
          <CheckCircle2 className="w-4 h-4" />
          <span>{feedbackToast}</span>
        </div>
      )}

      {/* Header and Reseller Branding */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
              <DollarSign className="w-6 h-6 text-emerald-400" />
              <span>Módulo de Reventa de Minutos VoIP & Facturación</span>
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              MicroSIP por Nombre
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-sky-500/20 text-sky-300 border border-sky-500/30">
              Prepago / Saldo en Vivo
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Vende saldo y paquetes de minutos a clientes externos. Registra a tus usuarios en MicroSIP usando su <b className="text-emerald-300 font-mono">Nombre de Usuario</b> (ej: <code>juan_perez</code>) en lugar de una extensión numérica, con corte automático al agotar saldo.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setActiveSubTab('microsip-guide')}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/30 flex items-center gap-2 shadow-sm transition-all"
          >
            <HelpCircle className="w-4 h-4 text-sky-400" />
            <span>Guía MicroSIP por Nombre</span>
          </button>

          <button
            onClick={handleOpenCreateClient}
            className="px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo Cliente / Cuenta SIP</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-lg space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Saldo Total Clientes</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-white font-mono">
            ${totalBalance.toFixed(2)} <span className="text-xs text-slate-500 font-sans">USD</span>
          </div>
          <p className="text-[10px] text-slate-400">
            {clients.length} cuentas activas en el sistema
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-lg space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Minutos Disponibles</span>
            <Clock className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-black text-sky-400 font-mono">
            {totalAvailableMinutes.toLocaleString()} <span className="text-xs text-slate-500 font-sans">min</span>
          </div>
          <p className="text-[10px] text-slate-400">
            {totalUsedMinutes.toLocaleString()} minutos hablados acumulados
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-lg space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Recaudado en Recargas</span>
            <Receipt className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-black text-purple-300 font-mono">
            ${totalRechargeIncome.toFixed(2)} <span className="text-xs text-slate-500 font-sans">USD</span>
          </div>
          <p className="text-[10px] text-slate-400">
            {recharges.length} transacciones registradas
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-lg space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Ganancia Neta Estimada</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400 font-mono">
            +${estimatedProfit.toFixed(2)} <span className="text-xs text-slate-500 font-sans">USD</span>
          </div>
          <p className="text-[10px] text-emerald-400/80">
            Margen promedio: ~140% sobre Carrier
          </p>
        </div>
      </div>

      {/* Sub-tabs Navigation */}
      <div className="flex items-center gap-1.5 border-b border-slate-800 overflow-x-auto pb-1 text-xs">
        <button
          onClick={() => setActiveSubTab('clients')}
          className={`px-3.5 py-2 rounded-t-xl font-bold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
            activeSubTab === 'clients'
              ? 'border-emerald-500 text-emerald-400 bg-slate-900/80'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Clientes & Cuentas MicroSIP ({clients.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('rates')}
          className={`px-3.5 py-2 rounded-t-xl font-bold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
            activeSubTab === 'rates'
              ? 'border-emerald-500 text-emerald-400 bg-slate-900/80'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Tarifario & Márgenes ({rates.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('packages')}
          className={`px-3.5 py-2 rounded-t-xl font-bold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
            activeSubTab === 'packages'
              ? 'border-emerald-500 text-emerald-400 bg-slate-900/80'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Ticket className="w-3.5 h-3.5" />
          <span>Paquetes de Minutos ({packages.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('recharges')}
          className={`px-3.5 py-2 rounded-t-xl font-bold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
            activeSubTab === 'recharges'
              ? 'border-emerald-500 text-emerald-400 bg-slate-900/80'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Receipt className="w-3.5 h-3.5" />
          <span>Historial de Recargas ({recharges.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('cdrs')}
          className={`px-3.5 py-2 rounded-t-xl font-bold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
            activeSubTab === 'cdrs'
              ? 'border-emerald-500 text-emerald-400 bg-slate-900/80'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Consumo en Tiempo Real (CDR)</span>
        </button>

        <button
          onClick={() => setActiveSubTab('microsip-guide')}
          className={`px-3.5 py-2 rounded-t-xl font-bold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
            activeSubTab === 'microsip-guide'
              ? 'border-sky-500 text-sky-400 bg-slate-900/80'
              : 'border-transparent text-sky-300 hover:text-white'
          }`}
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>Guía Paso a Paso MicroSIP</span>
        </button>
      </div>

      {/* SUB-TAB 1: CLIENTS & MICRO-SIP ACCOUNTS */}
      {activeSubTab === 'clients' && (
        <div className="space-y-4">
          {/* Controls Bar: Search & Status Filters */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900 p-3 rounded-2xl border border-slate-800 text-xs">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nombre, empresa o usuario SIP..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono text-xs"
              />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
              <span className="text-slate-400 font-semibold mr-1">Filtrar:</span>
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                  statusFilter === 'all'
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-950 text-slate-400 hover:bg-slate-800'
                }`}
              >
                Todos ({clients.length})
              </button>
              <button
                onClick={() => setStatusFilter('active')}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                  statusFilter === 'active'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-slate-950 text-emerald-400 hover:bg-slate-800'
                }`}
              >
                Activos ({clients.filter((c) => c.status === 'active').length})
              </button>
              <button
                onClick={() => setStatusFilter('low_balance')}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                  statusFilter === 'low_balance'
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-950 text-amber-400 hover:bg-slate-800'
                }`}
              >
                Bajo Saldo ({clients.filter((c) => c.status === 'low_balance').length})
              </button>
              <button
                onClick={() => setStatusFilter('suspended')}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                  statusFilter === 'suspended'
                    ? 'bg-rose-500 text-white'
                    : 'bg-slate-950 text-rose-400 hover:bg-slate-800'
                }`}
              >
                Sin Saldo ({clients.filter((c) => c.status === 'suspended').length})
              </button>
            </div>
          </div>

          {/* Clients Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredClients.map((client) => {
              const isLow = client.balance < 3 && client.balance > 0;
              const isZero = client.balance <= 0;

              return (
                <div
                  key={client.id}
                  className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 shadow-xl space-y-4 transition-all"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-black text-white text-base">{client.name}</h3>
                        {client.status === 'active' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Activo
                          </span>
                        )}
                        {client.status === 'low_balance' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
                            Saldo Bajo
                          </span>
                        )}
                        {client.status === 'suspended' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            Suspendido (0 Saldo)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 font-medium">
                        {client.company || 'Cliente Individual VoIP'}
                      </p>
                    </div>

                    <div className="text-right">
                      <div className="text-xl font-black font-mono text-white">
                        ${client.balance.toFixed(2)}
                      </div>
                      <div className="text-[11px] font-mono text-sky-400 font-bold">
                        {client.allocatedMinutes.toLocaleString()} min disp.
                      </div>
                    </div>
                  </div>

                  {/* MicroSIP Account Credentials Banner */}
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-semibold flex items-center gap-1.5">
                        <PhoneCall className="w-3.5 h-3.5 text-sky-400" />
                        <span>Usuario MicroSIP (Registrado por Nombre):</span>
                      </span>
                      <button
                        onClick={() => handleCopy(client.sipUsername, `copy-usr-${client.id}`)}
                        className="text-sky-300 hover:text-white flex items-center gap-1 text-[10px] font-mono"
                      >
                        {copiedKey === `copy-usr-${client.id}` ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>Copiar Usuario</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                        <span className="text-slate-500 text-[10px]">User/Login:</span>
                        <span className="text-emerald-400 font-bold truncate">{client.sipUsername}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                        <span className="text-slate-500 text-[10px]">Tarifa/Min:</span>
                        <span className="text-white font-bold">${client.costPerMinute.toFixed(3)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Usage Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Consumo de Minutos:</span>
                      <span className="font-mono">
                        {client.usedMinutes} consumidos / {client.allocatedMinutes + client.usedMinutes} totales
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isZero
                            ? 'bg-rose-500'
                            : isLow
                            ? 'bg-amber-400'
                            : 'bg-gradient-to-r from-emerald-500 to-teal-400'
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(
                              (client.allocatedMinutes /
                                (client.allocatedMinutes + client.usedMinutes || 1)) *
                                100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          setSelectedClientForRecharge(client);
                          setRechargeAmount(20.0);
                          setRechargeNotes('');
                          setRechargeReference('');
                          setIsRechargeModalOpen(true);
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center gap-1.5 shadow-md shadow-emerald-500/20 transition-all"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Recargar Saldo</span>
                      </button>

                      <button
                        onClick={() => setMicroSipModalClient(client)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 flex items-center gap-1.5 transition-all"
                        title="Ver credenciales y descargar configuración lista de MicroSIP"
                      >
                        <PhoneCall className="w-3.5 h-3.5 text-sky-400" />
                        <span>Config MicroSIP</span>
                      </button>

                      <button
                        onClick={() => handleDownloadMicroSipIni(client)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1"
                        title="Descargar archivo microsip.ini ya configurado"
                      >
                        <Download className="w-3.5 h-3.5 text-slate-400" />
                        <span>.ini</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenEditClient(client)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        title="Editar cliente"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteClient(client.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                        title="Eliminar cuenta"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredClients.length === 0 && (
            <div className="p-12 text-center rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <Users className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="font-bold text-white text-base">No se encontraron clientes</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                No hay cuentas que coincidan con la búsqueda o filtro aplicado. Crea una nueva cuenta con su nombre de usuario para MicroSIP.
              </p>
              <button
                onClick={handleOpenCreateClient}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 text-slate-950 inline-flex items-center gap-1.5 shadow-lg shadow-emerald-500/20"
              >
                <Plus className="w-4 h-4" />
                <span>Crear Primer Cliente</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: RATES & MARGINS (WHOLESALE VS RETAIL) */}
      {activeSubTab === 'rates' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Sliders className="w-5 h-5 text-emerald-400" />
                <span>Tarifario por Destino & Cálculo de Márgenes</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Compara el costo mayorista que pagas a tu Carrier (ej. Televox) versus el precio al que vendes el minuto a tus clientes.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-mono text-xs font-bold">
                Margen Promedio: +138.8%
              </span>
            </div>
          </div>

          {/* Rates Table */}
          <div className="overflow-x-auto rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3">Destino / País</th>
                  <th className="px-4 py-3">Prefijo</th>
                  <th className="px-4 py-3">Costo Carrier ($/min)</th>
                  <th className="px-4 py-3">Precio Venta ($/min)</th>
                  <th className="px-4 py-3">Ganancia Neta ($/min)</th>
                  <th className="px-4 py-3">Margen %</th>
                  <th className="px-4 py-3">Fracción</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {rates.map((rate) => {
                  const profitPerMin = rate.retailPrice - rate.wholesaleCost;
                  return (
                    <tr key={rate.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3 font-sans font-bold text-white flex items-center gap-2">
                        <Globe className="w-3.5 h-3.5 text-sky-400" />
                        <span>{rate.destination}</span>
                      </td>
                      <td className="px-4 py-3 text-sky-300">{rate.prefix}</td>
                      <td className="px-4 py-3 text-slate-400">${rate.wholesaleCost.toFixed(3)}</td>
                      <td className="px-4 py-3 text-emerald-400 font-bold">${rate.retailPrice.toFixed(3)}</td>
                      <td className="px-4 py-3 text-white font-bold">+${profitPerMin.toFixed(3)}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          +{rate.marginPercent.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{rate.billingIncrement}s</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-sans">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                          Activo
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: MINUTE PACKAGES & VOUCHERS */}
      {activeSubTab === 'packages' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Ticket className="w-5 h-5 text-emerald-400" />
                <span>Paquetes de Minutos Preconfigurados</span>
              </h3>
              <p className="text-xs text-slate-400">
                Ofrece paquetes comerciales listos para que tus clientes recarguen vía Zelle, USDT o Banco.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {packages.map((pkg) => {
              const pricePerMin = pkg.price / pkg.minutes;
              return (
                <div
                  key={pkg.id}
                  className={`p-5 rounded-2xl bg-slate-900 border transition-all flex flex-col justify-between ${
                    pkg.popular
                      ? 'border-emerald-500/50 shadow-xl shadow-emerald-500/10'
                      : 'border-slate-800'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-slate-400 uppercase tracking-wider font-mono">
                        {pkg.destination}
                      </span>
                      {pkg.popular && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500 text-slate-950">
                          Más Vendido
                        </span>
                      )}
                    </div>

                    <div>
                      <h4 className="font-black text-white text-lg">{pkg.name}</h4>
                      <div className="text-2xl font-black text-emerald-400 font-mono mt-1">
                        ${pkg.price.toFixed(2)} <span className="text-xs text-slate-400 font-sans">USD</span>
                      </div>
                      <div className="text-xs text-sky-400 font-mono font-bold mt-0.5">
                        {pkg.minutes.toLocaleString()} Minutos (${pricePerMin.toFixed(3)}/min)
                      </div>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">{pkg.description}</p>
                  </div>

                  <div className="pt-4 border-t border-slate-800/80 mt-4 space-y-2">
                    <button
                      onClick={() => {
                        handleSelectPackageForRecharge(pkg);
                        if (clients.length > 0) {
                          setSelectedClientForRecharge(clients[0]);
                          setIsRechargeModalOpen(true);
                        } else {
                          showToast('Crea un cliente primero para asignarle este paquete.');
                        }
                      }}
                      className="w-full py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20 transition-all"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>Asignar Paquete a Cliente</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SUB-TAB 4: RECHARGES HISTORY & RECEIPTS */}
      {activeSubTab === 'recharges' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Receipt className="w-5 h-5 text-purple-400" />
                <span>Historial de Depósitos & Recibos Emitidos</span>
              </h3>
              <p className="text-xs text-slate-400">
                Auditoría completa de fondos acreditados, comprobantes de pago y minutos sumados a cada cuenta.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3">Factura / Recibo</th>
                  <th className="px-4 py-3">Cliente / Cuenta</th>
                  <th className="px-4 py-3">Usuario SIP</th>
                  <th className="px-4 py-3">Monto Acreditado</th>
                  <th className="px-4 py-3">Minutos Sumados</th>
                  <th className="px-4 py-3">Método de Pago</th>
                  <th className="px-4 py-3">Referencia</th>
                  <th className="px-4 py-3">Fecha y Hora</th>
                  <th className="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {recharges.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3 font-bold text-white">{rec.invoiceNumber}</td>
                    <td className="px-4 py-3 font-sans text-slate-200">{rec.clientName}</td>
                    <td className="px-4 py-3 text-sky-400 font-bold">{rec.sipUsername}</td>
                    <td className="px-4 py-3 text-emerald-400 font-bold">
                      ${rec.amount.toFixed(2)} USD
                    </td>
                    <td className="px-4 py-3 text-white font-bold">
                      +{rec.minutesAdded.toLocaleString()} min
                    </td>
                    <td className="px-4 py-3 font-sans capitalize text-slate-300">
                      {rec.paymentMethod.replace('_', ' ')}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{rec.reference}</td>
                    <td className="px-4 py-3 text-slate-400">{rec.timestamp}</td>
                    <td className="px-4 py-3 text-right font-sans">
                      <button
                        onClick={() => setReceiptModalRecord(rec)}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 inline-flex items-center gap-1"
                      >
                        <Receipt className="w-3 h-3" />
                        <span>Ver Recibo</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 5: REAL-TIME CDR & CONSUMPTION */}
      {activeSubTab === 'cdrs' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-400" />
                <span>Registro Detallado de Llamadas por Cliente (CDR)</span>
              </h3>
              <p className="text-xs text-slate-400">
                Audita cada llamada realizada por tus cuentas MicroSIP, duración facturable y débito aplicado.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3">Fecha / Hora</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Usuario MicroSIP</th>
                  <th className="px-4 py-3">Número Destino</th>
                  <th className="px-4 py-3">Duración</th>
                  <th className="px-4 py-3">Minutos Cobrados</th>
                  <th className="px-4 py-3">Tarifa</th>
                  <th className="px-4 py-3">Débito ($)</th>
                  <th className="px-4 py-3">Carrier</th>
                  <th className="px-4 py-3">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {cdrs.map((cdr) => (
                  <tr key={cdr.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3 text-slate-400">{cdr.timestamp}</td>
                    <td className="px-4 py-3 font-sans font-bold text-white">{cdr.clientName}</td>
                    <td className="px-4 py-3 text-sky-400 font-bold">{cdr.sipUsername}</td>
                    <td className="px-4 py-3 text-emerald-400 font-bold">{cdr.destinationNumber}</td>
                    <td className="px-4 py-3 text-slate-300">{cdr.durationSec} seg</td>
                    <td className="px-4 py-3 text-white font-bold">{cdr.billableMinutes} min</td>
                    <td className="px-4 py-3 text-slate-400">${cdr.rateApplied.toFixed(3)}</td>
                    <td className="px-4 py-3 text-rose-400 font-bold">-${cdr.costDeducted.toFixed(3)}</td>
                    <td className="px-4 py-3 text-slate-400">{cdr.carrierUsed}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-sans">
                        {cdr.disposition}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 6: MICROSIP VISUAL GUIDE (STEP BY STEP) */}
      {activeSubTab === 'microsip-guide' && (
        <div className="space-y-6">
          <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <HelpCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">
                  ¿Cómo registrar a tus clientes en MicroSIP con Nombre en vez de Extensión?
                </h3>
                <p className="text-xs text-slate-400">
                  Respuesta técnica: En el protocolo SIP estándar y en Asterisk PJSIP, el identificador de usuario (SIP URI) es una cadena de texto alfanumérica. MicroSIP no exige números.
                </p>
              </div>
            </div>
          </div>

          {/* Graphic Simulator of MicroSIP Window */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Interactive Simulated MicroSIP Account Dialog */}
            <div className="p-6 rounded-2xl bg-slate-950 border-2 border-sky-500/40 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-rose-500"></div>
                  <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                  <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                  <span className="text-xs font-bold text-slate-300 ml-2 font-mono">
                    MicroSIP - Configuración de Cuenta
                  </span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono">
                  Ventana Oficial
                </span>
              </div>

              <div className="space-y-3 text-xs font-mono">
                <div className="space-y-1">
                  <label className="text-slate-400 text-[11px] font-sans font-bold flex items-center justify-between">
                    <span>Nombre de Cuenta (Account Name):</span>
                    <span className="text-slate-500 text-[10px]">Cualquier nombre descriptivo</span>
                  </label>
                  <div className="p-2 rounded bg-slate-900 border border-slate-700 text-white font-bold">
                    Juan Perez VoIP
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400 text-[11px] font-sans font-bold flex items-center justify-between">
                    <span>Servidor SIP (SIP Server):</span>
                    <span className="text-sky-300 text-[10px]">IP de tu VPS + Puerto 47923</span>
                  </label>
                  <div className="p-2 rounded bg-slate-900 border border-slate-700 text-sky-400 font-bold">
                    IP_DE_TU_VPS:47923
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400 text-[11px] font-sans font-bold flex items-center justify-between">
                    <span>SIP Proxy:</span>
                    <span className="text-slate-500 text-[10px]">Dejar vacío</span>
                  </label>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800 text-slate-600">
                    (vacío)
                  </div>
                </div>

                {/* THE MOST IMPORTANT FIELD HIGHLIGHTED */}
                <div className="p-3 rounded-xl bg-emerald-950/60 border-2 border-emerald-500 space-y-1">
                  <label className="text-emerald-300 text-[11px] font-sans font-black flex items-center justify-between">
                    <span>Usuario (User) - ¡AQUÍ VA EL NOMBRE!:</span>
                    <span className="bg-emerald-500 text-slate-950 text-[10px] px-1.5 py-0.2 rounded font-bold">
                      ¡NO UN NÚMERO!
                    </span>
                  </label>
                  <div className="p-2 rounded bg-slate-950 border border-emerald-500/50 text-emerald-300 text-sm font-black">
                    juan_perez
                  </div>
                  <span className="text-[10px] text-emerald-400/90 font-sans block pt-0.5">
                    Coloca exactamente el nombre creado en el módulo (ej. <code>juan_perez</code>, <code>agente_carlos</code>).
                  </span>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400 text-[11px] font-sans font-bold">
                    Dominio (Domain):
                  </label>
                  <div className="p-2 rounded bg-slate-900 border border-slate-700 text-sky-400 font-bold">
                    IP_DE_TU_VPS:47923
                  </div>
                </div>

                {/* LOGIN FIELD ALSO HIGHLIGHTED */}
                <div className="p-3 rounded-xl bg-emerald-950/60 border-2 border-emerald-500 space-y-1">
                  <label className="text-emerald-300 text-[11px] font-sans font-black flex items-center justify-between">
                    <span>Login de Autenticación:</span>
                    <span className="bg-emerald-500 text-slate-950 text-[10px] px-1.5 py-0.2 rounded font-bold">
                      EL MISMO NOMBRE
                    </span>
                  </label>
                  <div className="p-2 rounded bg-slate-950 border border-emerald-500/50 text-emerald-300 text-sm font-black">
                    juan_perez
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400 text-[11px] font-sans font-bold">
                    Contraseña (Password):
                  </label>
                  <div className="p-2 rounded bg-slate-900 border border-slate-700 text-amber-300 font-bold">
                    ••••••••••••••••
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400 text-[11px] font-sans font-bold">
                    Nombre a Mostrar (Display Name):
                  </label>
                  <div className="p-2 rounded bg-slate-900 border border-slate-700 text-white font-bold">
                    Juan Perez
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Step-by-Step Instructions & FAQ */}
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 text-xs leading-relaxed">
                <h4 className="font-bold text-white text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Pasos para entregar a tu cliente:</span>
                </h4>
                <ol className="list-decimal list-inside space-y-2 text-slate-300">
                  <li>
                    <b>Crea el cliente en la pestaña "Clientes"</b>: Escribe su nombre completo y define su usuario alfanumérico (ej: <code>juan_perez</code>).
                  </li>
                  <li>
                    <b>Haz clic en "Descargar .ini"</b>: El sistema te entregará un archivo <code>microsip_juan_perez.ini</code> listo para usar.
                  </li>
                  <li>
                    <b>Envíale el archivo a tu cliente</b>: El cliente solo descarga MicroSIP Portable para Windows, coloca el archivo <code>microsip.ini</code> en la misma carpeta y al abrirlo... <b>¡se conecta automáticamente en color verde!</b>
                  </li>
                  <li>
                    <b>Si lo configuran manualmente</b>: Dile que en los campos <b>User</b> y <b>Login</b> escriba su nombre (<code>juan_perez</code>), en lugar de una extensión numérica tradicional.
                  </li>
                </ol>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 text-xs">
                <h4 className="font-bold text-white text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4 text-sky-400" />
                  <span>¿Por qué funciona por nombre?</span>
                </h4>
                <p className="text-slate-300 leading-relaxed">
                  En el servidor Linux, Asterisk 20 utiliza el motor <b>chan_pjsip</b>. En PJSIP, cada agente es un <i>Endpoint</i>. El identificador del endpoint puede ser cualquier cadena de caracteres (<code>[juan_perez]</code>), y la autenticación se valida contra <code>username=juan_perez</code>.
                </p>
                <div className="p-3 rounded-xl bg-slate-950 font-mono text-[11px] text-slate-300 space-y-1">
                  <div className="text-emerald-400 font-bold">; Fragmento generado en /etc/asterisk/pjsip.conf:</div>
                  <div>[juan_perez]</div>
                  <div>type = endpoint</div>
                  <div>context = from-internal</div>
                  <div>auth = juan_perez-auth</div>
                  <div>aors = juan_perez</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: CREATE / EDIT RESELLER CLIENT */}
      {isClientModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-400" />
                <span>{editingClient ? 'Editar Cuenta de Cliente' : 'Nueva Cuenta de Reventa / MicroSIP'}</span>
              </h3>
              <button
                onClick={() => setIsClientModalOpen(false)}
                className="text-slate-400 hover:text-white font-bold text-lg"
              >
                &times;
              </button>
            </div>

            {clientFormError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{clientFormError}</span>
              </div>
            )}

            <form onSubmit={handleSaveClient} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">
                    Nombre del Cliente / Persona *
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Juan Perez"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">
                    Empresa / Negocio (Opcional)
                  </label>
                  <input
                    type="text"
                    value={formCompany}
                    onChange={(e) => setFormCompany(e.target.value)}
                    placeholder="Ventas VIP Santiago"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* SIP USERNAME - HIGHLIGHTED AS NAME */}
              <div className="p-3.5 rounded-xl bg-emerald-950/40 border-2 border-emerald-500/60 space-y-1.5">
                <label className="block text-emerald-300 font-bold flex items-center justify-between">
                  <span>Nombre de Usuario MicroSIP * (Por Nombre, ej: juan_perez)</span>
                  <span className="text-[10px] bg-emerald-500 text-slate-950 px-1.5 py-0.2 rounded font-black">
                    Alfanumérico
                  </span>
                </label>
                <input
                  type="text"
                  required
                  value={formSipUsername}
                  onChange={(e) => setFormSipUsername(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                  placeholder="juan_perez"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-emerald-500/50 text-emerald-300 font-mono text-sm font-bold focus:outline-none focus:border-emerald-400"
                />
                <span className="text-[10px] text-slate-400 block">
                  Este es el nombre exacto que el cliente usará en el campo "User" y "Login" de MicroSIP.
                </span>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">
                  Contraseña SIP (Secret) *
                </label>
                <input
                  type="text"
                  required
                  value={formSipPassword}
                  onChange={(e) => setFormSipPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">
                    Tarifa de Venta ($ / Minuto) *
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    required
                    value={formCostPerMin}
                    onChange={(e) => setFormCostPerMin(parseFloat(e.target.value) || 0.018)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-[10px] text-slate-400">Ejemplo: $0.018 o $0.020 USD</span>
                </div>

                {!editingClient && (
                  <div>
                    <label className="block text-slate-300 font-bold mb-1">
                      Saldo Inicial a Cargar ($ USD)
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={formInitialBalance}
                      onChange={(e) => setFormInitialBalance(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-emerald-400 font-mono font-bold focus:outline-none focus:border-emerald-500"
                    />
                    <span className="text-[10px] text-sky-400 font-mono">
                      Equivale a ~{Math.floor(formInitialBalance / (formCostPerMin || 0.018))} minutos
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="chk-cutoff"
                  checked={formCutoffOnZero}
                  onChange={(e) => setFormCutoffOnZero(e.target.checked)}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-950"
                />
                <label htmlFor="chk-cutoff" className="text-slate-300 text-xs font-semibold">
                  Cortar llamadas automáticamente cuando el saldo llegue a 0 (Modo Prepago Estricto)
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-slate-400 text-xs mb-1">Teléfono WhatsApp Contacto</label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="+18494386040"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-xs mb-1">Correo Electrónico</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="cliente@gmail.com"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsClientModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:bg-slate-800 font-bold transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl font-black bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-400 transition-all flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{editingClient ? 'Guardar Cambios' : 'Crear Cuenta MicroSIP'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: RECHARGE BALANCE / MINUTES */}
      {isRechargeModalOpen && selectedClientForRecharge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <Zap className="w-5 h-5 text-emerald-400" />
                  <span>Recargar Minutos & Saldo</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Cliente: <b className="text-white">{selectedClientForRecharge.name}</b> ({selectedClientForRecharge.sipUsername})
                </p>
              </div>
              <button
                onClick={() => setIsRechargeModalOpen(false)}
                className="text-slate-400 hover:text-white font-bold text-lg"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleExecuteRecharge} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">
                  Monto a Recargar ($ USD) *
                </label>
                <div className="relative">
                  <DollarSign className="w-4 h-4 text-emerald-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="number"
                    step="1"
                    min="1"
                    required
                    value={rechargeAmount}
                    onChange={(e) => setRechargeAmount(parseFloat(e.target.value) || 0)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-emerald-300 font-mono text-base font-black focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="text-[11px] text-sky-400 font-mono font-bold mt-1">
                  Minutos a Acreditar: +{Math.floor(rechargeAmount / (selectedClientForRecharge.costPerMinute || 0.018)).toLocaleString()} minutos (Tarifa: ${selectedClientForRecharge.costPerMinute}/min)
                </div>
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-slate-400 text-[10px]">Cargas rápidas:</span>
                {[10, 20, 50, 100].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setRechargeAmount(amt)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono font-bold transition-colors"
                  >
                    ${amt}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">
                  Método de Pago Recibido *
                </label>
                <select
                  value={rechargeMethod}
                  onChange={(e) => setRechargeMethod(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="zelle">Zelle (Transferencia bancaria USA)</option>
                  <option value="usdt_crypto">Cripto USDT (TRC-20 / Binance Pay)</option>
                  <option value="bank_transfer">Transferencia Bancaria Local (Banreservas / BHD / Popular)</option>
                  <option value="cash">Efectivo (Cash)</option>
                  <option value="credit_card">Tarjeta de Crédito / Débito</option>
                  <option value="voucher">Voucher / Cupón de Minutos</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">
                  Número de Referencia o Comprobante
                </label>
                <input
                  type="text"
                  value={rechargeReference}
                  onChange={(e) => setRechargeReference(e.target.value)}
                  placeholder="Ej: ZEL-9948102 o TXID de Binance"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Notas Internas</label>
                <input
                  type="text"
                  value={rechargeNotes}
                  onChange={(e) => setRechargeNotes(e.target.value)}
                  placeholder="Nota opcional..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsRechargeModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:bg-slate-800 font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl font-black bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-400 transition-all flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Acreditar Saldo Ahora</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: MICROSIP SETUP ASSISTANT MODAL (PER CLIENT) */}
      {microSipModalClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
                  <PhoneCall className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">
                    Configuración MicroSIP - {microSipModalClient.name}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Registrado con Nombre de Usuario: <b className="text-emerald-300 font-mono">{microSipModalClient.sipUsername}</b>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setMicroSipModalClient(null)}
                className="text-slate-400 hover:text-white font-bold text-lg"
              >
                &times;
              </button>
            </div>

            {/* Quick Copy Fields */}
            <div className="space-y-2 bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs font-mono">
              <div className="flex items-center justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400 font-sans">Account Name:</span>
                <span className="text-white font-bold">{microSipModalClient.name}</span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400 font-sans">SIP Server:</span>
                <span className="text-sky-300 font-bold">IP_DE_TU_VPS:47923</span>
              </div>

              {/* Highlight User by name */}
              <div className="flex items-center justify-between py-1.5 border-b border-emerald-500/30 bg-emerald-950/30 px-2 rounded">
                <span className="text-emerald-300 font-sans font-bold">User (Nombre):</span>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-black text-sm">{microSipModalClient.sipUsername}</span>
                  <button
                    onClick={() => handleCopy(microSipModalClient.sipUsername, 'mic-user')}
                    className="text-slate-400 hover:text-emerald-400"
                  >
                    {copiedKey === 'mic-user' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400 font-sans">Domain:</span>
                <span className="text-sky-300 font-bold">IP_DE_TU_VPS:47923</span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-emerald-500/30 bg-emerald-950/30 px-2 rounded">
                <span className="text-emerald-300 font-sans font-bold">Login (Mismo Nombre):</span>
                <span className="text-emerald-400 font-black">{microSipModalClient.sipUsername}</span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400 font-sans">Password:</span>
                <div className="flex items-center gap-2">
                  <span className="text-amber-300 font-bold">{microSipModalClient.sipPassword}</span>
                  <button
                    onClick={() => handleCopy(microSipModalClient.sipPassword, 'mic-pass')}
                    className="text-slate-400 hover:text-emerald-400"
                  >
                    {copiedKey === 'mic-pass' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-slate-400 font-sans">Puerto UDP:</span>
                <span className="text-sky-300 font-bold">47923</span>
              </div>
            </div>

            {/* Direct Download Button */}
            <div className="p-3 rounded-xl bg-sky-950/40 border border-sky-500/30 flex items-center justify-between gap-3 text-xs">
              <div className="space-y-0.5">
                <div className="font-bold text-white">¿Quieres enviarle todo listo al cliente?</div>
                <div className="text-slate-300 text-[11px]">
                  Descarga el archivo <code>microsip.ini</code> que ya incluye su nombre y contraseña.
                </div>
              </div>
              <button
                onClick={() => handleDownloadMicroSipIni(microSipModalClient)}
                className="px-3.5 py-2 rounded-xl text-xs font-black bg-sky-500 hover:bg-sky-400 text-slate-950 flex items-center gap-1.5 shadow-md transition-all shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar .ini</span>
              </button>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setMicroSipModalClient(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: INVOICE / RECEIPT MODAL */}
      {receiptModalRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-white text-base">Comprobante de Recarga</h3>
              </div>
              <button
                onClick={() => setReceiptModalRecord(null)}
                className="text-slate-400 hover:text-white font-bold text-lg"
              >
                &times;
              </button>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs space-y-2.5">
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Factura Nº:</span>
                <span className="text-white font-bold">{receiptModalRecord.invoiceNumber}</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Cliente:</span>
                <span className="text-white font-bold">{receiptModalRecord.clientName}</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Usuario MicroSIP:</span>
                <span className="text-emerald-400 font-bold">{receiptModalRecord.sipUsername}</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Monto Pagado:</span>
                <span className="text-emerald-400 font-bold text-sm">
                  ${receiptModalRecord.amount.toFixed(2)} USD
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Minutos Acreditados:</span>
                <span className="text-sky-300 font-bold">
                  +{receiptModalRecord.minutesAdded.toLocaleString()} min
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Método de Pago:</span>
                <span className="text-slate-200 capitalize">{receiptModalRecord.paymentMethod}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Referencia:</span>
                <span className="text-slate-300">{receiptModalRecord.reference}</span>
              </div>
            </div>

            {/* Quick WhatsApp Copy Message */}
            <div className="space-y-2">
              <button
                onClick={() => {
                  const msg = `*COMPROBANTE DE RECARGA VOIP*\nFactura: ${receiptModalRecord.invoiceNumber}\nCliente: ${receiptModalRecord.clientName}\nUsuario MicroSIP: ${receiptModalRecord.sipUsername}\nMonto: $${receiptModalRecord.amount.toFixed(2)} USD\nMinutos Acreditados: +${receiptModalRecord.minutesAdded.toLocaleString()} minutos\nReferencia: ${receiptModalRecord.reference}\nEstado: Acreditado con Éxito ✅`;
                  handleCopy(msg, 'wa-msg');
                  showToast('¡Texto para WhatsApp copiado al portapapeles!');
                }}
                className="w-full py-2.5 rounded-xl font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center justify-center gap-2 text-xs shadow-md transition-all"
              >
                {copiedKey === 'wa-msg' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>Copiar Notificación para WhatsApp</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
