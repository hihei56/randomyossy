const { 
  Client, 
  IntentsBitField, 
  AttachmentBuilder, 
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const http = require('http');
require('dotenv').config();

const imageFolder = process.env.IMAGE_FOLDER;
const imageHistory = [];
const MAX_HISTORY = 50;

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
          IMAGE_FOLDER: imageFolder ? 'set' : 'unset',
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

      try {
        const stats = await fs.stat(imageFolder);
        healthData.imageFolder.exists = stats.isDirectory();
        const files = await fs.readdir(imageFolder);
        const imageFiles = files.filter(file =>
          ['.png', '.jpg', '.jpeg', '.gif'].includes(path.extname(file).toLowerCase())
        );
        healthData.imageFolder.imageCount = imageFiles.length;

        try {
          const { exec } = require('child_process');
          const util = require('util');
          const execPromise = util.promisify(exec);
          const { stdout } = await execPromise(`df -h "${imageFolder}" | tail -n 1`);
          healthData.imageFolder.diskUsage = stdout.trim();
        } catch (diskError) {
          healthData.imageFolder.diskUsage = '取得失敗';
          healthData.imageFolder.diskError = diskError.message;
        }
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

if (!process.env.BOT_TOKEN || !imageFolder) {
  console.error('[FATAL] 必要な環境変数が未設定です:', {
    BOT_TOKEN: process.env.BOT_TOKEN ? '設定済み' : '未設定',
    IMAGE_FOLDER: imageFolder ? '設定済み' : '未設定',
  });
  process.exit(1);
}

async function checkImageFolder() {
  try {
    const stats = await fs.stat(imageFolder);
    if (!stats.isDirectory()) {
      console.error('[FATAL] IMAGE_FOLDERはディレクトリではありません:', imageFolder);
      process.exit(1);
    }
    console.log('[INFO] 画像フォルダ確認済み:', imageFolder);
  } catch (error) {
    console.error('[FATAL] 画像フォルダにアクセスできません:', {
      message: error.message,
      path: imageFolder,
    });
    process.exit(1);
  }
}
checkImageFolder();

console.log('[INFO] アプリケーション開始');
console.log('[INFO] Node.jsバージョン:', process.version);

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
  ],
});

client.on('ready', async () => {
  console.log(`[DEBUG] ボット起動！ ユーザー: ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder().setName('yoshito').setDescription('ランダムな画像を送信します'),
    new SlashCommandBuilder().setName('help').setDescription('ボットの機能を紹介します'),
  ];

  try {
    await client.application.commands.set(commands);
    console.log('[INFO] スラッシュコマンドを登録しました');
  } catch (error) {
    console.error('[ERROR] スラッシュコマンド登録失敗:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📌 ボットの使い方')
      .setDescription('このボットでは以下の操作ができます：')
      .addFields(
        { name: '/yoshito', value: '画像フォルダからランダムに画像を送信します。過去50件の重複なし。' },
        { name: 'メンション＋画像', value: 'Botにメンションを飛ばしつつ画像をアップすると、Botが画像を保存して投稿します。' }
      )
      .setColor(0x00bfff)
      .setFooter({ text: '森本善人ボット', iconURL: client.user.displayAvatarURL() });

    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (interaction.commandName === 'yoshito') {
    await interaction.deferReply();
    try {
      const files = await fs.readdir(imageFolder);
      const imageFiles = files.filter(file =>
        ['.png', '.jpg', '.jpeg', '.gif'].includes(path.extname(file).toLowerCase())
      );
      const availableImages = imageFiles.filter(f => !imageHistory.includes(f));

      if (availableImages.length === 0) {
        imageHistory.length = 0;
        await interaction.editReply('画像履歴をリセットしました。もう一度 `/yoshito` を実行してください。');
        return;
      }

      const randomImage = availableImages[Math.floor(Math.random() * availableImages.length)];
      const imagePath = path.join(imageFolder, randomImage);
      imageHistory.push(randomImage);
      if (imageHistory.length > MAX_HISTORY) imageHistory.shift();

      const attachment = new AttachmentBuilder(imagePath);
      await interaction.editReply({ files: [attachment] });
    } catch (err) {
      console.error('[ERROR] /yoshitoエラー:', err);
      await interaction.editReply('画像送信に失敗しました。');
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content === '/yoshito') {
    const files = await fs.readdir(imageFolder);
    const imageFiles = files.filter(file =>
      ['.png', '.jpg', '.jpeg', '.gif'].includes(path.extname(file).toLowerCase())
    );
    const availableImages = imageFiles.filter(f => !imageHistory.includes(f));

    if (availableImages.length === 0) {
      imageHistory.length = 0;
      await message.channel.send('画像履歴をリセットしました。もう一度 `/yoshito` を実行してください。');
      return;
    }

    const randomImage = availableImages[Math.floor(Math.random() * availableImages.length)];
    const imagePath = path.join(imageFolder, randomImage);
    imageHistory.push(randomImage);
    if (imageHistory.length > MAX_HISTORY) imageHistory.shift();

    const attachment = new AttachmentBuilder(imagePath);
    await message.channel.send({ files: [attachment] });
    return;
  }

  if (message.mentions.has(client.user) && message.attachments.size > 0) {
    const attachment = message.attachments.find(att =>
      ['.png', '.jpg', '.jpeg', '.gif'].includes(path.extname(att.name || '').toLowerCase())
    );
    if (!attachment) return;

    const text = message.content.replace(/<@!?[0-9]+>/g, '').trim();
    if (text.length > 200) {
      await message.channel.send('テキストは200文字以内にしてください。');
      return;
    }

    let response;
    try {
      response = await axios.get(attachment.url, {
        responseType: 'arraybuffer',
        timeout: 10000,
      });
    } catch (err) {
      await message.channel.send('画像のダウンロードに失敗しました。');
      return;
    }

    try {
      await message.delete();
    } catch (_) {}

    const sanitizedFileName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `user_upload_${Date.now()}_${sanitizedFileName}`;
    const filePath = path.join(imageFolder, fileName);

    try {
      await fs.writeFile(filePath, Buffer.from(response.data));
    } catch (err) {
      await message.channel.send('画像保存中にエラーが発生しました。');
      return;
    }

    imageHistory.push(fileName);
    if (imageHistory.length > MAX_HISTORY) imageHistory.shift();

    const replyAttachment = new AttachmentBuilder(filePath);
    const sendOptions = { files: [replyAttachment] };
    if (text) sendOptions.content = text;

    await message.channel.send(sendOptions);
  }
});

client.on('error', (error) => {
  console.error('[ERROR] クライアントエラー:', error);
});
client.on('shardError', (error, shardId) => {
  console.error(`[ERROR] シャード${shardId}エラー:`, error);
});
client.on('invalidated', () => {
  console.error('[FATAL] セッション無効化。トークンを確認してください。');
  process.exit(1);
});
client.login(process.env.BOT_TOKEN).catch((error) => {
  console.error('[FATAL] ログイン失敗:', error);
  process.exit(1);
});
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
});
process.on('warning', (warning) => {
  console.warn('[WARNING]', warning);
});
process.on('SIGTERM', () => {
  console.log('[INFO] SIGTERM received. Closing client...');
  client.destroy();
  server.close(() => {
    console.log('[INFO] HTTPサーバー終了');
    process.exit(0);
  });
});
setInterval(() => {
  console.log('[INFO] プロセス稼働中:', new Date().toISOString());
}, 60000);
