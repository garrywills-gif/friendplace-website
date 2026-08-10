/**
 * ics.ts — client-side iCalendar (.ics) builder + share helper.
 *
 * Batch B iter156 (Garry, Aug 2026 — P1 #6): community-hosted events
 * previously had no "Add to calendar" affordance (only FriendPlace-
 * curated events did, via the backend .ics endpoint). This module
 * lets any event surface generate an RFC 5545 compatible .ics stream
 * on the fly and hand it to the OS via the native Share sheet, so
 * members can add it to Apple / Google / Outlook without a
 * round-trip to the server.
 */
import { Share, Platform } from "react-native";
import * as FileSystem from "expo-file-system";

export type IcsEvent = {
  uid: string;             // stable unique id — usually the event.id
  title: string;
  description?: string;
  location?: string;
  /** ISO 8601 or `YYYY-MM-DD` date + `HH:MM` time (Sydney by default). */
  starts_at?: string;
  /** Optional end. Defaults to +2 hours from start. */
  ends_at?: string;
  /** Fallback separate fields — used when starts_at is missing. */
  date?: string;           // "2026-08-14" or "August 14, 2026"
  time?: string;           // "10:30 AM" or "10:30"
  timezone?: string;       // e.g. "Australia/Sydney"
};

const CRLF = "\r\n";

function pad(n: number) { return n.toString().padStart(2, "0"); }

/** Format Date to UTC ICS timestamp: 20260814T003000Z */
function toIcsUtc(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) + "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) + "Z"
  );
}

/** Parse a date + time string tolerantly. */
function coerceStart(e: IcsEvent): Date | null {
  if (e.starts_at) {
    const d = new Date(e.starts_at);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (e.date) {
    // Try to combine date + time. Assume local time — we don't do full
    // TZDB conversion client-side; iCal readers handle the local wall
    // clock correctly if we emit DTSTART with a floating TZID or UTC.
    const t = (e.time || "10:00").trim();
    const combined = `${e.date} ${t}`;
    const d = new Date(combined);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Escape ICS text per RFC 5545: commas, semicolons, backslashes, newlines. */
function escapeText(s: string): string {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold a long line at 74 bytes as required by RFC 5545. */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 73) {
    parts.push(line.slice(i, i + 73));
  }
  return parts.join(CRLF + " ");
}

export function buildIcs(e: IcsEvent): string {
  const start = coerceStart(e) || new Date();
  const end = e.ends_at ? new Date(e.ends_at) : new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const now = new Date();

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FriendPlace//Community Event//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeText(e.uid)}@friendplace.com.au`,
    `DTSTAMP:${toIcsUtc(now)}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeText(e.title)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(fold).join(CRLF) + CRLF;
}

/**
 * Write an .ics file to a temp path and hand it to the native share
 * sheet so the OS can offer Calendar / Files / Mail as targets.
 * Returns true on success (regardless of which app the user picked).
 */
export async function shareIcs(e: IcsEvent): Promise<boolean> {
  const ics = buildIcs(e);
  const safeName = (e.title || "event").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase().slice(0, 40) || "event";

  if (Platform.OS === "web") {
    // Browser: trigger a plain download via a blob URL.
    try {
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const url = (globalThis as any).URL?.createObjectURL?.(blob);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (globalThis as any).document;
      if (url && doc) {
        const a = doc.createElement("a");
        a.href = url;
        a.download = `${safeName}.ics`;
        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
        setTimeout(() => { try { (globalThis as any).URL?.revokeObjectURL?.(url); } catch { /* noop */ } }, 4000);
        return true;
      }
    } catch { /* fall through */ }
    return false;
  }

  // Native — write to cache and share via the platform Share sheet.
  try {
    // expo-file-system SDK 54+: use cacheDirectory-style path helper.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cacheDir = (FileSystem as any).cacheDirectory || (FileSystem as any).Paths?.cache?.uri || "";
    const uri = `${cacheDir}${safeName}.ics`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (FileSystem as any).writeAsStringAsync === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (FileSystem as any).writeAsStringAsync(uri, ics, { encoding: "utf8" });
    } else {
      // SDK 54 object-oriented API fallback.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const File = (FileSystem as any).File;
      if (File) {
        const f = new File(uri);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof (f as any).writeAsString === "function") await (f as any).writeAsString(ics);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        else if (typeof (f as any).write === "function") await (f as any).write(ics);
      }
    }
    const res = await Share.share(
      Platform.OS === "ios"
        ? { url: uri, title: e.title }
        : { message: ics, title: `${e.title}.ics` },
    );
    return res.action !== Share.dismissedAction;
  } catch {
    // Fallback — just share the raw ICS as text.
    try {
      const res = await Share.share({ message: ics, title: e.title });
      return res.action !== Share.dismissedAction;
    } catch { return false; }
  }
}
