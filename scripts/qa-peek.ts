import "dotenv/config";
import { Client } from "pg";
// Salt-okunur QA kontrolü: yalnız QA/@example.test kayıtlarını listeler.  npx tsx scripts/qa-peek.ts [web]
const QA_CONTACT = `(c."fullName" like 'QA %' or c."primaryEmail" like '%@example.test')`;
const QA_LEAD = `(l.name like 'QA %' or l.email like '%@example.test')`;

async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  const q = async (label: string, sql: string) => console.log(label, (await c.query(sql)).rows);
  if (process.argv.includes("web")) {
    // Faz 2: site → CRM aktarımı
    await q("events", `select e."externalEventId" as sub, e."eventType", e.status, e."leadId" is not null as lead, e."lastError" from integration_events e where e.provider = 'BIFIRE_WEBSITE' and e."externalEventId" like 'qa%' order by e."receivedAt"`);
    await q("jobs", `select j.type, j.status, j.attempts from integration_jobs j join integration_events e on e.id = j."eventId" where e."externalEventId" like 'qa%'`);
    await q("leads", `select l."sourceSubmissionId" as sub, l.source, l.status, l.phone, l.email, (select c.number from contacts c where c.id = l."contactId") as contact, (select o.number from opportunities o where o.id = l."opportunityId") as opp from leads l where ${QA_LEAD} order by l."receivedAt"`);
    await q("contacts", `select c.number, c."fullName", c."primaryPhone", c."primaryEmail", c."kvkkNoticeAt" is not null as kvkk, c.source, (select string_agg(ch.type || ':' || ch.normalized || case when ch."isPrimary" then '*' else '' end, ' ') from contact_channels ch where ch."contactId" = c.id) as channels from contacts c where ${QA_CONTACT} order by c.number`);
    await q("consents", `select (select number from contacts c where c.id = ce."contactId") as contact, ce.type, ce.action, ce.source, ce.evidence->>'submissionId' as sub from consent_events ce where exists (select 1 from contacts c where c.id = ce."contactId" and ${QA_CONTACT}) order by ce."occurredAt"`);
    await q("opps", `select o.number, o.title, o.stage, o.source, o."ownerId" is not null as owned, o."nextActionNote", (select count(*) from activities a where a."opportunityId" = o.id) as acts from opportunities o where exists (select 1 from contacts c where c.id = o."contactId" and ${QA_CONTACT}) order by o.number`);
    await q("tasks", `select t.title, t.priority, t."assigneeId" is not null as assigned, t."dueAt" > now() + interval '23 hours' as due24h from tasks t where exists (select 1 from contacts c where c.id = t."contactId" and ${QA_CONTACT})`);
    await q("files", `select a."originalName", a."mimeType", a.kind, a."exifStripped", a."scanStatus", a.width, a."contactId" is not null as on_contact, a."leadId" is not null as on_lead, a."storageKey" from attachments a where exists (select 1 from leads l where l.id = a."leadId" and ${QA_LEAD})`);
    await q("audit", `select a.action, count(*)::int from audit_logs a where a."actorId" is null and a."createdAt" > now() - interval '1 day' group by 1 order by 1`);
    await q("connection", `select status, "lastSyncAt" is not null as synced, "lastError" from integration_connections where provider = 'BIFIRE_WEBSITE'`);
    await q("nonces", `select count(*)::int from webhook_nonces`);
    await c.end();
    return;
  }
  await q("contacts", `select number, "fullName", "primaryPhone", "primaryEmail", "kvkkNoticeAt" is not null as kvkk from contacts c where ${QA_CONTACT}`);
  await q("leads", `select source, status, "contactId" is not null as linked from leads l where exists (select 1 from contacts c where c.id=l."contactId" and c."fullName" like 'QA %')`);
  await q("opps", `select number, title, stage, position from opportunities o where exists (select 1 from contacts c where c.id=o."contactId" and c."fullName" like 'QA %')`);
  await q("opp-trail", `select o.number, o.stage, o."lostReason", (select count(*) from opportunity_stage_history h where h."opportunityId" = o.id) as hist, (select count(*) from activities a where a."opportunityId" = o.id) as acts, (select string_agg(l.action::text, ',') from audit_logs l where l."entityId" = o.id::text) as audits from opportunities o where exists (select 1 from contacts c where c.id = o."contactId" and c."fullName" like 'QA %') order by 1`);
  await q("tasks", `select title, priority, status from tasks t where exists (select 1 from contacts c where c.id=t."contactId" and c."fullName" like 'QA %')`);
  await q("users", `select email, role, status from users where email like '%@example.test'`);
  await c.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
