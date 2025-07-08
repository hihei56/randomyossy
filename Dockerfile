# ベースイメージとしてNode.js v18を使用（軽量なAlpine版）
FROM node:18-alpine

# 作業ディレクトリを設定
WORKDIR /app

# package.jsonをコピーして依存関係をインストール
COPY package.json ./
RUN npm install --production

# アプリケーションのコードをすべてコピー
COPY . .

# 画像フォルダを作成（環境変数IMAGE_FOLDER用）
RUN mkdir -p /app/images

# 環境変数のデフォルト値（.envまたはデプロイ環境で上書き可能）
ENV NODE_ENV=production
ENV PORT=8080
ENV IMAGE_FOLDER=/app/images

# コンテナのポートを公開（ヘルスチェック用）
EXPOSE 8080

# アプリケーションの起動コマンド
CMD ["npm", "start"]
