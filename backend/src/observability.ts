export interface BackupEvent {
  readonly sequence: number;
  readonly payload: string;
}

export interface AuthorityBackup {
  readonly format: "p3-authority-backup-v1";
  readonly roomId: string;
  readonly gameId: string;
  readonly rulesVersion: string;
  readonly roundNumber: number;
  readonly eventSequence: number;
  readonly initialLeader: string;
  /** 仅限受控恢复材料；不得进入日志、响应或浏览器。 */
  readonly encryptedSeed: string;
  readonly events: readonly BackupEvent[];
  readonly commands: readonly {
    readonly commandId: string;
    readonly response: string;
  }[];
  readonly snapshot: {
    readonly eventSequence: number;
    readonly payload: string;
  } | null;
  readonly checksum: string;
}

function canonical(backup: Omit<AuthorityBackup, "checksum">): string {
  return JSON.stringify(backup);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function backupChecksum(
  backup: Omit<AuthorityBackup, "checksum">,
): Promise<string> {
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(backup)),
      ),
    ),
  );
}

export async function verifyAuthorityBackup(
  backup: AuthorityBackup,
): Promise<"ok" | "checksum_mismatch" | "event_sequence_gap"> {
  const { checksum, ...unsigned } = backup;
  if ((await backupChecksum(unsigned)) !== checksum) return "checksum_mismatch";
  if (backup.eventSequence !== backup.events.length - 1)
    return "event_sequence_gap";
  if (backup.events.some((event, index) => event.sequence !== index))
    return "event_sequence_gap";
  if (backup.snapshot && backup.snapshot.eventSequence !== backup.eventSequence)
    return "event_sequence_gap";
  return "ok";
}

export function redactedRoomId(roomId: string): string {
  return roomId.length <= 8 ? "***" : `${roomId.slice(0, 6)}…`;
}

export function operationalLog(
  event: string,
  fields: {
    readonly roomId: string;
    readonly eventSequence?: number;
    readonly rulesVersion?: string;
    readonly outcome: "ok" | "failed";
    readonly reason?: string;
    readonly durationMs?: number;
  },
): void {
  console.info(
    JSON.stringify({
      event,
      roomId: redactedRoomId(fields.roomId),
      eventSequence: fields.eventSequence,
      rulesVersion: fields.rulesVersion,
      outcome: fields.outcome,
      reason: fields.reason,
      durationMs: fields.durationMs,
    }),
  );
}
