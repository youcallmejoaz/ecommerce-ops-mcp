/** A guardrail refused the request. The message is shown to Claude and the user verbatim. */
export class LimitError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "LimitError";
  }
}

/** Bad input (unknown product, empty list, ...). */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}
