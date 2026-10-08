import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { PrismaService } from '../prisma/prisma.service';

type NotificationSendResult = {
  requested: number;
  sent: number;
  failed: number;
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private firebaseApp?: App;
  private messaging?: Messaging;
  private firebaseConfigWarningLogged = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async sendOrderCreatedNotification(
    fcmTokens: string[],
    orderId: number,
  ): Promise<NotificationSendResult> {
    return this.sendToTokens(
      fcmTokens,
      'Order created',
      `Your order #${orderId} was created successfully.`,
      {
        type: 'ORDER_CREATED',
        order_id: String(orderId),
        status: 'PENDING',
      },
    );
  }

  async sendOrderStatusChangedNotification(
    fcmTokens: string[],
    orderId: number,
    status: string,
  ): Promise<NotificationSendResult> {
    return this.sendToTokens(
      fcmTokens,
      'Order status updated',
      `Your order #${orderId} is now ${status}.`,
      {
        type: 'ORDER_STATUS_UPDATED',
        order_id: String(orderId),
        status,
      },
    );
  }

  async sendPaymentStatusUpdatedNotification(
    fcmTokens: string[],
    orderId: number,
    paymentStatus: string,
  ): Promise<NotificationSendResult> {
    return this.sendToTokens(
      fcmTokens,
      'Payment status updated',
      `The payment for your order #${orderId} was ${paymentStatus.toLowerCase()}.`,
      {
        type: 'PAYMENT_STATUS_UPDATED',
        order_id: String(orderId),
        payment_status: paymentStatus,
      },
    );
  }

  async sendBroadcastNotification(
    title: string,
    body?: string,
  ): Promise<NotificationSendResult> {
    const devices = await this.prisma.userDevice.findMany({
      select: { token: true },
    });

    return this.sendToTokens(
      devices.map((device) => device.token),
      title,
      body,
      { type: 'BROADCAST' },
    );
  }

  private async sendToTokens(
    fcmTokens: string[],
    title: string,
    body?: string,
    data?: Record<string, string>,
  ): Promise<NotificationSendResult> {
    const uniqueTokens = [...new Set(fcmTokens.filter(Boolean))];
    const result: NotificationSendResult = {
      requested: uniqueTokens.length,
      sent: 0,
      failed: 0,
    };

    if (uniqueTokens.length === 0) {
      return result;
    }

    const messaging = this.getMessaging();
    if (!messaging) {
      return result;
    }

    const batches = this.chunk(uniqueTokens, 500);
    const responses = await Promise.allSettled(
      batches.map((tokens) =>
        messaging.sendEachForMulticast({
          tokens,
          notification: {
            title,
            ...(body ? { body } : {}),
          },
          ...(data ? { data } : {}),
        }),
      ),
    );

    responses.forEach((response, index) => {
      if (response.status === 'fulfilled') {
        result.sent += response.value.successCount;
        result.failed += response.value.failureCount;
      } else {
        result.failed += batches[index].length;
      }
    });

    if (result.failed > 0) {
      this.logger.warn(
        `Could not send notification to ${result.failed} device(s).`,
      );
    }

    return result;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      batches.push(items.slice(index, index + size));
    }
    return batches;
  }

  private getMessaging(): Messaging | undefined {
    if (this.messaging) {
      return this.messaging;
    }

    const serviceAccount = this.getServiceAccount();
    if (!serviceAccount) {
      if (!this.firebaseConfigWarningLogged) {
        this.logger.warn(
          'Firebase notifications are disabled: configure FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.',
        );
        this.firebaseConfigWarningLogged = true;
      }
      return undefined;
    }

    try {
      this.firebaseApp =
        getApps()[0] ??
        initializeApp({
          credential: cert(serviceAccount),
        });
      this.messaging = getMessaging(this.firebaseApp);
      return this.messaging;
    } catch (error) {
      this.logger.error(
        `Firebase initialization failed: ${this.getErrorMessage(error)}`,
      );
      return undefined;
    }
  }

  private getServiceAccount():
    | {
        projectId: string;
        clientEmail: string;
        privateKey: string;
      }
    | undefined {
    const json = this.configService.get<string>(
      'FIREBASE_SERVICE_ACCOUNT_JSON',
    );

    if (json) {
      try {
        const parsed = JSON.parse(json) as {
          project_id?: string;
          client_email?: string;
          private_key?: string;
        };

        if (parsed.project_id && parsed.client_email && parsed.private_key) {
          return {
            projectId: parsed.project_id,
            clientEmail: parsed.client_email,
            privateKey: parsed.private_key.replace(/\\n/g, '\n'),
          };
        }
      } catch (error) {
        this.logger.warn(
          `FIREBASE_SERVICE_ACCOUNT_JSON is invalid: ${this.getErrorMessage(error)}`,
        );
        return undefined;
      }
    }

    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.configService
      .get<string>('FIREBASE_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      return undefined;
    }

    return { projectId, clientEmail, privateKey };
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
