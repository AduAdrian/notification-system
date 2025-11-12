export class MockSendGridClient {
  private sentEmails: any[] = [];
  private shouldFail: boolean = false;
  private failureError: Error | null = null;

  setShouldFail(shouldFail: boolean, error?: Error): void {
    this.shouldFail = shouldFail;
    this.failureError = error || new Error('SendGrid API error');
  }

  async send(emailData: any): Promise<any> {
    if (this.shouldFail) {
      throw this.failureError;
    }

    this.sentEmails.push({
      ...emailData,
      timestamp: new Date(),
    });

    return {
      statusCode: 202,
      body: '',
      headers: {
        'x-message-id': `sg-${Date.now()}`,
      },
    };
  }

  getSentEmails(): any[] {
    return this.sentEmails;
  }

  getLastEmail(): any | undefined {
    return this.sentEmails[this.sentEmails.length - 1];
  }

  reset(): void {
    this.sentEmails = [];
    this.shouldFail = false;
    this.failureError = null;
  }
}

export const createMockSendGridClient = (): MockSendGridClient => {
  return new MockSendGridClient();
};
