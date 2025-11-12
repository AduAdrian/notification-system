export class MockFirebaseAdmin {
  private sentNotifications: any[] = [];
  private shouldFail: boolean = false;
  private failureError: Error | null = null;

  messaging() {
    return {
      send: async (message: any): Promise<string> => {
        if (this.shouldFail) {
          throw this.failureError;
        }

        const messageId = `fcm-${Date.now()}`;
        this.sentNotifications.push({
          messageId,
          ...message,
          timestamp: new Date(),
        });

        return messageId;
      },
      sendMulticast: async (message: any): Promise<any> => {
        if (this.shouldFail) {
          throw this.failureError;
        }

        const tokens = message.tokens || [];
        const responses = tokens.map((token: string, index: number) => ({
          success: true,
          messageId: `fcm-${Date.now()}-${index}`,
        }));

        this.sentNotifications.push({
          ...message,
          responses,
          timestamp: new Date(),
        });

        return {
          successCount: tokens.length,
          failureCount: 0,
          responses,
        };
      },
    };
  }

  setShouldFail(shouldFail: boolean, error?: Error): void {
    this.shouldFail = shouldFail;
    this.failureError = error || new Error('Firebase messaging error');
  }

  getSentNotifications(): any[] {
    return this.sentNotifications;
  }

  getLastNotification(): any | undefined {
    return this.sentNotifications[this.sentNotifications.length - 1];
  }

  reset(): void {
    this.sentNotifications = [];
    this.shouldFail = false;
    this.failureError = null;
  }
}

export const createMockFirebaseAdmin = (): MockFirebaseAdmin => {
  return new MockFirebaseAdmin();
};
