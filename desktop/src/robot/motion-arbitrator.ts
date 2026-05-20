export type MotionOwner = "audio" | "animation" | "manual" | "faceTracking";

export interface MotionReservation {
  owner: MotionOwner;
  reason: string;
  until: number;
}

export interface MotionBlock {
  blocked: boolean;
  owner?: MotionOwner;
  reason?: string;
  until?: string;
}

export interface MotionArbitrationSnapshot {
  active?: {
    owner: MotionOwner;
    reason: string;
    until: string;
    remainingMs: number;
  };
}

const PRIORITY: Record<MotionOwner, number> = {
  faceTracking: 20,
  manual: 40,
  audio: 50,
  animation: 60
};

export class MotionArbitrator {
  private reservations = new Map<MotionOwner, MotionReservation>();

  reserve(owner: MotionOwner, holdMs: number, reason: string): void {
    this.prune();
    this.reservations.set(owner, {
      owner,
      reason,
      until: Date.now() + Math.max(1, holdMs)
    });
  }

  release(owner: MotionOwner): void {
    this.reservations.delete(owner);
  }

  blockFor(owner: MotionOwner): MotionBlock {
    this.prune();
    const blocker = this.highestActiveReservation();
    if (!blocker || PRIORITY[blocker.owner] <= PRIORITY[owner]) {
      return { blocked: false };
    }
    return {
      blocked: true,
      owner: blocker.owner,
      reason: blocker.reason,
      until: new Date(blocker.until).toISOString()
    };
  }

  snapshot(): MotionArbitrationSnapshot {
    this.prune();
    const active = this.highestActiveReservation();
    if (!active) {
      return {};
    }
    return {
      active: {
        owner: active.owner,
        reason: active.reason,
        until: new Date(active.until).toISOString(),
        remainingMs: Math.max(0, active.until - Date.now())
      }
    };
  }

  private prune(): void {
    const now = Date.now();
    for (const [owner, reservation] of this.reservations) {
      if (reservation.until <= now) {
        this.reservations.delete(owner);
      }
    }
  }

  private highestActiveReservation(): MotionReservation | undefined {
    return [...this.reservations.values()].sort((a, b) => PRIORITY[b.owner] - PRIORITY[a.owner])[0];
  }
}
