export type AuditEvent = {
  eventId: string;
  projectId: string | null;
  eventType: string;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: string;
};
