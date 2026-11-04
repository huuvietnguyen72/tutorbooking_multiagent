/** Single source of "now" for business logic; inject a fake in tests (15-minute hold, 24-hour window). */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock extends Clock {
  constructor(private current: Date) {
    super();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(next: Date): void {
    this.current = next;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
