type Args = {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt?: Date;
};

export class InboxMessage {
  public readonly messageId: string;
  public readonly consumerName: string;
  public readonly payloadHash: string;
  public readonly receivedAt: Date;
  public readonly processedAt: Date | undefined;

  constructor(args: Args) {
    this.messageId = args.messageId;
    this.consumerName = args.consumerName;
    this.payloadHash = args.payloadHash;
    this.receivedAt = args.receivedAt;
    this.processedAt = args.processedAt;
  }

  isProcessed(): boolean {
    return this.processedAt != null;
  }

  markProcessed(at: Date): InboxMessage {
    if (this.isProcessed()) {
      throw new Error(`inbox message ${this.messageId} is already processed`);
    }

    return new InboxMessage({
      messageId: this.messageId,
      consumerName: this.consumerName,
      payloadHash: this.payloadHash,
      receivedAt: this.receivedAt,
      processedAt: at,
    });
  }
}
