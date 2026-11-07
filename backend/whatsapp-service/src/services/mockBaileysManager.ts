import { randomBytes } from 'node:crypto';

export type ConnectionState = 'disconnected' | 'qr_ready' | 'connecting' | 'connected';

export interface ServiceStatus {
  state: ConnectionState;
  connected: boolean;
  phone: string | null;
  qr: string | null;
  qrExpiresAt: string | null;
  isMock: true;
  configured: boolean;
  enabled: boolean;
  dryRun: boolean;
  disclaimer: string;
}

export interface QRResult {
  qr: string;
  expiresAt: string;
  secondsRemaining: number;
  state: ConnectionState;
}

export interface MockSendDetail {
  memberId: number;
  status: 'simulated';
  deliveredAt: string;
}

export interface MockSendResult {
  success: true;
  simulated: true;
  taskId: number;
  sentCount: number;
  failedCount: number;
  details: MockSendDetail[];
}

export class MockBaileysManager {
  private state: ConnectionState = 'disconnected';
  private currentQr: string | null = null;
  private qrExpiresAt: number | null = null;
  private connectedPhone: string | null = null;
  private expiryTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;

  public getStatus(): ServiceStatus {
    this.checkExpiry();
    return {
      state: this.state,
      connected: this.state === 'connected',
      phone: this.connectedPhone ? `+20 10 •••• ${this.connectedPhone.slice(-4)}` : null,
      qr: this.currentQr,
      qrExpiresAt: this.qrExpiresAt ? new Date(this.qrExpiresAt).toISOString() : null,
      isMock: true,
      configured: true,
      enabled: this.state !== 'disconnected',
      dryRun: true,
      disclaimer:
        'خدمة تجريبية معزولة تعتمد على محاكاة Baileys للأغراض الإدارية الداخلية فقط دون اتصال حقيقي بخوادم واتساب.',
    };
  }

  public generateQR(): QRResult {
    this.clearTimers();
    const token = randomBytes(16).toString('hex');
    const timestamp = Date.now();
    this.currentQr = `2@MOCK_BAILEYS_${token}_${timestamp},mockPublicKey,mockPairingRef`;
    this.qrExpiresAt = timestamp + 60_000;
    this.state = 'qr_ready';
    this.connectedPhone = null;

    this.expiryTimer = setTimeout(() => {
      if (this.state === 'qr_ready') {
        this.state = 'disconnected';
        this.currentQr = null;
        this.qrExpiresAt = null;
      }
    }, 60_000);

    // unref so timer doesn't hold open process in tests
    this.expiryTimer.unref?.();

    return {
      qr: this.currentQr,
      expiresAt: new Date(this.qrExpiresAt).toISOString(),
      secondsRemaining: 60,
      state: this.state,
    };
  }

  public simulateConnect(phoneNumber = '201012345678'): Promise<ServiceStatus> {
    this.clearTimers();
    this.state = 'connecting';
    return new Promise((resolve) => {
      this.connectTimer = setTimeout(() => {
        this.state = 'connected';
        this.currentQr = null;
        this.qrExpiresAt = null;
        this.connectedPhone = phoneNumber;
        resolve(this.getStatus());
      }, 1500);

      this.connectTimer.unref?.();
    });
  }

  public disconnect(): { success: true; state: ConnectionState } & ServiceStatus {
    this.clearTimers();
    this.state = 'disconnected';
    this.currentQr = null;
    this.qrExpiresAt = null;
    this.connectedPhone = null;
    const status = this.getStatus();
    return {
      success: true,
      ...status,
    };
  }

  public mockSend(
    taskId: number,
    memberIds: number[],
    consentConfirmed: boolean
  ): MockSendResult {
    if (!consentConfirmed) {
      throw new Error('يلزم تأكيد موافقة الأعضاء الصريحة على تلقي رسائل واتساب.');
    }
    if (this.state !== 'connected') {
      throw new Error('رقم واتساب غير متصل. اربط الرقم عبر QR أولاً.');
    }
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      throw new Error('قائمة الأعضاء فارغة أو غير صالحة.');
    }

    return {
      success: true,
      simulated: true,
      taskId,
      sentCount: memberIds.length,
      failedCount: 0,
      details: memberIds.map((id) => ({
        memberId: id,
        status: 'simulated',
        deliveredAt: new Date().toISOString(),
      })),
    };
  }

  private checkExpiry() {
    if (this.state === 'qr_ready' && this.qrExpiresAt && Date.now() > this.qrExpiresAt) {
      this.state = 'disconnected';
      this.currentQr = null;
      this.qrExpiresAt = null;
    }
  }

  private clearTimers() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.expiryTimer = null;
    this.connectTimer = null;
  }
}

export const mockBaileysManager = new MockBaileysManager();
