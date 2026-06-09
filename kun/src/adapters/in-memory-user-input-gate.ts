import type {
  UserInputGate,
  UserInputRequest,
  UserInputResolution
} from '../ports/user-input-gate.js'

type PendingResolver = {
  resolve: (resolution: UserInputResolution) => void
  reject: (error: Error) => void
}

/**
 * In-memory user-input gate. The agent loop awaits `request`; the GUI
 * resolves it through the HTTP user-input route. Pending requests stay
 * addressable by id so reconnecting renderers can submit or cancel.
 */
export class InMemoryUserInputGate implements UserInputGate {
  private readonly requests = new Map<string, UserInputRequest>()
  private readonly resolvers = new Map<string, PendingResolver>()

  request(input: UserInputRequest): Promise<UserInputResolution> {
    this.requests.set(input.id, input)
    return new Promise<UserInputResolution>((resolve, reject) => {
      this.resolvers.set(input.id, { resolve, reject })
    })
  }

  get(inputId: string): UserInputRequest | undefined {
    return this.requests.get(inputId)
  }

  resolve(inputId: string, resolution: UserInputResolution): boolean {
    const request = this.requests.get(inputId)
    if (!request) return false
    this.requests.delete(inputId)
    const resolver = this.resolvers.get(inputId)
    this.resolvers.delete(inputId)
    resolver?.resolve(resolution)
    return true
  }

  pending(threadId?: string): UserInputRequest[] {
    return [...this.requests.values()].filter(
      (request) => !threadId || request.threadId === threadId
    )
  }

  reset(): void {
    for (const resolver of this.resolvers.values()) {
      resolver.reject(new Error('user input gate reset'))
    }
    this.requests.clear()
    this.resolvers.clear()
  }
}
