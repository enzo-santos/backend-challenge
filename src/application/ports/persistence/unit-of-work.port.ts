export interface UnitOfWork {
  execute<Output>(operation: () => Promise<Output>): Promise<Output>;
}
