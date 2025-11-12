export class MockTwilioClient {
  private sentMessages: any[] = [];
  private shouldFail: boolean = false;
  private failureError: Error | null = null;

  messages = {
    create: async (messageData: any): Promise<any> => {
      if (this.shouldFail) {
        throw this.failureError;
      }

      const message = {
        sid: `SM${Date.now()}`,
        ...messageData,
        status: 'queued',
        dateCreated: new Date(),
      };

      this.sentMessages.push(message);

      return message;
    },
  };

  setShouldFail(shouldFail: boolean, error?: Error): void {
    this.shouldFail = shouldFail;
    this.failureError = error || new Error('Twilio API error');
  }

  getSentMessages(): any[] {
    return this.sentMessages;
  }

  getLastMessage(): any | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  reset(): void {
    this.sentMessages = [];
    this.shouldFail = false;
    this.failureError = null;
  }
}

export const createMockTwilioClient = (): MockTwilioClient => {
  return new MockTwilioClient();
};
