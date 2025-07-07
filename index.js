const { Client, IntentsBitField, AttachmentBuilder, SlashCommandBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const http = require('http');
require('dotenv').config();

// HTTPサーバー（ヘルスチェック用）
const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    try {
      const healthData = {
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        discord: {
          botStatus: client.isReady() ? 'online' : 'offline',
          botUser: client.isReady() ? client.user.tag : 'not logged in',
        },
        environment: {
          BOT_TOKEN: process.env.BOT_TOKEN ? 'set' : 'unset',
          IMAGE_FOLDER: process.env.IMAGE_FOLDER ? 'set' : 'unset',
        },
        imageFolder: {
          path: imageFolder,
          exists: false,
          imageCount: 0,
          diskUsage: 'unknown',
        },
        imageHistory: {
          count: imageHistory.length,
          max: MAX_HISTORY,
        },
      };

      // 画像フォルダのチェック
      try {
        const stats = await fs.stat(imageFolder);
        healthData.imageFolder.exists = stats.isDirectory();
        const files = await fs.readdir(imageFolder);
        const imageFiles = files.filter(file =>
          ['.png', '.jpg', '.jpeg', '.gif'].includes(path.extname(file).toLowerCase())
        );
        healthData.imageFolder.imageCount = imageFiles.length;

        // ディスク使用量（Oracle Cloud向け）
        const { exec } = require('child_process');
        const util = require('util');
        const execPromise = util.promisify(exec);
        const { stdout } = await execPromise(`df -h "${imageFolder}" | tail -n 1`);
        healthData.imageFolder.diskUsage = stdout.trim();
      } catch (error) {
        healthData.imageFolder.error = error.message;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(healthData, null, 2));
      console.log('[INFO] ヘルスチェック実行:', healthData);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: error.message }));
      console.error('[ERROR] ヘルスチェックエラー:', error.message);
    }
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});
server.listen(process.env.PORT || 8080, () => {
  console.log(`[INFO] HTTP server running on port ${process.env.PORT || 8080}`);
});

// 環境変数の確認
if (!process.env.BOT_TOKEN || !process.env.IMAGE_FOLDER) {
  console.error('[FATAL] 必要な環境変数が未設定です:', {
    BOT_TOKEN: process.env.BOT_TOKEN ? '設定済み' : '未設定',
    IMAGE_FOLDER: process.env.IMAGE_FOLDER ? '設定済み' : '未設定',
  });
  process.exit(1);
}

// デバッグログ：アプリケーション開始
console.log('[INFO] アプリケーション開始');
console.log('[INFO] Node.jsバージョン:', process.version);

// Discordクライアントの初期化
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
  ],
});

// 画像フォルダと履歴
const imageFolder = process.env.IMAGE_FOLDER;
const imageHistory = [];
const MAX_HISTORY = 50;

