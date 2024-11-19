import TelegramBot from 'node-telegram-bot-api';

export class TelegramBotService {
  private bot: TelegramBot;

  readonly chatId: string;

  constructor() {
    const token = process.env['TELEGRAM_TOKEN'] || '';
    this.bot = new TelegramBot(token, { polling: false });

    this.chatId = process.env['TELEGRAM_CHAT_ID'] || '';
  }

  public async sendMessage(message: string) {
    await this.bot.sendMessage(this.chatId, message).catch((e) => {
      console.error('error while sending log message', e);
    });
  }
}

export const telegramBotService = new TelegramBotService();
