import { invoke } from "@tauri-apps/api/core";
import type { AuditEvent } from "./auditTypes";
import { useState } from "react";

export function useAuditLog() {
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  async function loadAuditEvents() {
    return invoke<AuditEvent[]>("list_audit_events", { projectId: null, limit: 20 });
  }
  return {
    loadAuditEvents,
    auditEvents,
    setAuditEvents,
  };
}