// スラッシュコマンドの登録
client.on('ready', async () => {
  console.log(`[DEBUG] ボット起動！ ユーザー: ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('yoshito')
      .setDescription('ランダムな画像を送信します'),
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('ボットの機能を紹介します'),
  ];

  try {
    await client.application.commands.set(commands);
    console.log('[INFO] スラッシュコマンドを登録しました');
  } catch (error) {
    console.error('[ERROR] スラッシュコマンドの登録に失敗:', error.message);
  }
});

// スラッシュコマンドの処理
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  console.log(`[DEBUG] コマンド受信: ${interaction.commandName} from ${interaction.user.tag}`);

  // /yoshito コマンド
  if (interaction.commandName === 'yoshito') {
    try {
      if (!imageFolder) {
        await interaction.reply('画像フォルダのパスが設定されていません。');
        console.error('[ERROR] 画像フォルダ未設定');
        return;
      }

      const files = await fs.readdir(imageFolder);
      const imageFiles = files.filter(file =>
        ['.png', '.jpg', '.jpeg', '.gif'].includes(path.extname(file).toLowerCase())
      );

      const availableImages = imageFiles.filter(file => !imageHistory.includes(file));

      if (availableImages.length === 0) {
        imageHistory.length = 0;
        await interaction.reply('画像が不足したため、履歴をリセットしました。\nもう一度/yoshitoを試してください。');
        console.log('[INFO] 画像履歴をリセット');
        return;
      }

      const randomImage = availableImages[Math.floor(Math.random() * availableImages.length)];
      const imagePath = path.join(imageFolder, randomImage);

      imageHistory.push(randomImage);
      if (imageHistory.length > MAX_HISTORY) {
        imageHistory.shift();
      }

      const attachment = new AttachmentBuilder(imagePath);
      await interaction.reply({ files: [attachment] });
      console.log(`[INFO] 画像送信: ${randomImage}`);
    } catch (error) {
      console.error('[ERROR] /yoshitoエラー:', error.message);
      await interaction.reply('画像の送信中にエラーが発生しました。');
    }
  }

  // /help コマンド
  if (interaction.commandName === 'help') {
    const helpMessage = `
**ボットの機能**
- **/yoshito**: ランダムな画像を送信（過去50回重複なし）。
- **@${client.user.username} + 画像**: 画像をアップロード（200文字以内のテキスト対応）。
    `;
    await interaction.reply(helpMessage);
    console.log('[INFO] /helpコマンド実行');
  }
});

// メッセージベースの処理（/yoshitoおよびメンション）
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  console.log(`[DEBUG] メッセージ受信: "${message.content}" from ${message.author.tag} in guild: ${message.guild ? message.guild.name : 'DM'}`);

  // /yoshito コマンド
  if (message.content === '/yoshito') {
    try {
      if (!imageFolder) {
        await message.channel.send('画像フォルダのパスが設定されていません。');
        console.error('[ERROR] 画像フォルダ未設定');
        return;
      }

      const files = await fs.readdir(imageFolder);
      const imageFiles = files.filter(file =>
        ['.png', '.jpg', '.jpeg', '.gif'].includes(path.extname(file).toLowerCase())
      );

      const availableImages = imageFiles.filter(file => !imageHistory.includes(file));

      if (availableImages.length === 0) {
        imageHistory.length = 0;
        await message.channel.send('画像が不足したため、履歴をリセットしました。\nもう一度/yoshitoを試してください。');
        console.log('[INFO] 画像履歴をリセット');
        return;
      }

      const randomImage = availableImages[Math.floor(Math.random() * availableImages.length)];
      const imagePath = path.join(imageFolder, randomImage);

      imageHistory.push(randomImage);
      if (imageHistory.length > MAX_HISTORY) {
        imageHistory.shift();
      }

      const attachment = new AttachmentBuilder(imagePath);
      await message.channel.send({ files: [attachment] });
      console.log(`[INFO] 画像送信: ${randomImage}`);
    } catch (error) {
      console.error('[ERROR] /yoshitoエラー:', error.message);
      await message.channel.send('画像の送信中にエラーが発生しました。');
    }
    return;
  }

  // メンション＋画像の処理
  if (message.mentions.has(client.user) && message.attachments.size > 0) {
    try {
      const attachment = message.attachments.find(att =>
        ['.png', '.jpg', '.jpeg', '.gif'].includes(path.extname(att.name).toLowerCase())
      );

      if (!attachment) {
        await message.channel.send('対応する画像形式（.png, .jpg, .jpeg, .gif）を添付してください。');
        console.log('[INFO] 無効な画像形式');
        return;
      }

      const text = message.content.replace(/<@!?[0-9]+>/g, '').trim();
      if (text.length > 200) {
        await message.channel.send('テキストは200文字以内にしてください。');
        console.log('[INFO] テキスト長超過');
        return;
      }

      await message.delete();
      console.log('[INFO] ユーザーメッセージ削除');

      const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);
      const fileName = `user_upload_${Date.now()}_${attachment.name}`;
      const filePath = path.join(imageFolder, fileName);

      await fs.writeFile(filePath, buffer);
      console.log(`[INFO] 画像を保存: ${filePath}`);

      imageHistory.push(fileName);
      if (imageHistory.length > MAX_HISTORY) {
        imageHistory.shift();
      }

      const newAttachment = new AttachmentBuilder(filePath);
      const options = { files: [newAttachment] };
      if (text) {
        options.content = text;
      }
      await message.channel.send(options);
      console.log(`[INFO] 画像アップロード: ${fileName}${text ? ` with text: ${text}` : ''}`);
    } catch (error) {
      console.error('[ERROR] メンション画像処理エラー:', error.message);
      await message.channel.send('画像の処理中にエラーが発生しました。');
    }
  }
});

// エラー処理
client.on('error', (error) => {
  console.error('[ERROR] クライアントエラー:', error.message);
});

// ログイン
console.log('[INFO] Discordログイン開始');
client.login(process.env.BOT_TOKEN).catch((error) => {
  console.error('[FATAL] ログイン失敗:', error.message, error.code);
  process.exit(1);
});

// 予期しないエラーのキャッチ
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
});

// 警告ハンドリング
process.on('warning', (warning) => {
  console.warn('[WARNING]', warning);
});

// プロセスを維持（SIGTERM処理）
process.on('SIGTERM', () => {
  console.log('[INFO] SIGTERM received. Closing client...');
  client.destroy();
  server.close(() => {
    console.log('[INFO] HTTPサーバー終了');
    process.exit(0);
  });
});

// プロセスを維持するためのハートビートログ
setInterval(() => {
  console.log('[INFO] プロセス稼働中:', new Date().toISOString());
}, 60000);