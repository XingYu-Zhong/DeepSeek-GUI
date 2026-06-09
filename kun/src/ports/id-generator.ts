/**
 * Port for ids. Keeping id allocation behind a tiny interface makes
 * services deterministic in tests and avoids scattering random suffix
 * details through the application layer.
 */
export interface IdGenerator {
  next(prefix: string): string
}

export class RandomIdGenerator implements IdGenerator {
  constructor(private readonly random: () => number = Math.random) {}

  next(prefix: string): string {
    return `${prefix}_${this.random().toString(36).slice(2, 10)}`
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private nextSeq = 0

  next(prefix: string): string {
    this.nextSeq += 1
    return `${prefix}_${this.nextSeq}`
  }
}
