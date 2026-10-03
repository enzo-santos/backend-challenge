import { Money } from "./money";

export enum LedgerItemType {
    Credit = "CREDIT",
    Debit = "DEBIT",
}

type LedgerItemArgs = {
    id: string
    transactionId: string
    type: LedgerItemType
    amount: Money
    createdAt: Date
}

export class LedgerItem {
    public readonly id: string
    public readonly transactionId: string
    public readonly type: LedgerItemType
    public readonly amount: Money
    public readonly createdAt: Date

    constructor(args: LedgerItemArgs) {
        this.id = args.id    
        this.transactionId = args.transactionId
        this.type = args.type
        this.amount = args.amount
        this.createdAt = args.createdAt    
    }
}