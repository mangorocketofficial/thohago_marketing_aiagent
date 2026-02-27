import { Bot } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.log("TELEGRAM_BOT_TOKEN is not set. Skipping bot startup.");
  process.exit(0);
}

const bot = new Bot(token);

bot.command("health", async (ctx) => {
  await ctx.reply("ok");
});

bot.start();
console.log("Telegram bot scaffold is running.");
