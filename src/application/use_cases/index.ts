export interface UseCase<Input, Output> {
  execute(input: Input): Promise<Output>;
}

export class UseCaseNotImplementedError extends Error {
  constructor(useCaseName: string) {
    super(`${useCaseName} is not implemented yet`);
    this.name = "UseCaseNotImplementedError";
  }
}
