// Notifications — transactional email (SES) and SMS (SNS). Credentials come from
// a send-only IAM user via env (Lightsail has no instance role). If unconfigured
// (local dev), everything logs to the console instead, so flows still work.
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { db } from './pool.ts';

const REGION = process.env.NOTIFY_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
const FROM = process.env.SES_FROM ?? 'no-reply@kunatra.com';
export const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const creds = process.env.NOTIFY_ACCESS_KEY_ID && process.env.NOTIFY_SECRET_ACCESS_KEY
  ? { accessKeyId: process.env.NOTIFY_ACCESS_KEY_ID, secretAccessKey: process.env.NOTIFY_SECRET_ACCESS_KEY }
  : undefined;

const ses = creds ? new SESv2Client({ region: REGION, credentials: creds }) : null;
const sns = creds ? new SNSClient({ region: REGION, credentials: creds }) : null;

/** Send a transactional email. Never throws — logs and moves on. */
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!to) return;
  if (!ses) { console.log(`[email→${to}] ${subject}\n${text}`); return; }
  try {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: [to] },
      Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
    }));
  } catch (e: any) {
    console.error(`[email→${to}] failed: ${e?.name ?? e?.message}`);
  }
}

/**
 * Send a transactional SMS. Never throws. NOTE: delivery to Indian (+91) numbers
 * requires DLT registration (sender ID + templates); until then SNS rejects them.
 */
export async function sendSms(to: string | null | undefined, message: string): Promise<void> {
  if (!to) return;
  if (!sns) { console.log(`[sms→${to}] ${message}`); return; }
  try {
    await sns.send(new PublishCommand({
      PhoneNumber: to,
      Message: message,
      MessageAttributes: { 'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' } },
    }));
  } catch (e: any) {
    console.error(`[sms→${to}] failed: ${e?.name ?? e?.message}`);
  }
}

/** Notify the people who manage a household's money (owners + managers). */
export async function notifyMoneyManagers(householdId: string, subject: string, text: string, sms?: string): Promise<void> {
  try {
    const { rows } = await db().query(
      `SELECT DISTINCT u.email, u.phone FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.household_id = $1 AND m.role IN ('owner','manager')`,
      [householdId]
    );
    for (const r of rows) {
      await sendEmail(r.email, subject, text);
      if (sms) await sendSms(r.phone, sms);
    }
  } catch (e: any) {
    console.error(`[notify] managers of ${householdId} failed: ${e?.message}`);
  }
}

/**
 * Daily sweep: remind managers of compliance items due within 3 days (or overdue),
 * once per day per item. Runs in-process (single instance) — the reminded_on guard
 * prevents duplicate sends if it runs more than once in a day.
 */
export async function remindDueCompliance(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const { rows } = await db().query(
      // Completed items are deleted (or rolled forward), so anything still due soon is open.
      `SELECT c.id, c.household_id, c.title, c.due_on
         FROM compliance_items c
        WHERE c.due_on <= current_date + 3
          AND (c.reminded_on IS NULL OR c.reminded_on < current_date)`
    );
    for (const c of rows) {
      const when = c.due_on;
      const overdue = new Date(when) < new Date(new Date().toISOString().slice(0, 10));
      const subj = `${overdue ? 'Overdue' : 'Due soon'}: ${c.title}`;
      const text = `A compliance item on your Kunatra household is ${overdue ? 'overdue' : 'due'} (${when}): ${c.title}.\n${appUrl}/operations`;
      const sms = `Kunatra: ${overdue ? 'OVERDUE' : 'due'} ${when} — ${c.title}`;
      await notifyMoneyManagers(c.household_id, subj, text, sms);
      await db().query(`UPDATE compliance_items SET reminded_on = current_date WHERE id = $1`, [c.id]);
    }
    if (rows.length) console.log(`[compliance] reminded on ${rows.length} item(s)`);
  } catch (e: any) {
    console.error(`[compliance] sweep failed: ${e?.message}`);
  }
}
