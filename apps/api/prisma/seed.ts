import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Seed default rate limits
  const rateLimits = [
    { provider: 'gmail.com', maxSmtpOut: 3, maxMsgRatePerHour: 100, connectTimeout: 30, description: 'Google Gmail' },
    { provider: 'googlemail.com', maxSmtpOut: 3, maxMsgRatePerHour: 100, connectTimeout: 30, description: 'Google Mail (alt)' },
    { provider: 'outlook.com', maxSmtpOut: 2, maxMsgRatePerHour: 50, connectTimeout: 30, description: 'Microsoft Outlook' },
    { provider: 'hotmail.com', maxSmtpOut: 2, maxMsgRatePerHour: 50, connectTimeout: 30, description: 'Microsoft Hotmail' },
    { provider: 'live.com', maxSmtpOut: 2, maxMsgRatePerHour: 50, connectTimeout: 30, description: 'Microsoft Live' },
    { provider: 'yahoo.com', maxSmtpOut: 5, maxMsgRatePerHour: 200, connectTimeout: 30, description: 'Yahoo Mail' },
    { provider: 'aol.com', maxSmtpOut: 5, maxMsgRatePerHour: 200, connectTimeout: 30, description: 'AOL Mail' },
    { provider: 'icloud.com', maxSmtpOut: 3, maxMsgRatePerHour: 80, connectTimeout: 30, description: 'Apple iCloud' },
    { provider: 'default', maxSmtpOut: 10, maxMsgRatePerHour: 500, connectTimeout: 30, description: 'Default for all other providers' },
  ];

  for (const rl of rateLimits) {
    await prisma.rateLimit.upsert({
      where: { provider: rl.provider },
      update: rl,
      create: rl,
    });
  }
  console.log(`✓ Seeded ${rateLimits.length} rate limits`);

  // Seed default settings
  const settings = [
    { key: 'batch_size', value: '1000', description: 'Number of emails per batch' },
    { key: 'heartbeat_timeout', value: '120', description: 'Seconds before a node is marked offline' },
    { key: 'max_retries', value: '3', description: 'Maximum retry attempts for soft bounces' },
    { key: 'retry_delay_hours', value: '4', description: 'Hours to wait before retrying' },
    { key: 'warmup_day1_limit', value: '200', description: 'Max checks/IP/day during warmup day 1-3' },
    { key: 'warmup_day4_limit', value: '500', description: 'Max checks/IP/day during warmup day 4-7' },
    { key: 'warmup_week2_limit', value: '2000', description: 'Max checks/IP/day after warmup week 2+' },
    { key: 'catchall_recheck_hours', value: '24', description: 'Hours between catch-all domain rechecks' },
    { key: 'alert_bounce_rate_threshold', value: '40', description: 'Hard bounce % threshold for alert' },
    { key: 'alert_5xx_threshold', value: '10', description: 'Number of 5xx responses before IP alert' },
    { key: 'probe_email_prefix', value: 'xk7q2bounce', description: 'Prefix for catch-all probe emails' },
  ];

  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value, description: s.description },
      create: s,
    });
  }
  console.log(`✓ Seeded ${settings.length} settings`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
