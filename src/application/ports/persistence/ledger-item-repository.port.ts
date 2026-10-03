import { LedgerItem } from "@/src/domain/ledger-item";

export interface LedgerItemRepository {
    create(item: LedgerItem): Promise<void>;
}
