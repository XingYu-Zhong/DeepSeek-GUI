export type UserInputAnswer = {
  id: string
  label: string
  value: string
}

export type UserInputOption = {
  label: string
  description: string
}

export type UserInputQuestion = {
  header: string
  id: string
  question: string
  options: UserInputOption[]
}

export type UserInputRequest = {
  id: string
  threadId: string
  turnId: string
  itemId: string
  prompt: string
  questions: UserInputQuestion[]
}

export type UserInputResolution =
  | { status: 'submitted'; answers: UserInputAnswer[] }
  | { status: 'cancelled'; answers?: UserInputAnswer[] }

export interface UserInputGate {
  request(input: UserInputRequest): Promise<UserInputResolution>
  get(inputId: string): UserInputRequest | undefined
  resolve(inputId: string, resolution: UserInputResolution): boolean
  pending(threadId?: string): UserInputRequest[]
  reset(): void
}
