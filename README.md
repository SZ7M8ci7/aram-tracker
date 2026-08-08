# ARAMトラッカー

保存済みJSONをブラウザ内で読み込み、ARAM: Mayhem の個人統計を表示する静的ビューアーです。選択したJSONは外部サーバーへ送信されません。表示中はBlitz、League Client、Riot API、その他の戦績APIにも接続しません。

## 起動

`start-dashboard.cmd` を実行し、`http://127.0.0.1:41731/playaram.html` を開きます。

GitHub Pagesではリポジトリの公開URLを開き、同じようにJSONファイルを選択します。

## 機能

- キャラ別の使用率、勝率、平均K/D/A、KDAレシオ、平均ダメージなど
- キャラ行をクリックした試合一覧の展開と、Overview詳細ページへの遷移
- アイテムの日本語名・アイコン、オーグメントの日本語表示
- 最低試合数、最低勝率、期間のフィルター
- 累積勝率グラフ、未使用キャラ一覧、10試合以上共闘したユーザーの勝率
- アイテムタブ（購入率、購入時勝率、購入時KDAレシオ）
- オーグメントタブ（取得率、取得時勝率、取得時KDAレシオ）
- 表ヘッダークリックによる昇順 / 降順ソート
- ヘッダー右上からのローカルJSONアップロード

## データ

画面の集計対象はJSONの `summaries` と `details` のみです。初期画面には戦績を表示せず、「JSONファイルを開く」で選択したファイルをブラウザのメモリ上で集計します。リポジトリとGitHub Pagesには個人戦績JSONを含めません。日本語辞書は `data/playaram-dictionary.json` にあります。

アイコン画像は表示用にData Dragon CDNを参照しますが、戦績データの取得・復元は行いません。

## ビルドとテスト

- `npm test`: 集計・詳細復元のテスト
- `npm run build`: GitHub Pages用の静的ファイルを `public/` に準備

`main` ブランチへのpushで `.github/workflows/pages.yml` がテスト、ビルド、GitHub Pages公開を実行します。

## ユーザー別JSONの更新

`scripts/scrape_playaram_profiles.py` は `data/playaram-profiles/index.json` の対象を順に処理し、PlayARAMの公開プロフィールとOverview取得URLからユーザー別JSONを更新します。ゲーム本体、LCU、ローカルのゲームポートには接続しません。1ユーザー最大2,000試合で、50件ごとに途中経過を保存します。

実行には同梱の `.vendor`（Beautiful Soup）が必要です。PlayARAMでプロフィールが見つからないユーザーは、空の完了データにせず `unavailable` として記録され、画面にも「PlayARAM未登録」と表示されます。
